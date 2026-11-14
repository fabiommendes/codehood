import type { z } from "zod";
import { SYSTEM, type UserActor } from "@/auth/actor";
import { BLOB_QUOTA_BY_ROLE } from "@/core/constants";
import { NotAllowed, NotFound } from "@/core/error";
import type {
	ExamId,
	QuestionRefId,
	ReportId,
	RepositoryId,
} from "@/core/schemas";
import {
	attachmentAttach,
	attachmentCreate,
	attachmentFilter,
	attachmentPK,
	attachmentSchema,
	type attachmentToType,
	attachmentUpdate,
} from "@/core/schemas";
import type { ServiceOptsWithoutTx } from "@/db/base-service";
import { rejectExpectedUpdatedAt, touch } from "@/db/conditional-write";
import { defineService, op } from "@/db/define-service";
import { hashBytes } from "@/utils/content-hash";
import { sanitizeFilename } from "@/utils/filename";
import { mimeFor } from "@/utils/mime";
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
export type AttachmentAttach = z.infer<typeof attachmentAttach>;
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

/// The CRUD shape of the attachment service. `upsert` is off: `create` and
/// `attach` already de-duplicate on hash, filename and owner.
type AttachmentT = {
	entity: Attachment;
	pkFilter: AttachmentPK;
	create: AttachmentCreate;
	filter: AttachmentFilter;
	update: AttachmentUpdate;
	upsert: false;
};

/**
 * The attachment service of `client` (the shared client by default), over the
 * bytes `blob` stores.
 *
 * The ledger over blob storage: who uses which bytes, under what name, and
 * who is charged for them.
 *
 * Not routed.
 */
export function makeAttachmentService(
	blob: BlobService,
	client: PrismaClient = prisma,
) {
	/// The public shape of `raw`, attached to `attached`.
	function fromDb(
		raw: DbAttachment,
		attached: Attachment["attachedTo"],
	): Attachment {
		return {
			id: raw.id,
			hash: raw.hash,
			filename: raw.filename,
			size: raw.blob.size,
			link: blob.attachmentPath(raw.hash, raw.filename),
			mimeType: raw.mimeType,
			uploader: raw.uploader
				? { username: raw.uploader.username, name: raw.uploader.name }
				: null,
			attachedTo: attached,
			createdAt: raw.createdAt,
		};
	}

	/// `null` for an attachment whose owner is gone.
	async function fromDbWithSource(raw: DbAttachment, tx: PrismaTx) {
		const source = await attachmentSource(raw, tx);
		return source && fromDb(raw, source);
	}

	/// An attachment just written for `raw.attachedTo`, which must exist.
	async function ownedOrNotFound(raw: DbAttachment, tx: PrismaTx) {
		const attachment = await fromDbWithSource(raw, tx);
		if (!attachment) {
			throw new NotFound(raw.attachedToType.toLowerCase(), {
				id: raw.attachedToId,
			});
		}
		return attachment;
	}

	/// Moves the version of the resource whose current file is `raw`: its read
	/// model shows the file's name, and loses the file when it is deleted. A
	/// resource that already points elsewhere (or is gone) is not touched. A
	/// report lists its files by name too, so a rename moves its version.
	async function touchResource(
		tx: PrismaTx,
		raw: { id: number; attachedToType: string; attachedToId: number },
	): Promise<void> {
		if (raw.attachedToType === "REPORT") {
			const report = await tx.report.findUnique({
				where: { id: raw.attachedToId as ReportId },
				select: { id: true },
			});
			if (report) await touch(tx, "report", { id: report.id }, {});
			return;
		}
		if (raw.attachedToType !== "RESOURCE") return;
		const resource = await tx.resource.findFirst({
			where: { id: raw.attachedToId, attachmentId: raw.id },
			select: { id: true },
		});
		if (resource) await touch(tx, "resource", { id: resource.id }, {});
	}

	async function fromDbWithSources(raw: DbAttachment[], tx: PrismaTx) {
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

		// Attachments whose owner is gone are left out.
		const results: Attachment[] = [];
		for (const r of raw) {
			if (r.attachedToType === "RESOURCE") {
				const resource = resourceMap[r.attachedToId];
				if (resource) results.push(fromDb(r, resource));
				continue;
			}

			// Any other owner is resolved one by one.
			const source = await attachmentSource(r, tx);
			if (source) results.push(fromDb(r, source));
		}
		return results;
	}

	async function attachmentSource(
		raw: DbAttachment,
		tx: PrismaTx,
	): Promise<Attachment["attachedTo"] | null> {
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
				return resource && { ...resource, type: "RESOURCE" };
			}
			case "QUESTION": {
				const question = await tx.questionRef.findUnique({
					where: { id: raw.attachedToId as QuestionRefId },
					select: {
						id: true,
						slug: true,
						latest: { select: { title: true } },
					},
				});
				return (
					question && {
						type: "QUESTION",
						id: question.id,
						slug: question.slug,
						title: question.latest?.title ?? question.slug,
					}
				);
			}
			case "EXAM": {
				const exam = await tx.exam.findUnique({
					where: { id: raw.attachedToId as ExamId },
					select: { id: true, slug: true, title: true },
				});
				return exam && { type: "EXAM", ...exam };
			}
			case "REPORT": {
				const report = await tx.report.findUnique({
					where: { id: raw.attachedToId as ReportId },
					select: { id: true, publicId: true },
				});
				return report && { ...report, type: "REPORT" };
			}
			case "REPOSITORY": {
				const repository = await tx.repository.findUnique({
					where: { id: raw.attachedToId as RepositoryId },
					select: { id: true, slug: true },
				});
				if (!repository) return null;
				return {
					type: "REPOSITORY",
					id: repository.id,
					slug: repository.slug,
				};
			}
		}
	}

	/**
	 * The quota a role is held to, `null` when it has none.
	 * */
	function quotaFor(role: Role): number | null {
		return BLOB_QUOTA_BY_ROLE[role];
	}

	const ops = defineService<AttachmentT>()(() => {
		/**
		 * Stores the bytes, sanitises the filename, derives the mime type and
		 * records the use, all in one transaction.
		 *
		 * The stored filename is returned, which is not always the one sent.
		 *
		 * `uploaderId` in `input` is only honoured for `SYSTEM` calls, which have
		 * no actor to derive it from; a `SYSTEM` call without it is rejected. Any
		 * other caller has it derived from `opts.actor` and silently ignored if
		 * sent.
		 */
		const create = op({
			args: [attachmentCreate],
			returns: attachmentSchema,
			run: async (
				tx: PrismaTx,
				input: AttachmentCreate,
				opts: ServiceOptsWithoutTx,
			): Promise<Attachment> => {
				rejectExpectedUpdatedAt(opts);
				const filename = sanitizeFilename(input.filename);
				const mimeType = mimeFor(filename);

				const duplicate = await tx.attachment.findFirst({
					where: {
						hash: hashBytes(input.buffer),
						filename,
						attachedToType: input.attachedTo.type,
						attachedToId: input.attachedTo.id,
					},
					include: attachmentInclude,
				});
				if (duplicate) return ownedOrNotFound(duplicate, tx);

				await assertWithinQuota(tx, input.buffer.length, opts);

				const stored = await blob.create(
					{ bytes: input.buffer },
					{ tx, actor: SYSTEM },
				);
				await blob.link(stored.hash, filename);
				const uploaderId =
					opts.actor === SYSTEM
						? (input.uploaderId ?? null)
						: opts.actor.username;

				return ownedOrNotFound(
					await tx.attachment.create({
						data: {
							hash: stored.hash,
							filename,
							mimeType,
							uploaderId,
							attachedToType: input.attachedTo.type,
							attachedToId: input.attachedTo.id,
						},
						include: attachmentInclude,
					}),
					tx,
				);
			},
		});

		/**
		 * Finds a single attachment by id.
		 */
		const findOne = op({
			transaction: false,
			args: [attachmentPK],
			returns: attachmentSchema.nullable(),
			run: async (
				tx: PrismaTx,
				filter: AttachmentPK,
				_opts: ServiceOptsWithoutTx,
			): Promise<Attachment | null> => {
				const row = await tx.attachment.findUnique({
					where: { id: filter.id },
					include: attachmentInclude,
				});

				return row && fromDbWithSource(row, tx);
			},
		});

		/**
		 * Finds many attachments, narrowed by any combination of the filter.
		 */
		const findMany = op({
			transaction: false,
			args: [attachmentFilter],
			returns: attachmentSchema.array(),
			run: async (
				tx: PrismaTx,
				filter: AttachmentFilter,
				_opts: ServiceOptsWithoutTx,
			): Promise<Attachment[]> => {
				const rows = await tx.attachment.findMany({
					where: {
						AND: [
							filter.ids ? { id: { in: filter.ids } } : {},
							filter.hashes ? { hash: { in: filter.hashes } } : {},
							filter.type ? { attachedToType: filter.type } : {},
							filter.attachedTo
								? { attachedToId: { in: filter.attachedTo } }
								: {},
							filter.uploader ? { uploaderId: filter.uploader } : {},
						],
					},
					include: attachmentInclude,
				});

				return fromDbWithSources(rows, tx);
			},
		});

		/**
		 * Renames an attachment, relinking the blob's directory to match.
		 */
		const update = op({
			args: [attachmentPK, attachmentUpdate],
			returns: attachmentSchema,
			run: async (
				tx: PrismaTx,
				filter: AttachmentPK,
				fields: AttachmentUpdate,
				opts: ServiceOptsWithoutTx,
			): Promise<Attachment> => {
				rejectExpectedUpdatedAt(opts);
				const target = await findOne(tx, filter, opts);
				if (!target) throw new NotFound("attachment", { id: filter.id });

				const filename = sanitizeFilename(fields.filename);
				if (filename === target.filename) return target;

				await blob.link(target.hash, filename);

				const updated = await tx.attachment.update({
					where: { id: target.id },
					data: { filename },
					include: attachmentInclude,
				});
				await touchResource(tx, updated);

				const sameName = await tx.attachment.count({
					where: { hash: target.hash, filename: target.filename },
				});
				if (sameName === 0) {
					await blob.unlink(target.hash, target.filename);
				}

				return fromDb(updated, target.attachedTo);
			},
		});

		/**
		 * Detaches one use of a blob.
		 *
		 * Unlink its name once no sibling attachment shares it.
		 */
		const remove = op({
			args: [attachmentPK],
			run: async (
				tx: PrismaTx,
				filter: AttachmentPK,
				opts: ServiceOptsWithoutTx,
			): Promise<void> => {
				rejectExpectedUpdatedAt(opts);
				// The raw row, not `findOne`: an owner deleted first must not block this.
				const target = await tx.attachment.findUnique({
					where: { id: filter.id },
				});
				if (!target) return;

				// Before the delete, which clears the resource's link to it.
				await touchResource(tx, target);
				await tx.attachment.delete({ where: { id: target.id } });

				const sameName = await tx.attachment.count({
					where: { hash: target.hash, filename: target.filename },
				});
				if (sameName === 0) {
					await blob.unlink(target.hash, target.filename);
				}

				// Tombstone the blob once nothing (under any name) still points at
				// it, so a stale `/files/<hash>` URL keeps explaining itself (410)
				// rather than going flatly 404.
				const anyName = await tx.attachment.count({
					where: { hash: target.hash },
				});
				if (anyName === 0) {
					await blob.delete(
						{ hash: target.hash },
						{ ...opts, tx, actor: SYSTEM },
					);
				}
			},
		});

		/**
		 * Detaches every attachment for a attachedTo entity.
		 *
		 * SQLite cannot cascade a polymorphic reference, so an owner service that
		 * forgets this call leaks its attachments.
		 */
		const detach = op({
			run: async (
				tx: PrismaTx,
				type: AttachmentToType,
				attachedToId: number,
				opts: ServiceOptsWithoutTx,
			): Promise<{ deleted: number }> => {
				rejectExpectedUpdatedAt(opts);
				const rows = await tx.attachment.findMany({
					where: { attachedToType: type, attachedToId },
				});

				if (rows.length === 0) return { deleted: 0 };

				const deleted = await tx.attachment.deleteMany({
					where: { attachedToType: type, attachedToId },
				});

				for (const row of rows) {
					const siblings = await tx.attachment.count({
						where: { hash: row.hash, filename: row.filename },
					});

					if (siblings === 0) {
						await blob.unlink(row.hash, row.filename);
					}
				}

				return { deleted: deleted.count };
			},
		});

		/**
		 * Records one more use of a blob already stored, without its bytes.
		 *
		 * Sanitises the filename, derives the mime type and links the name beside
		 * the bytes, like `create`. An attachment with the same hash, filename and
		 * owner is returned as is. The uploader follows the rules of `create`: a
		 * `SYSTEM` call without `uploaderId` charges nobody, so its bytes count in
		 * no quota.
		 *
		 * @throws {@link NotFound} If no live blob has `input.hash`.
		 * @throws {@link NotAllowed} If the bytes would put the actor over quota.
		 */
		const attach = op({
			args: [attachmentAttach],
			returns: attachmentSchema,
			run: async (
				tx: PrismaTx,
				input: AttachmentAttach,
				opts: ServiceOptsWithoutTx,
			): Promise<Attachment> => {
				rejectExpectedUpdatedAt(opts);
				const stored = await tx.blob.findUnique({
					where: { hash: input.hash },
				});
				if (!stored || stored.deletedAt) {
					throw new NotFound("blob", { id: input.hash });
				}

				const filename = sanitizeFilename(input.filename);
				const duplicate = await tx.attachment.findFirst({
					where: {
						hash: stored.hash,
						filename,
						attachedToType: input.attachedTo.type,
						attachedToId: input.attachedTo.id,
					},
					include: attachmentInclude,
				});
				if (duplicate) return ownedOrNotFound(duplicate, tx);

				await assertWithinQuota(tx, stored.size, opts);
				await blob.link(stored.hash, filename);
				const uploaderId =
					opts.actor === SYSTEM
						? (input.uploaderId ?? null)
						: opts.actor.username;

				return ownedOrNotFound(
					await tx.attachment.create({
						data: {
							hash: stored.hash,
							filename,
							mimeType: mimeFor(filename),
							uploaderId,
							attachedToType: input.attachedTo.type,
							attachedToId: input.attachedTo.id,
						},
						include: attachmentInclude,
					}),
					tx,
				);
			},
		});

		/**
		 * Attachments of a specific resource.
		 */
		const allAttachedTo = op({
			transaction: false,
			run: async (
				tx: PrismaTx,
				resource: Attachment["attachedTo"],
				_opts: ServiceOptsWithoutTx,
			): Promise<Attachment[]> => {
				const rows = await tx.attachment.findMany({
					where: { attachedToType: resource.type, attachedToId: resource.id },
					include: attachmentInclude,
				});

				return rows.map((raw) => fromDb(raw, resource));
			},
		});

		/**
		 * Bytes charged to a user
		 *
		 * The sum of the sizes of the blobs their attachments point at.
		 *
		 * Charged per attachment rather than per distinct byte on disk, so dedupe
		 * lowers the server's real cost without lowering anyone's bill.
		 */
		const usageBytes = op({
			transaction: false,
			run: async (
				tx: PrismaTx,
				username: string,
				_opts: ServiceOptsWithoutTx,
			): Promise<number> => {
				const rows = await tx.attachment.findMany({
					where: { uploaderId: username },
					include: { blob: true },
				});

				return rows.reduce((total, row) => total + row.blob.size, 0);
			},
		});

		/**
		 * Throws `NotAllowed` when storing `additionalBytes` would put the actor
		 * over their role's quota.
		 */
		const assertWithinQuota = op({
			transaction: false,
			run: async (
				tx: PrismaTx,
				additionalBytes: number,
				opts: ServiceOptsWithoutTx,
			): Promise<void> => {
				if (opts.actor === SYSTEM) {
					return;
				}
				const quota = quotaFor((opts.actor as UserActor).role);
				if (quota === null) return;

				const usage = await usageBytes(
					tx,
					(opts.actor as UserActor).username,
					opts,
				);

				if (usage + additionalBytes > quota) {
					throw new NotAllowed("attachment.create");
				}
			},
		});

		return {
			create,
			findOne,
			findMany,
			update,
			delete: remove,
			attach,
			detach,
			allAttachedTo,
			usageBytes,
			assertWithinQuota,
		};
	})(client);

	return { ...ops, quotaFor };
}

/** The attachment service, as built by {@link makeAttachmentService}. */
export type AttachmentService = ReturnType<typeof makeAttachmentService>;
