import type { z } from "zod";
import { SYSTEM, type UserActor } from "@/auth/actor";
import { BLOB_QUOTA_BY_ROLE } from "@/core/constants";
import { NotAllowed, NotFound } from "@/core/error";
import {
	attachmentCreate,
	attachmentFilter,
	attachmentPK,
	attachmentSchema,
	type attachmentToType,
	attachmentUpdate,
} from "@/core/schemas";
import type { ServiceOpts } from "@/db";
import { sanitizeFilename } from "@/utils/filename";
import { mimeFor } from "@/utils/mime";
import { Validate } from "@/utils/validate";
import {
	type Prisma,
	type PrismaClient,
	type PrismaTx,
	prisma,
	type Role,
} from "../client";
import type { BlobService } from "./blob.service";
import type { ResourceId } from "./resource.service";

export type { AttachmentId } from "@/core/schemas";

//
// Type definitions
//
export type Attachment = z.infer<typeof attachmentSchema>;
export type AttachmentCreate = z.infer<typeof attachmentCreate>;
export type AttachmentFilter = z.infer<typeof attachmentFilter>;
export type AttachmentPK = z.infer<typeof attachmentPK>;
export type AttachmentUpdate = z.infer<typeof attachmentUpdate>;
export type AttachmentToType = z.infer<typeof attachmentToType>;

type DbAttachment = Prisma.AttachmentGetPayload<{
	include: typeof attachmentInclude;
}>;

/** The minimal course shape the write/read predicates need, loaded alongside every row. */
const attachmentInclude = {
	blob: {
		select: {
			size: true,
		},
	},
	uploader: {
		select: {
			username: true,
			name: true,
		},
	},
} satisfies Prisma.AttachmentInclude;

/**
 * The ledger over blob storage: who uses which bytes, under what name, and
 * who is charged for them.
 *
 * Not routed. See `dev/specs/to-do/blob-attachments.md`.
 */
export class AttachmentService {
	private prisma: PrismaClient;
	private blob: BlobService;

	constructor(blob: BlobService, client: PrismaClient = prisma) {
		this.prisma = client;
		this.blob = blob;
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
	async create(
		input: AttachmentCreate,
		opts: ServiceOpts,
	): Promise<Attachment> {
		const run = async (tx: PrismaTx): Promise<Attachment> => {
			const scoped: ServiceOpts = { ...opts, tx };
			const filename = sanitizeFilename(input.filename);
			const mimeType = mimeFor(filename);

			await this.assertWithinQuota(input.buffer.length, scoped);

			const blob = await this.blob.create(
				{ bytes: input.buffer },
				{ tx, actor: SYSTEM },
			);
			await this.blob.link(blob.hash, filename);
			const username = opts.actor === SYSTEM ? null : opts.actor.username;

			return this.fromDbWithSource(
				await tx.attachment.create({
					data: {
						hash: blob.hash,
						filename,
						mimeType,
						uploaderId: input.uploaderId ?? username,
						attachedToType: input.attachedTo.type,
						attachedToId: input.attachedTo.id,
					},
					include: attachmentInclude,
				}),
				tx,
			);
		};

		return opts.tx ? run(opts.tx) : this.prisma.$transaction((tx) => run(tx));
	}

	/**
	 * Finds a single attachment by id.
	 */
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
			include: attachmentInclude,
		});

		return row && this.fromDbWithSource(row, client);
	}

	/**
	 * Finds many attachments, narrowed by any combination of the filter.
	 */
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
					filter.type ? { attachedToType: filter.type } : {},
					filter.attachedTo ? { attachedToId: { in: filter.attachedTo } } : {},
					filter.uploader ? { uploaderId: filter.uploader } : {},
				],
			},
			include: attachmentInclude,
		});

		return this.fromDbWithSources(rows, client);
	}

	/**
	 * Renames an attachment, relinking the blob's directory to match.
	 */
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
		if (!target) throw new NotFound("attachment", { id: filter.id });

		const filename = sanitizeFilename(fields.filename);
		if (filename === target.filename) return target;

		await this.blob.link(target.hash, filename);

		const updated = await client.attachment.update({
			where: { id: target.id },
			data: { filename },
			include: attachmentInclude,
		});

		const sameName = await client.attachment.count({
			where: { hash: target.hash, filename: target.filename },
		});
		if (sameName === 0) {
			await this.blob.unlink(target.hash, target.filename);
		}

		return this.fromDb(updated, target.attachedTo);
	}

	/**
	 * Detaches one use of a blob.
	 *
	 * Unlink its name once no sibling attachment shares it.
	 */
	@Validate({ service: true, args: [attachmentPK] })
	async delete(filter: AttachmentPK, opts: ServiceOpts): Promise<void> {
		const client = opts.tx ?? this.prisma;

		const target = await this.findOne(filter, opts);
		if (!target) return;

		await client.attachment.delete({ where: { id: target.id } });

		const sameName = await client.attachment.count({
			where: { hash: target.hash, filename: target.filename },
		});
		if (sameName === 0) {
			await this.blob.unlink(target.hash, target.filename);
		}

		// Tombstone the blob once nothing (under any name) still points at
		// it, so a stale `/files/<hash>` URL keeps explaining itself (410)
		// rather than going flatly 404.
		const anyName = await client.attachment.count({
			where: { hash: target.hash },
		});
		if (anyName === 0) {
			await this.blob.delete({ hash: target.hash }, opts);
		}
	}

	/**
	 * Detaches every attachment for a attachedTo entity.
	 *
	 * SQLite cannot cascade a polymorphic reference, so an owner service that
	 * forgets this call leaks its attachments.
	 */
	async detach(
		type: AttachmentToType,
		attachedToId: number,
		opts: ServiceOpts,
	): Promise<{ deleted: number }> {
		const client = opts.tx ?? this.prisma;

		const rows = await client.attachment.findMany({
			where: { attachedToType: type, attachedToId },
		});

		if (rows.length === 0) return { deleted: 0 };

		const deleted = await client.attachment.deleteMany({
			where: { attachedToType: type, attachedToId },
		});

		for (const row of rows) {
			const siblings = await client.attachment.count({
				where: { hash: row.hash, filename: row.filename },
			});

			if (siblings === 0) {
				await this.blob.unlink(row.hash, row.filename);
			}
		}

		return { deleted: deleted.count };
	}

	/**
	 * Attachments of a specific resource.
	 */
	async allAttachedTo(
		resource: Attachment["attachedTo"],
		opts?: ServiceOpts,
	): Promise<Attachment[]> {
		const client = opts?.tx ?? this.prisma;

		const rows = await client.attachment.findMany({
			where: { attachedToType: resource.type, attachedToId: resource.id },
			include: attachmentInclude,
		});

		return rows.map((raw) => this.fromDb(raw, resource));
	}

	/**
	 * Bytes charged to a user
	 *
	 * The sum of the sizes of the blobs their attachments point at.
	 *
	 * Charged per attachment rather than per distinct byte on disk, so dedupe
	 * lowers the server's real cost without lowering anyone's bill.
	 */
	async usageBytes(username: string, opts?: ServiceOpts): Promise<number> {
		const client = opts?.tx ?? this.prisma;

		const rows = await client.attachment.findMany({
			where: { uploaderId: username },
			include: { blob: true },
		});

		return rows.reduce((total, row) => total + row.blob.size, 0);
	}

	/**
	 * The quota a role is held to, `null` when it has none.
	 * */
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
		const quota = this.quotaFor((opts.actor as UserActor).role);
		if (quota === null) return;

		const usage = await this.usageBytes(
			(opts.actor as UserActor).username,
			opts,
		);

		if (usage + additionalBytes > quota) {
			throw new NotAllowed("attachment.create");
		}
	}

	private fromDb(
		raw: DbAttachment,
		attached: Attachment["attachedTo"],
	): Attachment {
		return {
			id: raw.id,
			hash: raw.hash,
			filename: raw.filename,
			size: raw.blob.size,
			link: this.blob.attachmentPath(raw.hash, raw.filename),
			mimeType: raw.mimeType,
			uploader: raw.uploader
				? { username: raw.uploader.username, name: raw.uploader.name }
				: null,
			attachedTo: attached,
			createdAt: raw.createdAt,
		};
	}

	private async fromDbWithSource(raw: DbAttachment, tx: PrismaTx) {
		return this.fromDb(raw, await this.attachmentSource(raw, tx));
	}

	private async fromDbWithSources(raw: DbAttachment[], tx: PrismaTx) {
		// TODO: Read all question attachments in a single query to avoid N+1 queries

		// Read all resource attachments in a single query to avoid N+1 queries
		const resources = await tx.resource.findMany({
			where: {
				id: {
					in: raw
						.filter((r) => r.attachedToType === "RESOURCE")
						.map((r) => r.attachedToId),
				},
			},
			select: {
				id: true,
				title: true,
				slug: true,
			},
		});
		const resourceMap = Object.fromEntries(
			resources.map((r) => [r.id, { ...r, type: "RESOURCE" as const }]),
		);

		// Collect all attachments with their associated resources
		const results: Attachment[] = [];
		for (const r of raw) {
			const resource = resourceMap[r.attachedToId];
			if (resource) {
				results.push(this.fromDb(r, resource));
				continue;
			}

			// If the attachment is not associated with a resource, we skip it for now.
			throw new Error(
				`Attachment with ID ${r.id} is not associated with a known resource`,
			);
		}
		return results;
	}

	private async attachmentSource(
		raw: DbAttachment,
		tx: PrismaTx,
	): Promise<Attachment["attachedTo"]> {
		switch (raw.attachedToType) {
			case "RESOURCE": {
				const resource = await tx.resource.findUnique({
					where: { id: raw.attachedToId as ResourceId },
					select: {
						id: true,
						title: true,
						slug: true,
					},
				});
				if (!resource) {
					throw new Error(`Resource with ID ${raw.attachedToId} not found`);
				}
				return { ...resource, type: "RESOURCE" };
			}
			case "QUESTION": {
				throw new Error("Question support is not yet implemented");
			}
		}
	}
}
