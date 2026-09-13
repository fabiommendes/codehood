import {
	copyFile,
	link as fsLink,
	lstat,
	mkdir,
	readFile,
	readlink,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import { SYSTEM } from "@/core/actor";
import type { AttachmentLinkMode } from "@/core/constants";
import {
	ATTACHMENT_LINK_MODE,
	BLOB_GC_GRACE_MS,
	RESOURCE_ROOT,
} from "@/core/constants";
import { InvalidData, NotAllowed } from "@/core/error";
import { blobCreate, blobFilter, blobPK, blobSchema } from "@/core/schemas";
import { hashBytes } from "@/utils/content-hash";
import { Validate } from "@/utils/validate";
import type { ServiceOpts } from "../base-service";
import { type PrismaClient, prisma } from "../client";

//
// Type definitions
//
export type Blob = z.infer<typeof blobSchema>;
export type BlobCreate = z.infer<typeof blobCreate>;
export type BlobFilter = z.infer<typeof blobFilter>;
export type BlobPK = z.infer<typeof blobPK>;

/** Options a caller may override, injected so tests can drive every mode. */
export type BlobServiceOptions = {
	root?: string;
	linkMode?: AttachmentLinkMode;
};

/**
 * Content-addressed blob storage: the bytes, their deduped row, and the
 * per-attachment names linked beside them.
 *
 * Not routed. The REST API reaches blobs only through the higher-level
 * resource and question endpoints. See `dev/specs/to-do/blob-attachments.md`.
 */
export class BlobService {
	prisma: PrismaClient;
	root: string;
	linkMode: AttachmentLinkMode;

	constructor(client: PrismaClient = prisma, options: BlobServiceOptions = {}) {
		this.prisma = client;
		this.root = options.root ?? RESOURCE_ROOT;
		this.linkMode = options.linkMode ?? ATTACHMENT_LINK_MODE;
	}

	/**
	 * Hashes `bytes`, rejects a mismatch against `input.contentHash` as
	 * corrupt, writes the blob and dedupes on the hash.
	 *
	 * Identical bytes already on file return the existing row untouched, and a
	 * re-push of bytes whose blob was tombstoned resurrects it.
	 */
	@Validate({ service: true, returns: blobSchema, args: [blobCreate] })
	async create(input: BlobCreate, opts: ServiceOpts): Promise<Blob> {
		if (opts.actor !== SYSTEM) {
			throw new NotAllowed({ action: "create-blob" });
		}
		const hash = hashBytes(input.bytes);
		if (input.contentHash && input.contentHash !== hash) {
			throw new Error(
				`Upload is corrupt: the supplied contentHash "${input.contentHash}" does not match the bytes' sha-256 "${hash}".`,
			);
		}

		const client = opts.tx ?? this.prisma;
		const existing = await client.blob.findUnique({ where: { hash } });
		if (existing && !existing.deletedAt) {
			return existing;
		}

		await this.writeBytes(hash, input.bytes);

		if (existing) {
			return client.blob.update({
				where: { hash },
				data: { deletedAt: null },
			});
		}
		return client.blob.create({
			data: { hash, size: input.bytes.length },
		});
	}

	/** Finds a single blob by hash. */
	@Validate({ async: true, returns: blobSchema.nullable(), args: [blobPK] })
	async findOne(filter: BlobPK, opts?: ServiceOpts): Promise<Blob | null> {
		const client = opts?.tx ?? this.prisma;
		return client.blob.findUnique({ where: { hash: filter.hash } });
	}

	/** Finds many blobs, optionally narrowed by hash or to unattached ones. */
	@Validate({ async: true, returns: blobSchema.array(), args: [blobFilter] })
	async findMany(filter: BlobFilter, opts?: ServiceOpts): Promise<Blob[]> {
		const client = opts?.tx ?? this.prisma;
		return client.blob.findMany({
			where: {
				AND: [
					filter.hashes ? { hash: { in: filter.hashes } } : {},
					filter.unattached !== undefined
						? { attachments: filter.unattached ? { none: {} } : { some: {} } }
						: {},
				],
			},
		});
	}

	/**
	 * Removes the bytes and stamps `deletedAt`, leaving the row as a tombstone
	 * so the URL can still explain itself.
	 *
	 * A blob any attachment still points at is left untouched: a business-level
	 * no-op, not a skipped access check.
	 */
	@Validate({ service: true, args: [blobPK] })
	async delete(filter: BlobPK, opts: ServiceOpts): Promise<void> {
		if (opts.actor !== SYSTEM) {
			throw new NotAllowed({ action: "delete-blob" });
		}
		const client = opts.tx ?? this.prisma;
		const target = await this.findOne(filter, opts);
		if (!target || target.deletedAt) {
			return;
		}
		const attachmentCount = await client.attachment.count({
			where: { hash: target.hash },
		});
		if (attachmentCount > 0) {
			return;
		}
		await rm(this.blobDir(target.hash), { recursive: true, force: true });
		await client.blob.update({
			where: { hash: target.hash },
			data: { deletedAt: new Date() },
		});
	}

	/**
	 * Tombstones every blob no attachment points at and whose grace period has
	 * elapsed, returning the hashes collected.
	 */
	async collectGarbage(
		opts: ServiceOpts & { olderThan?: Date },
	): Promise<string[]> {
		if (opts.actor !== SYSTEM) {
			throw new NotAllowed({ action: "do-gc-blobs" });
		}
		const client = opts.tx ?? this.prisma;
		const olderThan = opts.olderThan ?? new Date(Date.now() - BLOB_GC_GRACE_MS);
		const candidates = await client.blob.findMany({
			where: {
				deletedAt: null,
				createdAt: { lt: olderThan },
				attachments: { none: {} },
			},
		});

		const collected: string[] = [];
		for (const blob of candidates) {
			await rm(this.blobDir(blob.hash), { recursive: true, force: true });
			await client.blob.update({
				where: { hash: blob.hash },
				data: { deletedAt: new Date() },
			});
			collected.push(blob.hash);
		}
		return collected;
	}

	/**
	 * Materialises `filename` beside the blob's bytes, per
	 * `ATTACHMENT_LINK_MODE`. Idempotent: an existing correct link is left
	 * alone.
	 */
	async link(hash: string, filename: string): Promise<void> {
		const dir = this.blobDir(hash);
		await mkdir(dir, { recursive: true });
		const dest = this.attachmentPath(hash, filename);

		const existing = await lstat(dest).catch(() => null);
		if (existing) {
			if (this.linkMode === "symlink" && existing.isSymbolicLink()) {
				const linkTarget = await readlink(dest).catch(() => null);
				if (linkTarget === hash) return;
			} else if (this.linkMode === "hardlink" && existing.isFile()) {
				const bytesStat = await stat(this.blobPath(hash)).catch(() => null);
				if (bytesStat && bytesStat.ino === existing.ino) return;
			} else if (this.linkMode === "copy" && existing.isFile()) {
				return;
			}
			await rm(dest, { force: true });
		}

		switch (this.linkMode) {
			case "symlink":
				await symlink(hash, dest);
				break;
			case "hardlink":
				await fsLink(this.blobPath(hash), dest);
				break;
			case "copy":
				await copyFile(this.blobPath(hash), dest);
				break;
		}
	}

	/** Removes a name from a blob's directory. Missing names are not an error. */
	async unlink(hash: string, filename: string): Promise<void> {
		await rm(this.attachmentPath(hash, filename), { force: true });
	}

	/** Reads a live (non-tombstoned) blob's bytes off disk, or `null`. */
	async readBlob(
		blob: Pick<Blob, "hash" | "deletedAt">,
	): Promise<Buffer | null> {
		if (blob.deletedAt) return null;
		try {
			return await readFile(this.blobPath(blob.hash));
		} catch {
			return null;
		}
	}

	/** Directory holding a blob's bytes and all of its attachment names. */
	blobDir(hash: string): string {
		return path.join(this.root, hash.slice(0, 2), hash);
	}

	/** Path of the canonical, unnamed bytes: `<blobDir>/<hash>`. */
	blobPath(hash: string): string {
		return path.join(this.blobDir(hash), hash);
	}

	/** Path an attachment's name resolves to: `<blobDir>/<filename>`. */
	attachmentPath(hash: string, filename: string): string {
		const dir = this.blobDir(hash);
		const resolved = path.resolve(dir, filename);
		// `sanitizeFilename` already guarantees a bare basename, but `link`
		// and `unlink` are public and take the name raw, so the one place
		// that turns a name into a path refuses to leave the blob's own
		// directory.
		if (path.dirname(resolved) !== path.resolve(dir)) {
			throw new InvalidData({
				errors: { filename: [{ code: "invalid", message: "Not a basename." }] },
				message: `"${filename}" escapes the blob directory.`,
			});
		}
		return resolved;
	}

	private async writeBytes(hash: string, bytes: Buffer): Promise<void> {
		const dest = this.blobPath(hash);
		await mkdir(path.dirname(dest), { recursive: true });
		await writeFile(dest, bytes);
	}
}

export const blobService = new BlobService();
