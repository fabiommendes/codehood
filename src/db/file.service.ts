import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { RESOURCE_ROOT } from "@/constants";
import { SYSTEM } from "@/db/base-service";
import type { FillUndefineds } from "@/utils/types";
import {
	type Create,
	type Delete,
	type FindMany,
	type FindOne,
	ForbiddenError,
	type ServiceOpts,
	type Update,
} from "./base-service";
import { type File, type PrismaClient, prisma } from "./client";

export interface CreateFile {
	bytes: Buffer;
	mimeType: string;
	/**
	 * A hash the writer computed locally, checked against the hash the server
	 * computes from `bytes`. A mismatch means the upload is corrupt — the one
	 * place a supplied hash is checked rather than trusted (see
	 * `dev/specs/to-do/resources.md`, "Who computes it").
	 */
	contentHash?: string;
}

export type FindFileBy = FillUndefineds<{ id: number } | { slugHash: string }>;

export interface FindFilesBy {
	ids?: number[];
	slugHashes?: string[];
}

export interface UpdateFileFilter {
	slugHash: string;
}

/**
 * The one field a `File` row can change without changing its identity: the
 * bytes are content-addressed, so `mimeType` — the writer's declared
 * interpretation of them — is the only thing left to correct.
 */
export interface UpdateFile {
	mimeType: string;
}

export interface DeleteFileFilter {
	slugHash: string;
}

/** Filesystem path a blob is stored at: `<RESOURCE_ROOT>/<hash[0:2]>/<hash>`. */
export function blobPath(slugHash: string): string {
	return path.join(RESOURCE_ROOT, slugHash.slice(0, 2), slugHash);
}

/**
 * Blob storage, content-addressed by a sha-256 of the bytes (`slugHash`),
 * which doubles as both the URL token and the on-disk path — see "Files are
 * content-addressed" in `dev/specs/to-do/resources.md`.
 *
 * Nothing here is reachable from the web app: content is only ever written by
 * `manage import-resources`, so every write requires `SYSTEM` — there is no
 * rule to apply on behalf of a signed-in user, because there is no path by
 * which one calls this directly. Reads carry no rule either, matching the
 * blob route, which serves bytes with no authentication check by design.
 */
class FileService
	implements
	Create<CreateFile, File>,
	FindOne<FindFileBy, File>,
	FindMany<FindFilesBy, File>,
	Update<UpdateFileFilter, UpdateFile, File>,
	Delete<DeleteFileFilter> {
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	/**
	 * Hashes `bytes`, rejects a mismatch against `input.contentHash` as
	 * corrupt, and dedupes on the hash: identical bytes already on file
	 * return the existing row untouched, and a re-push of bytes whose blob
	 * was tombstoned resurrects it (clears `deletedAt`, rewrites the file).
	 */
	async create(input: CreateFile, opts: ServiceOpts): Promise<File> {
		if (opts.actor !== SYSTEM) {
			throw new ForbiddenError();
		}
		const slugHash = createHash("sha256").update(input.bytes).digest("hex");
		if (input.contentHash && input.contentHash !== slugHash) {
			throw new Error(
				`Upload is corrupt: the supplied contentHash "${input.contentHash}" does not match the bytes' sha-256 "${slugHash}".`,
			);
		}

		const client = opts.tx ?? this.prisma;
		const existing = await client.file.findUnique({ where: { slugHash } });
		if (existing && !existing.deletedAt) {
			return existing;
		}

		await this.writeBlob(slugHash, input.bytes);

		if (existing) {
			// Resurrecting a tombstoned blob: same bytes, so mimeType/size are
			// unchanged, only deletedAt clears.
			return client.file.update({
				where: { slugHash },
				data: { deletedAt: null },
			});
		}
		return client.file.create({
			data: { slugHash, mimeType: input.mimeType, size: input.bytes.length },
		});
	}

	findOne(filter: FindFileBy, opts?: ServiceOpts): Promise<File | null> {
		const client = opts?.tx ?? this.prisma;
		if (filter.id !== undefined) {
			return client.file.findUnique({ where: { id: filter.id } });
		}
		if (filter.slugHash !== undefined) {
			return client.file.findUnique({ where: { slugHash: filter.slugHash } });
		}
		return Promise.resolve(null);
	}

	findMany(filter: FindFilesBy, opts?: ServiceOpts): Promise<File[]> {
		const client = opts?.tx ?? this.prisma;
		return client.file.findMany({
			where: {
				AND: [
					filter.ids ? { id: { in: filter.ids } } : {},
					filter.slugHashes ? { slugHash: { in: filter.slugHashes } } : {},
				],
			},
		});
	}

	async update(
		filter: UpdateFileFilter,
		fields: UpdateFile,
		opts: ServiceOpts,
	): Promise<File> {
		if (opts.actor !== SYSTEM) {
			throw new ForbiddenError();
		}
		const client = opts.tx ?? this.prisma;
		const current = await client.file.findUnique({
			where: { slugHash: filter.slugHash },
		});
		if (!current) {
			throw new Error(`No file with slugHash "${filter.slugHash}".`);
		}
		if (current.deletedAt) {
			throw new Error(
				`File "${filter.slugHash}" has been deleted and cannot be updated.`,
			);
		}
		return client.file.update({
			where: { slugHash: filter.slugHash },
			data: { mimeType: fields.mimeType },
		});
	}

	/**
	 * Reference-counted: unlinks the bytes and stamps `deletedAt` only when no
	 * `Resource` still points at this file (content addressing means more than
	 * one course may share it — see "Files are content-addressed" in
	 * `dev/specs/to-do/resources.md`). The row and its `slugHash` always
	 * survive, so the blob route can answer `410` instead of `404`. A file
	 * still referenced is left untouched — a business-level no-op, not a
	 * silently skipped access check.
	 */
	async delete(filter: DeleteFileFilter, opts: ServiceOpts): Promise<void> {
		if (opts.actor !== SYSTEM) {
			throw new ForbiddenError();
		}
		const client = opts.tx ?? this.prisma;
		const current = await client.file.findUnique({
			where: { slugHash: filter.slugHash },
			include: { _count: { select: { resources: true } } },
		});
		if (!current || current.deletedAt) {
			return;
		}
		if (current._count.resources > 0) {
			return;
		}
		await rm(blobPath(current.slugHash), { force: true });
		await client.file.update({
			where: { slugHash: filter.slugHash },
			data: { deletedAt: new Date() },
		});
	}

	/**
	 * For the blob route's `410` page: the file as it currently stands, plus
	 * the titles of any resource still pointing at it. Normally empty even for
	 * a tombstoned file, since {@link delete} only tombstones once the last
	 * referencing resource is gone — kept for the rare case a file is removed
	 * by some other path while a resource still names it.
	 */
	async findWithReferencingTitles(
		slugHash: string,
	): Promise<{ file: File; resourceTitles: string[] } | null> {
		const row = await this.prisma.file.findUnique({
			where: { slugHash },
			include: { resources: { select: { title: true } } },
		});
		if (!row) return null;
		const { resources, ...file } = row;
		return { file, resourceTitles: resources.map((r) => r.title) };
	}

	/** Reads a live (non-tombstoned) blob's bytes off disk, or `null`. */
	async readBlob(
		file: Pick<File, "slugHash" | "deletedAt">,
	): Promise<Buffer | null> {
		if (file.deletedAt) return null;
		try {
			return await readFile(blobPath(file.slugHash));
		} catch {
			return null;
		}
	}

	private async writeBlob(slugHash: string, bytes: Buffer): Promise<void> {
		const dest = blobPath(slugHash);
		await mkdir(path.dirname(dest), { recursive: true });
		await writeFile(dest, bytes);
	}
}

export const fileService = new FileService();
export type { File };
