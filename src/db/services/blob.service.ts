import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
	copyFile,
	link as fsLink,
	lstat,
	mkdir,
	readFile,
	readlink,
	rename,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import { SYSTEM } from "@/auth/actor";
import type { AttachmentLinkMode } from "@/core/constants";
import {
	ATTACHMENT_LINK_MODE,
	BLOB_GC_GRACE_MS,
	RESOURCE_ROOT,
} from "@/core/constants";
import { InvalidData, NotAllowed } from "@/core/error";
import type { NotAllowedAction } from "@/core/error-response";
import {
	blobCreate,
	blobFilter,
	blobHash,
	blobMissingInput,
	blobMissingResult,
	blobPK,
	blobSchema,
} from "@/core/schemas";
import type { ServiceOpts, ServiceOptsWithoutTx } from "@/db/base-service";
import { defineService, op } from "@/db/define-service";
import { m } from "@/i18n";
import { blobSha } from "@/services/git/objects";
import { blobSecurityHeaders, contentDisposition } from "@/utils/blob-response";
import { hashBytes } from "@/utils/content-hash";
import { sanitizeFilename } from "@/utils/filename";
import { type PrismaClient, type PrismaTx, prisma } from "../client";

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

/// The CRUD shape of the blob service. A blob is immutable, and `upsert` is
/// what `create` already does for identical bytes.
type BlobT = {
	entity: Blob;
	pkFilter: BlobPK;
	create: BlobCreate;
	filter: BlobFilter;
	update: never;
	upsert: false;
};

/**
 * Content-addressed blob storage: the bytes, their deduped row, and the
 * per-attachment names linked beside them.
 *
 * Not routed. The REST API reaches blobs only through the higher-level
 * resource and question endpoints.
 *
 * The operations (`create`, `findOne`, `findMany`, `delete`, `missing`) run in
 * a transaction. The rest works on files, which a transaction cannot roll back
 * and whose size could outlast its timeout, so they open none and use
 * `opts.tx` only when the caller passes one.
 */
export function makeBlobService(
	client: PrismaClient = prisma,
	options: BlobServiceOptions = {},
) {
	const root = options.root ?? RESOURCE_ROOT;
	const linkMode = options.linkMode ?? ATTACHMENT_LINK_MODE;

	/// Directory holding a blob's bytes and all of its attachment names.
	function blobDir(hash: string): string {
		return path.join(root, hash.slice(0, 2), hash);
	}

	/**
	 * Path of the canonical, unnamed bytes: `<blobDir>/<hash>`.
	 */
	function blobPath(hash: string): string {
		return path.join(blobDir(hash), hash);
	}

	/**
	 * Path an attachment's name resolves to: `<blobDir>/<filename>`.
	 */
	function attachmentPath(hash: string, filename: string): string {
		const dir = blobDir(hash);
		const resolved = path.resolve(dir, filename);
		// `sanitizeFilename` already guarantees a bare basename, but `link`
		// and `unlink` are public and take the name raw, so the one place
		// that turns a name into a path refuses to leave the blob's own
		// directory.
		if (path.dirname(resolved) !== path.resolve(dir)) {
			throw new InvalidData(
				{
					filename: [
						{ code: "invalid", message: m.errors_blob_not_basename() },
					],
				},
				{ message: m.errors_blob_escapes_directory({ filename }) },
			);
		}
		return resolved;
	}

	async function writeBytes(hash: string, bytes: Buffer): Promise<void> {
		const dest = blobPath(hash);
		await mkdir(path.dirname(dest), { recursive: true });
		await writeFile(dest, bytes);
	}

	/**
	 * Materialises `filename` beside the blob's bytes.
	 *
	 * Idempotent: an existing correct link is leftalone.
	 * Return the path to the linked attachment.
	 */
	async function link(hash: string, filename: string): Promise<string> {
		const dir = blobDir(hash);
		await mkdir(dir, { recursive: true });
		const dest = attachmentPath(hash, filename);

		const existing = await lstat(dest).catch(() => null);

		if (existing) {
			if (linkMode === "symlink" && existing.isSymbolicLink()) {
				const linkTarget = await readlink(dest).catch(() => null);
				if (linkTarget === hash) return dest;
			} else if (linkMode === "hardlink" && existing.isFile()) {
				const bytesStat = await stat(blobPath(hash)).catch(() => null);
				if (bytesStat && bytesStat.ino === existing.ino) return dest;
			} else if (linkMode === "copy" && existing.isFile()) {
				return dest;
			}
			await rm(dest, { force: true });
		}

		switch (linkMode) {
			case "symlink":
				// Relative to the blob's own directory, so the tree survives a
				// move of the storage root.
				await symlink(hash, dest);
				return dest;
			case "hardlink":
				await fsLink(blobPath(hash), dest);
				return dest;
			case "copy":
				await copyFile(blobPath(hash), dest);
				return dest;
		}
	}

	/**
	 * Removes a name from a blob's directory.
	 *
	 * Missing names are not an error.
	 */
	async function unlink(hash: string, filename: string): Promise<void> {
		await rm(attachmentPath(hash, filename), { force: true });
	}

	/**
	 * Reads a live blob's bytes off disk, or `null`.
	 */
	async function readBlob(
		blob: Pick<Blob, "hash" | "deletedAt">,
	): Promise<Buffer | null> {
		if (blob.deletedAt) return null;
		try {
			return await readFile(blobPath(blob.hash));
		} catch {
			return null;
		}
	}

	/**
	 * A fresh path in the store's scratch directory, on the same filesystem
	 * as the blobs, for a file {@link BlobService.createFromFile} will adopt.
	 *
	 * Creates the directory, not the file.
	 */
	async function tempPath(): Promise<string> {
		const dir = path.join(root, ".tmp");
		await mkdir(dir, { recursive: true });
		return path.join(dir, randomUUID());
	}

	const ops = defineService<BlobT>()(() => {
		/**
		 * Hashes `bytes`, writes the blob and dedupes on the hash.
		 *
		 * Identical bytes already on file return the existing row, and a re-push
		 * of bytes whose blob was tombstoned resurrects it. Every write stores the
		 * git sha1 of the bytes in `gitSha`, and a hit on an existing row whose
		 * `gitSha` is null fills it in.
		 *
		 * @throws {@link NotAllowed} If the actor is not SYSTEM.
		 */
		const create = op({
			args: [blobCreate],
			returns: blobSchema,
			run: async (
				tx: PrismaTx,
				input: BlobCreate,
				opts: ServiceOptsWithoutTx,
			): Promise<Blob> => {
				assertSystem(opts, "blob.create");
				const hash = hashBytes(input.bytes);
				const gitSha = blobSha(input.bytes);
				const existing = await tx.blob.findUnique({ where: { hash } });
				if (existing && !existing.deletedAt) {
					if (existing.gitSha) return existing;
					return tx.blob.update({ where: { hash }, data: { gitSha } });
				}

				await writeBytes(hash, input.bytes);

				if (existing) {
					return tx.blob.update({
						where: { hash },
						data: { deletedAt: null, gitSha },
					});
				}
				return tx.blob.create({
					data: { hash, size: input.bytes.length, gitSha },
				});
			},
		});

		/**
		 * Finds a single blob by hash.
		 */
		const findOne = op({
			transaction: false,
			args: [blobPK],
			returns: blobSchema.nullable(),
			run: async (
				tx: PrismaTx,
				filter: BlobPK,
				_opts: ServiceOptsWithoutTx,
			): Promise<Blob | null> =>
				tx.blob.findUnique({ where: { hash: filter.hash } }),
		});

		/**
		 * Finds many blobs, optionally narrowed by hash or to unattached ones.
		 */
		const findMany = op({
			transaction: false,
			args: [blobFilter],
			returns: blobSchema.array(),
			run: async (
				tx: PrismaTx,
				filter: BlobFilter,
				_opts: ServiceOptsWithoutTx,
			): Promise<Blob[]> =>
				tx.blob.findMany({
					where: {
						AND: [
							filter.hashes ? { hash: { in: filter.hashes } } : {},
							filter.unattached !== undefined
								? {
										attachments: filter.unattached
											? { none: {} }
											: { some: {} },
									}
								: {},
						],
					},
				}),
		});

		/**
		 * Removes the bytes and stamps `deletedAt`, leaving the row as a tombstone
		 * so the URL can still explain itself.
		 *
		 * A blob any attachment still points at is left untouched: a business-level
		 * no-op, not a skipped access check.
		 *
		 * @throws {@link NotAllowed} If the actor is not SYSTEM.
		 */
		const remove = op({
			args: [blobPK],
			run: async (
				tx: PrismaTx,
				filter: BlobPK,
				opts: ServiceOptsWithoutTx,
			): Promise<void> => {
				assertSystem(opts, "blob.delete");
				const target = await findOne(tx, filter, opts);
				if (!target || target.deletedAt) return;

				const attachmentCount = await tx.attachment.count({
					where: { hash: target.hash },
				});
				if (attachmentCount > 0) return;

				await rm(blobDir(target.hash), { recursive: true, force: true });
				await tx.blob.update({
					where: { hash: target.hash },
					data: { deletedAt: new Date() },
				});
			},
		});

		/**
		 * The hashes in `hashes` that have no live blob, in input order and
		 * without repeats.
		 *
		 * Any authenticated actor may ask: knowing a hash already gives access to
		 * its bytes at `/files/<hash>`, so the answer discloses nothing new.
		 */
		const missing = op({
			transaction: false,
			args: [blobMissingInput.shape.hashes],
			returns: blobMissingResult.shape.missing,
			run: async (
				tx: PrismaTx,
				hashes: string[],
				_opts: ServiceOptsWithoutTx,
			): Promise<string[]> => {
				const live = await tx.blob.findMany({
					where: { hash: { in: hashes }, deletedAt: null },
					select: { hash: true },
				});
				const present = new Set(live.map((row) => row.hash));
				return [...new Set(hashes)].filter((hash) => !present.has(hash));
			},
		});

		return { create, findOne, findMany, delete: remove, missing };
	})(client);

	/**
	 * Moves a file already on disk into the store as a blob, hashing it in
	 * streaming so its size does not reach memory.
	 *
	 * Behaves like `create` for the same bytes, including `gitSha`. The file
	 * at `filePath` is consumed: renamed into place for new bytes, removed
	 * when the bytes were already stored. It must live on the same filesystem
	 * as the store, e.g. under {@link tempPath}.
	 *
	 * @throws {@link NotAllowed} If the actor is not SYSTEM.
	 */
	async function createFromFile(
		filePath: string,
		opts: ServiceOpts,
	): Promise<Blob> {
		assertSystem(opts, "blob.create");
		const db = opts.tx ?? client;
		const { hash, gitSha, size } = await digestFile(filePath);

		const existing = await db.blob.findUnique({ where: { hash } });
		if (existing && !existing.deletedAt) {
			await rm(filePath, { force: true });
			if (existing.gitSha) return existing;
			return db.blob.update({ where: { hash }, data: { gitSha } });
		}

		await mkdir(path.dirname(blobPath(hash)), { recursive: true });
		await rename(filePath, blobPath(hash));

		if (existing) {
			return db.blob.update({
				where: { hash },
				data: { deletedAt: null, gitSha },
			});
		}
		return db.blob.create({ data: { hash, size, gitSha } });
	}

	/// Deletes the attachments whose `REPORT`, `RESOURCE` or `REPOSITORY` owner row is gone, unlinking names no sibling uses.
	async function deleteOrphanAttachments(
		db: PrismaClient | PrismaTx,
	): Promise<void> {
		const owners = {
			REPORT: (await db.report.findMany({ select: { id: true } })).map(
				(r) => r.id,
			),
			RESOURCE: (await db.resource.findMany({ select: { id: true } })).map(
				(r) => r.id,
			),
			REPOSITORY: (await db.repository.findMany({ select: { id: true } })).map(
				(r) => r.id,
			),
		};
		for (const [type, ids] of Object.entries(owners) as [
			keyof typeof owners,
			number[],
		][]) {
			const orphans = await db.attachment.findMany({
				where: { attachedToType: type, attachedToId: { notIn: ids } },
			});
			if (orphans.length === 0) continue;
			await db.attachment.deleteMany({
				where: { id: { in: orphans.map((o) => o.id) } },
			});
			for (const row of orphans) {
				const siblings = await db.attachment.count({
					where: { hash: row.hash, filename: row.filename },
				});
				if (siblings === 0) await unlink(row.hash, row.filename);
			}
		}
	}

	/**
	 * Remove all blobs no attachment points at.
	 *
	 * First deletes the attachments of `REPORT`, `RESOURCE` and `REPOSITORY` owners that no
	 * longer exist (database cascades cannot reach the polymorphic owner), so
	 * their blobs are collected in the same pass.
	 *
	 * @throws {@link NotAllowed} If the actor is not SYSTEM.
	 */
	async function collectGarbage(
		opts: ServiceOpts & { olderThan?: Date },
	): Promise<string[]> {
		assertSystem(opts, "blob.run");
		const db = opts.tx ?? client;
		const olderThan = opts.olderThan ?? new Date(Date.now() - BLOB_GC_GRACE_MS);

		await deleteOrphanAttachments(db);

		const candidates = await db.blob.findMany({
			where: {
				deletedAt: null,
				createdAt: { lt: olderThan },
				attachments: { none: {} },
			},
		});

		const collected: string[] = [];
		for (const blob of candidates) {
			await rm(blobDir(blob.hash), { recursive: true, force: true });
			await db.blob.update({
				where: { hash: blob.hash },
				data: { deletedAt: new Date() },
			});
			collected.push(blob.hash);
		}
		return collected;
	}

	/**
	 * Serves the blob named by `hash`, behind both blob routes
	 * (`/files/[hash]` and `/files/[hash]/[name]`), with no authentication
	 * check by design: the URL is the content's own hash, and nothing whose
	 * disclosure matters is meant to live in a resource (dev/adr/0010-blobs-publicos-e-permanentes.md).
	 *
	 * `name` is the URL's decorative trailing segment, used as the
	 * `Content-Disposition` filename when present — the page that links here
	 * already picked it from the resource the visitor clicked; when absent,
	 * falls back to an attachment still using these bytes. It runs through
	 * `sanitizeFilename` first, since it reaches a response header straight
	 * from the URL and a decoded CR/LF in it would otherwise make the header
	 * constructor throw. Answers `404` for an unknown hash, for a name that
	 * survives no sanitising, and `410` for a tombstoned one.
	 */
	async function serve(
		hash: string | undefined,
		name: string | undefined,
	): Promise<Response> {
		// A malformed hash (wrong length, uppercase, a "..") fails `findOne`'s
		// own `blobHash` validation, which throws rather than returning `null`
		// — treat it the same as a well-formed hash nothing matches.
		if (!hash || !blobHash.safeParse(hash).success) return notFoundResponse();

		// Blobs are public (ADR 0010), so reading one needs no actor of its own.
		const blob = await ops.findOne({ hash }, { actor: SYSTEM });
		if (!blob) return notFoundResponse();
		if (blob.deletedAt) return tombstoneResponse();

		const bytes = await readBlob(blob);
		if (!bytes) {
			// DB says live, disk disagrees — treat as not found rather than lie
			// about a body we don't have.
			return notFoundResponse();
		}

		const attachment = await client.attachment.findFirst({
			where: { hash },
			select: { filename: true, mimeType: true },
		});
		if (!attachment) return notFoundResponse();

		const filename = name != null ? safeFilename(name) : attachment.filename;
		if (filename == null) return notFoundResponse();
		const headers = new Headers({
			"Content-Type": attachment.mimeType,
			"Content-Disposition": contentDisposition(attachment.mimeType, filename),
			...blobSecurityHeaders(),
		});
		return new Response(new Uint8Array(bytes), { status: 200, headers });
	}

	return {
		...ops,
		createFromFile,
		collectGarbage,
		tempPath,
		link,
		unlink,
		readBlob,
		serve,
		blobPath,
		attachmentPath,
	};
}

/** The blob service, as built by {@link makeBlobService}. */
export type BlobService = ReturnType<typeof makeBlobService>;

/// Sha-256 and git sha1 of a file, read once in streaming.
async function digestFile(
	filePath: string,
): Promise<{ hash: string; gitSha: string; size: number }> {
	const { size } = await stat(filePath);
	const sha256 = createHash("sha256");
	const sha1 = createHash("sha1").update(`blob ${size}\0`);
	let read = 0;
	for await (const chunk of createReadStream(filePath)) {
		const buf = chunk as Buffer;
		read += buf.length;
		sha256.update(buf);
		sha1.update(buf);
	}
	if (read !== size) throw new Error(`${filePath} changed while hashing`);
	return { hash: sha256.digest("hex"), gitSha: sha1.digest("hex"), size };
}

/// Reduces a URL-supplied filename to one safe to put in a response header,
/// or `null` when nothing is left of it. The segment arrives decoded, so a
/// `%0d%0a` in it is a real CR/LF by the time it gets here.
function safeFilename(name: string): string | null {
	try {
		return sanitizeFilename(name);
	} catch {
		return null;
	}
}

function notFoundResponse(): Response {
	return new Response(m.errors_not_found_plain(), {
		status: 404,
		headers: { "Content-Type": "text/plain", ...blobSecurityHeaders() },
	});
}

function tombstoneResponse(): Response {
	const body = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>${m.errors_blob_removed_title()}</title></head>
<body style="font: 16px system-ui; max-width: 32rem; margin: 4rem auto; padding: 0 1rem;">
<h1>${m.errors_blob_removed_heading()}</h1>
<p>${m.errors_blob_removed_body()}</p>
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

/// Blob bytes are written and reclaimed by the server itself; no user actor
/// may reach them directly.
function assertSystem(opts: ServiceOpts, action: NotAllowedAction): void {
	if (opts.actor !== SYSTEM) throw new NotAllowed(action);
}
