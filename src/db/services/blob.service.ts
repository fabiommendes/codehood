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
import type { AttachmentLinkMode } from "@/core/constants";
import {
	ATTACHMENT_LINK_MODE,
	BLOB_GC_GRACE_MS,
	RESOURCE_ROOT,
} from "@/core/constants";
import { InvalidData } from "@/core/error";
import {
	blobCreate,
	blobFilter,
	blobHash,
	blobPK,
	blobSchema,
} from "@/core/schemas";
import type { ServiceOpts } from "@/db";
import { blobSecurityHeaders, contentDisposition } from "@/utils/blob-response";
import { hashBytes } from "@/utils/content-hash";
import { Validate } from "@/utils/validate";
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
		const hash = hashBytes(input.bytes);
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

	/**
	 * Finds a single blob by hash.
	 */
	@Validate({ service: true, returns: blobSchema.nullable(), args: [blobPK] })
	async findOne(filter: BlobPK, opts?: ServiceOpts): Promise<Blob | null> {
		const client = opts?.tx ?? this.prisma;
		return client.blob.findUnique({ where: { hash: filter.hash } });
	}

	/**
	 * Finds many blobs, optionally narrowed by hash or to unattached ones.
	 */
	@Validate({
		service: true,
		returns: blobSchema.array(),
		args: [blobFilter],
	})
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
		const client = opts.tx ?? this.prisma;
		const target = await this.findOne(filter, opts);
		if (!target || target.deletedAt) return;

		const attachmentCount = await client.attachment.count({
			where: { hash: target.hash },
		});
		if (attachmentCount > 0) return;

		await rm(this.blobDir(target.hash), { recursive: true, force: true });
		await client.blob.update({
			where: { hash: target.hash },
			data: { deletedAt: new Date() },
		});
	}

	/**
	 * Remove all blobs no attachment points at.
	 */
	async collectGarbage(
		opts: ServiceOpts & { olderThan?: Date },
	): Promise<string[]> {
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
	 * Materialises `filename` beside the blob's bytes.
	 *
	 * Idempotent: an existing correct link is leftalone.
	 * Return the path to the linked attachment.
	 */
	async link(hash: string, filename: string): Promise<string> {
		const dir = this.blobDir(hash);
		await mkdir(dir, { recursive: true });
		const dest = this.attachmentPath(hash, filename);

		const existing = await lstat(dest).catch(() => null);

		if (existing) {
			if (this.linkMode === "symlink" && existing.isSymbolicLink()) {
				const linkTarget = await readlink(dest).catch(() => null);
				if (linkTarget === hash) return dest;
			} else if (this.linkMode === "hardlink" && existing.isFile()) {
				const bytesStat = await stat(this.blobPath(hash)).catch(() => null);
				if (bytesStat && bytesStat.ino === existing.ino) return dest;
			} else if (this.linkMode === "copy" && existing.isFile()) {
				return dest;
			}
			await rm(dest, { force: true });
		}

		switch (this.linkMode) {
			case "symlink":
				await symlink(this.blobPath(hash), dest);
				return dest;
			case "hardlink":
				await fsLink(this.blobPath(hash), dest);
				return dest;
			case "copy":
				await copyFile(this.blobPath(hash), dest);
				return dest;
		}
	}

	/**
	 * Removes a name from a blob's directory.
	 *
	 * Missing names are not an error.
	 */
	async unlink(hash: string, filename: string): Promise<void> {
		await rm(this.attachmentPath(hash, filename), { force: true });
	}

	/**
	 * Reads a live blob's bytes off disk, or `null`.
	 */
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

	/**
	 * Serves the blob named by `hash`, behind both blob routes
	 * (`/files/[hash]` and `/files/[hash]/[name]`) — see
	 * `dev/specs/to-do/resources.md`. No authentication check by design
	 * (FR-NFR-030, amended): the URL is the content's own hash, and nothing
	 * whose disclosure matters is meant to live in a resource (FR-NFR-032).
	 *
	 * `name` is the URL's decorative trailing segment, used verbatim as the
	 * `Content-Disposition` filename when present — the page that links here
	 * already picked it from the resource the visitor clicked; when absent,
	 * falls back to an attachment still using these bytes. Answers `404` for
	 * an unknown hash and `410` for a tombstoned one.
	 */
	async serve(
		hash: string | undefined,
		name: string | undefined,
	): Promise<Response> {
		// A malformed hash (wrong length, uppercase, a "..") fails `findOne`'s
		// own `blobHash` validation, which throws rather than returning `null`
		// — treat it the same as a well-formed hash nothing matches.
		if (!hash || !blobHash.safeParse(hash).success) return notFoundResponse();

		const blob = await this.findOne({ hash });
		if (!blob) return notFoundResponse();
		if (blob.deletedAt) return tombstoneResponse();

		const bytes = await this.readBlob(blob);
		if (!bytes) {
			// DB says live, disk disagrees — treat as not found rather than lie
			// about a body we don't have.
			return notFoundResponse();
		}

		const attachment = await this.prisma.attachment.findFirst({
			where: { hash },
			select: { filename: true, mimeType: true },
		});
		if (!attachment) return notFoundResponse();

		const filename = name ?? attachment.filename;
		const headers = new Headers({
			"Content-Type": attachment.mimeType,
			"Content-Disposition": contentDisposition(attachment.mimeType, filename),
			...blobSecurityHeaders(),
		});
		return new Response(new Uint8Array(bytes), { status: 200, headers });
	}

	/**
	 * Path of the canonical, unnamed bytes: `<blobDir>/<hash>`.
	 */
	blobPath(hash: string): string {
		return path.join(this.blobDir(hash), hash);
	}

	/**
	 * Path an attachment's name resolves to: `<blobDir>/<filename>`.
	 */
	attachmentPath(hash: string, filename: string): string {
		const dir = this.blobDir(hash);
		const resolved = path.resolve(dir, filename);
		// `sanitizeFilename` already guarantees a bare basename, but `link`
		// and `unlink` are public and take the name raw, so the one place
		// that turns a name into a path refuses to leave the blob's own
		// directory.
		if (path.dirname(resolved) !== path.resolve(dir)) {
			throw new InvalidData(
				{ filename: [{ code: "invalid", message: "Not a basename." }] },
				{ message: `"${filename}" escapes the blob directory.` },
			);
		}
		return resolved;
	}
	/**
	 * Directory holding a blob's bytes and all of its attachment names.
	 */
	private blobDir(hash: string): string {
		return path.join(this.root, hash.slice(0, 2), hash);
	}

	private async writeBytes(hash: string, bytes: Buffer): Promise<void> {
		const dest = this.blobPath(hash);
		await mkdir(path.dirname(dest), { recursive: true });
		await writeFile(dest, bytes);
	}
}

function notFoundResponse(): Response {
	return new Response("Not found.", {
		status: 404,
		headers: { "Content-Type": "text/plain", ...blobSecurityHeaders() },
	});
}

function tombstoneResponse(): Response {
	const body = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>File removed</title></head>
<body style="font: 16px system-ui; max-width: 32rem; margin: 4rem auto; padding: 0 1rem;">
<h1>This file was removed</h1>
<p>The instructor removed this file from the course.</p>
</body>
</html>`;
	return new Response(body, {
		status: 410,
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			...blobSecurityHeaders(),
		},
	});
}
