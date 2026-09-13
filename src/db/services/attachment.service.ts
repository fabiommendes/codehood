import type { z } from "zod";
import { SYSTEM } from "@/core/actor";
import { BLOB_QUOTA_BY_ROLE } from "@/core/constants";
import { NotAllowed } from "@/core/error";
import {
	type AttachmentId,
	attachmentCreate,
	attachmentFilter,
	attachmentPK,
	attachmentSchema,
	attachmentUpdate,
} from "@/core/schemas";
import { sanitizeFilename } from "@/utils/filename";
import { mimeFor } from "@/utils/mime";
import { Validate } from "@/utils/validate";
import type { ServiceOpts } from "../base-service";
import {
	type AttachmentOwner,
	type PrismaClient,
	type PrismaTx,
	prisma,
	type Role,
} from "../client";
import { type BlobService, blobService } from "./blob.service";

export type { AttachmentId } from "@/core/schemas";

// Re-brand a raw attachment row's id — a runtime no-op, since it already
// carries the right value, just not the branded type.
function brand<T extends { id: number }>(row: T): T & { id: AttachmentId } {
	return row as T & { id: AttachmentId };
}

//
// Type definitions
//
export type Attachment = z.infer<typeof attachmentSchema>;
export type AttachmentCreate = z.infer<typeof attachmentCreate>;
export type AttachmentFilter = z.infer<typeof attachmentFilter>;
export type AttachmentPK = z.infer<typeof attachmentPK>;
export type AttachmentUpdate = z.infer<typeof attachmentUpdate>;

/**
 * The ledger over blob storage: who uses which bytes, under what name, and
 * who is charged for them.
 *
 * Not routed. See `dev/specs/to-do/blob-attachments.md`.
 */
export class AttachmentService {
	prisma: PrismaClient;
	blobs: BlobService;

	constructor(client: PrismaClient = prisma, blobs: BlobService = blobService) {
		this.prisma = client;
		this.blobs = blobs;
	}

	/**
	 * Stores the bytes, sanitises the filename, derives the mime type and
	 * records the use, all in one transaction.
	 *
	 * The stored filename is returned, which is not always the one sent.
	 */
	@Validate({
		service: true,
		returns: attachmentSchema,
		args: [attachmentCreate],
	})
	@Validate({
		service: true,
		returns: attachmentSchema,
		args: [attachmentCreate],
	})
	async create(
		input: AttachmentCreate,
		opts: ServiceOpts,
	): Promise<Attachment> {
		const run = async (tx: PrismaTx): Promise<Attachment> => {
			const scoped: ServiceOpts = { ...opts, tx };
			const filename = sanitizeFilename(input.filename);
			const mimeType = mimeFor(filename, input.mimeType ?? null);

			await this.assertWithinQuota(input.bytes.length, scoped);

			const blob = await this.blobs.create(
				{ bytes: input.bytes, contentHash: input.contentHash },
				{ tx, actor: SYSTEM },
			);
			await this.blobs.link(blob.hash, filename);

			return brand(
				await tx.attachment.create({
					data: {
						hash: blob.hash,
						filename,
						mimeType,
						uploaderUsername: input.uploaderUsername ?? null,
						ownerType: input.ownerType,
						ownerId: input.ownerId,
					},
				}),
			);
		};

		return opts.tx ? run(opts.tx) : this.prisma.$transaction((tx) => run(tx));
	}

	/** Finds a single attachment by id. */
	@Validate({
		async: true,
		returns: attachmentSchema.nullable(),
		args: [attachmentPK],
	})
	async findOne(
		filter: AttachmentPK,
		opts?: ServiceOpts,
	): Promise<Attachment | null> {
		const client = opts?.tx ?? this.prisma;
		const row = await client.attachment.findUnique({
			where: { id: filter.id },
		});
		return row && brand(row);
	}

	/** Finds many attachments, narrowed by any combination of the filter. */
	@Validate({
		async: true,
		returns: attachmentSchema.array(),
		args: [attachmentFilter],
	})
	async findMany(
		filter: AttachmentFilter,
		opts?: ServiceOpts,
	): Promise<Attachment[]> {
		const client = opts?.tx ?? this.prisma;
		const rows = await client.attachment.findMany({
			where: {
				AND: [
					filter.ids ? { id: { in: filter.ids } } : {},
					filter.hashes ? { hash: { in: filter.hashes } } : {},
					filter.ownerType ? { ownerType: filter.ownerType } : {},
					filter.ownerIds ? { ownerId: { in: filter.ownerIds } } : {},
					filter.uploaderUsername
						? { uploaderUsername: filter.uploaderUsername }
						: {},
				],
			},
		});
		return rows.map(brand);
	}

	/** Renames an attachment, relinking the blob's directory to match. */
	@Validate({
		service: true,
		returns: attachmentSchema,
		args: [attachmentPK, attachmentUpdate],
	})
	async update(
		filter: AttachmentPK,
		fields: AttachmentUpdate,
		opts: ServiceOpts,
	): Promise<Attachment> {
		const client = opts.tx ?? this.prisma;
		const target = await this.findOne(filter, opts);
		if (!target) {
			throw new Error("No attachment matches that filter.");
		}
		const filename = sanitizeFilename(fields.filename);
		if (filename === target.filename) {
			return target;
		}

		await this.blobs.link(target.hash, filename);
		const updated = brand(
			await client.attachment.update({
				where: { id: target.id },
				data: { filename },
			}),
		);

		const siblings = await client.attachment.count({
			where: { hash: target.hash, filename: target.filename },
		});
		if (siblings === 0) {
			await this.blobs.unlink(target.hash, target.filename);
		}

		return updated;
	}

	/**
	 * Detaches one use of a blob, unlinking its name once no sibling
	 * attachment shares it.
	 */
	@Validate({ service: true, args: [attachmentPK] })
	async delete(filter: AttachmentPK, opts: ServiceOpts): Promise<void> {
		const client = opts.tx ?? this.prisma;
		const target = await this.findOne(filter, opts);
		if (!target) {
			return;
		}
		await client.attachment.delete({ where: { id: target.id } });
		const siblings = await client.attachment.count({
			where: { hash: target.hash, filename: target.filename },
		});
		if (siblings === 0) {
			await this.blobs.unlink(target.hash, target.filename);
		}
	}

	/**
	 * Detaches every attachment of one owner, for that owner's own delete.
	 *
	 * SQLite cannot cascade a polymorphic reference, so an owner service that
	 * forgets this call leaks its attachments.
	 */
	async detachOwner(
		ownerType: AttachmentOwner,
		ownerId: number,
		opts: ServiceOpts,
	): Promise<number> {
		const client = opts.tx ?? this.prisma;
		const rows = await client.attachment.findMany({
			where: { ownerType, ownerId },
		});
		if (rows.length === 0) {
			return 0;
		}
		await client.attachment.deleteMany({ where: { ownerType, ownerId } });
		for (const row of rows) {
			const siblings = await client.attachment.count({
				where: { hash: row.hash, filename: row.filename },
			});
			if (siblings === 0) {
				await this.blobs.unlink(row.hash, row.filename);
			}
		}
		return rows.length;
	}

	/** Attachments of many owners at once, keyed by owner id, for stitching. */
	async forOwners(
		ownerType: AttachmentOwner,
		ownerIds: number[],
		opts?: ServiceOpts,
	): Promise<Map<number, Attachment[]>> {
		const client = opts?.tx ?? this.prisma;
		const rows = await client.attachment.findMany({
			where: { ownerType, ownerId: { in: ownerIds } },
		});
		const map = new Map<number, Attachment[]>();
		for (const raw of rows) {
			const row = brand(raw);
			const list = map.get(row.ownerId);
			if (list) {
				list.push(row);
			} else {
				map.set(row.ownerId, [row]);
			}
		}
		return map;
	}

	/**
	 * Bytes charged to a user: the sum of the sizes of the blobs their
	 * attachments point at.
	 *
	 * Charged per attachment rather than per distinct byte on disk, so dedupe
	 * lowers the server's real cost without lowering anyone's bill.
	 */
	async usageBytes(username: string, opts?: ServiceOpts): Promise<number> {
		const client = opts?.tx ?? this.prisma;
		const rows = await client.attachment.findMany({
			where: { uploaderUsername: username },
			include: { blob: true },
		});
		return rows.reduce((total, row) => total + row.blob.size, 0);
	}

	/** The quota a role is held to, `null` when it has none. */
	quotaFor(role: Role): number | null {
		return BLOB_QUOTA_BY_ROLE[role];
	}

	/**
	 * Throws `NotAllowed` when storing `additionalBytes` would put the actor
	 * over their role's quota.
	 */
	async assertWithinQuota(
		additionalBytes: number,
		opts: ServiceOpts,
	): Promise<void> {
		if (opts.actor === SYSTEM) {
			return;
		}
		const quota = this.quotaFor(opts.actor.role);
		if (quota === null) {
			return;
		}
		const usage = await this.usageBytes(opts.actor.username, opts);
		if (usage + additionalBytes > quota) {
			throw new NotAllowed({ action: "create-attachment" });
		}
	}
}

export const attachmentService = new AttachmentService();
