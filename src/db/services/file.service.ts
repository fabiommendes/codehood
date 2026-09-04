import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import { SYSTEM } from "@/core/actor";
import { RESOURCE_ROOT } from "@/core/constants";
import { NotAllowed } from "@/core/error";
import type { FillUndefineds } from "@/utils/types";
import { Validate } from "@/utils/validate";
import {
	type FileId,
	fileCreate,
	fileFilter,
	filePK,
	fileSchema,
	fileUpdate,
} from "../../core/schemas";
import type { Crud, ServiceOpts } from "../base-service";
import { type File as DbFile, type PrismaClient, prisma } from "../client";

export type { FileId } from "../../core/schemas";

//
// Type definitions
//
export type FileCreate = z.infer<typeof fileCreate>;
export type File = z.infer<typeof fileSchema>;
export type FileFilter = z.infer<typeof fileFilter>;
export type FilePK = z.infer<typeof filePK>;
export type FileUpdate = z.infer<typeof fileUpdate>;

/** Filesystem path a blob is stored at: `<RESOURCE_ROOT>/<hash[0:2]>/<hash>`. */
export function blobPath(slugHash: string): string {
	return path.join(RESOURCE_ROOT, slugHash.slice(0, 2), slugHash);
}

/**
 * Blob storage, content-addressed by a sha-256 of the bytes (`slugHash`),
 * which doubles as both the URL token and the on-disk path — see "Files are
 * content-addressed" in `dev/specs/to-do/resources.md`.
 *
 * Nothing here is reachable from the web app: content is only ever written
 * by `manage import-resources`, so every write requires `SYSTEM` — there is
 * no rule to apply on behalf of a signed-in user, because there is no path
 * by which one calls this directly. Reads carry no rule either, matching
 * the blob route, which serves bytes with no authentication check by
 * design.
 */
class FileService
	implements
		Crud<{
			entity: File;
			pkFilter: FilePK;
			create: FileCreate;
			filter: FileFilter;
			update: FileUpdate;
		}>
{
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	/**
	 * Hashes `bytes`, rejects a mismatch against `input.contentHash` as
	 * corrupt, and dedupes on the hash.
	 *
	 * Identical bytes already on file return the existing row untouched, and
	 * a re-push of bytes whose blob was tombstoned resurrects it (clears
	 * `deletedAt`, rewrites the file).
	 */
	@Validate({ service: true, returns: fileSchema, args: [fileCreate] })
	async create(input: FileCreate, opts: ServiceOpts): Promise<File> {
		if (opts.actor !== SYSTEM) {
			throw new NotAllowed({ action: "create-file" });
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
			return brand(existing);
		}

		await this.writeBlob(slugHash, input.bytes);

		if (existing) {
			// Resurrecting a tombstoned blob: same bytes, so mimeType/size are
			// unchanged, only deletedAt clears.
			return brand(
				await client.file.update({
					where: { slugHash },
					data: { deletedAt: null },
				}),
			);
		}
		return brand(
			await client.file.create({
				data: { slugHash, mimeType: input.mimeType, size: input.bytes.length },
			}),
		);
	}

	/**
	 * Finds a single file by id or by its `slugHash`.
	 */
	@Validate({ async: true, returns: fileSchema.nullable(), args: [filePK] })
	async findOne(filter: FilePK, opts?: ServiceOpts): Promise<File | null> {
		const client = opts?.tx ?? this.prisma;
		const by = filter as FillUndefineds<FilePK>; // zod doesn't narrow to a single field, so we do it here

		let row: DbFile | null = null;
		if (by.id !== undefined) {
			row = await client.file.findUnique({ where: { id: by.id as FileId } });
		} else if (by.slugHash !== undefined) {
			row = await client.file.findUnique({
				where: { slugHash: by.slugHash },
			});
		}
		return row && brand(row);
	}

	/**
	 * Finds many files, optionally narrowed to `filter.ids` and/or
	 * `filter.slugHashes`.
	 */
	@Validate({ async: true, returns: fileSchema.array(), args: [fileFilter] })
	async findMany(filter: FileFilter, opts?: ServiceOpts): Promise<File[]> {
		const client = opts?.tx ?? this.prisma;
		const rows = await client.file.findMany({
			where: {
				AND: [
					filter.ids ? { id: { in: filter.ids } } : {},
					filter.slugHashes ? { slugHash: { in: filter.slugHashes } } : {},
				],
			},
		});
		return rows.map(brand);
	}

	/**
	 * Corrects `mimeType` — the only field a `File` row can change without
	 * changing its identity, since the bytes are content-addressed.
	 */
	@Validate({ service: true, returns: fileSchema, args: [filePK, fileUpdate] })
	async update(
		filter: FilePK,
		fields: FileUpdate,
		opts: ServiceOpts,
	): Promise<File> {
		if (opts.actor !== SYSTEM) {
			throw new NotAllowed({ action: "update-file" });
		}
		const target = await this.findOne(filter, opts);
		if (!target) {
			throw new Error("No file matches that filter.");
		}
		if (target.deletedAt) {
			throw new Error(
				`File "${target.slugHash}" has been deleted and cannot be updated.`,
			);
		}
		const client = opts.tx ?? this.prisma;
		return brand(
			await client.file.update({
				where: { slugHash: target.slugHash },
				data: { mimeType: fields.mimeType },
			}),
		);
	}

	/**
	 * Reference-counted: unlinks the bytes and stamps `deletedAt` only when
	 * no `Resource` still points at this file (content addressing means
	 * more than one course may share it — see "Files are content-addressed"
	 * in `dev/specs/to-do/resources.md`).
	 *
	 * The row and its `slugHash` always survive, so the blob route can
	 * answer `410` instead of `404`. A file still referenced is left
	 * untouched — a business-level no-op, not a silently skipped access
	 * check.
	 */
	@Validate({ service: true, args: [filePK] })
	async delete(filter: FilePK, opts: ServiceOpts): Promise<void> {
		if (opts.actor !== SYSTEM) {
			throw new NotAllowed({ action: "delete-file" });
		}
		const target = await this.findOne(filter, opts);
		if (!target || target.deletedAt) {
			return;
		}
		const client = opts.tx ?? this.prisma;
		const current = await client.file.findUnique({
			where: { slugHash: target.slugHash },
			include: { _count: { select: { resources: true } } },
		});
		if (!current || current._count.resources > 0) {
			return;
		}
		await rm(blobPath(current.slugHash), { force: true });
		await client.file.update({
			where: { slugHash: current.slugHash },
			data: { deletedAt: new Date() },
		});
	}

	/**
	 * For the blob route's `410` page: the file as it currently stands,
	 * plus the titles of any resource still pointing at it.
	 *
	 * Normally empty even for a tombstoned file, since {@link delete} only
	 * tombstones once the last referencing resource is gone — kept for the
	 * rare case a file is removed by some other path while a resource still
	 * names it.
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
		return { file: brand(file), resourceTitles: resources.map((r) => r.title) };
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

//
// Auxiliary functions
//

// Re-brand a raw file row's id — a runtime no-op, since it already carries
// the right value, just not the branded type.
function brand<T extends { id: number }>(file: T): T & { id: FileId } {
	return file as T & { id: FileId };
}
