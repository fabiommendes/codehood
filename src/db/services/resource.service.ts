import type { z } from "zod";
import { SYSTEM } from "@/auth/actor";
import { hasPerm } from "@/auth/permissions";
import { type ActionCode, NotAllowed, NotFound } from "@/core/error";
import {
	type CourseId,
	type courseNaturalKey,
	resourceCreate,
	resourceFilter,
	resourcePK,
	resourceSchema,
	resourceUpdate,
	resourceUpsert,
} from "@/core/schemas";
import { db } from "@/db";
import { type Crud, type ServiceOpts, upsert } from "@/db/base-service";
import type { FillUndefineds, Pretty } from "@/typing";
import { Validate } from "@/utils/validate";
import {
	type Prisma,
	type PrismaClient,
	type PrismaTx,
	prisma,
} from "../client";
import {
	courseRefWhere,
	ensureAllowed,
	valueOrNotAllowed,
	valueOrNotFound,
} from "../utils";
import type { Attachment, AttachmentService } from "./attachment.service";
import { courseContentsWhere } from "./course.service";

export type { ResourceId } from "@/core/schemas";

//
// Type definitions
//
export type ResourceCreate = z.infer<typeof resourceCreate>;
export type Resource = z.infer<typeof resourceSchema>;
export type ResourceFilter = z.infer<typeof resourceFilter>;
export type ResourcePK = z.infer<typeof resourcePK>;
export type ResourceUpdate = z.infer<typeof resourceUpdate>;
export type ResourceUpsert = z.infer<typeof resourceUpsert>;
type CourseRef = z.infer<typeof courseNaturalKey>;

type DbResource = Prisma.ResourceGetPayload<{
	include: Pretty<typeof resourceInclude>;
}>;

/** The minimal course shape the write/read predicates need, loaded alongside every row. */
const resourceInclude = {
	course: {
		select: {
			instructor: { select: { username: true } },
			enrollments: { select: { username: true } },
		},
	},
	attachment: {
		select: {
			id: true,
			hash: true,
			filename: true,
			mimeType: true,
		},
	},
} satisfies Prisma.ResourceInclude;

export class ResourceService
	implements
		Crud<{
			entity: Resource;
			pkFilter: ResourcePK;
			create: ResourceCreate;
			filter: ResourceFilter;
			update: ResourceUpdate;
			upsert: ResourceUpsert;
		}>
{
	prisma: PrismaClient;
	attachment: AttachmentService;

	constructor(attachment: AttachmentService, client: PrismaClient = prisma) {
		this.prisma = client;
		this.attachment = attachment;
	}

	/**
	 * Creates a resource.
	 *
	 * It automatically create the blobs and attachment for FILE resources.
	 */
	@Validate({
		service: true,
		returns: resourceSchema,
		args: [resourceCreate],
	})
	async create(input: ResourceCreate, opts: ServiceOpts): Promise<Resource> {
		const self = this;

		async function run(tx: PrismaTx) {
			const course = await self.courseInfo(input.courseId, {
				actor: opts.actor,
				action: "resource.create",
				perms: "write",
				tx,
			});

			const row = await tx.resource.create({
				data: {
					courseId: course.id,
					slug: input.slug,
					type: input.data.type,
					title: input.title,
					description: input.description,
					data: self.toRawData(input.data),
					extra: self.toRawExtra(input.data),

					// We set attachment to null and then use the attachment
					// service to create the real Attachment and Blob
					attachmentId: null,
					ref: input.ref,
				},
				include: resourceInclude,
			});

			// Create attachment now that we have the row id.
			if (input.data.type === "FILE") {
				const attachment = await self.attachment.create(
					{
						attachedTo: { type: "RESOURCE", id: row.id },
						filename: input.data.filename,
						uploaderId: course.instructor.username,
						buffer: input.data.buffer,
					},
					{ tx, actor: opts.actor },
				);

				// The row above was created with `attachmentId: null` since the
				// attachment can't exist before the resource's own id does — link
				// it back now, or every re-fetch after this one finds no
				// attachment and falls back to `fillData`'s "corrupted-file" stub.
				await tx.resource.update({
					where: { id: row.id },
					data: { attachmentId: attachment.id },
				});

				row.attachment = {
					id: attachment.id,
					hash: attachment.hash,
					filename: attachment.filename,
					mimeType: attachment.mimeType,
				};
			}

			return row && fromDb(row);
		}

		return opts.tx ? run(opts.tx) : run(this.prisma);
	}

	/**
	 * Finds a resource by id or by its `(courseId, slug)` natural key.
	 *
	 * Throws `FORBIDDEN` if it exists but `actor` may not see its course's
	 * contents (see the `course.read-contents` permission); returns `null` if
	 * it does not exist.
	 */
	async findOne(
		filter: ResourcePK,
		opts: ServiceOpts & { skipValidation: { output: true } },
	): Promise<(Resource & { __raw: DbResource }) | null>;

	async findOne(
		filter: ResourcePK,
		opts: ServiceOpts extends { skipValidation: { output: true } }
			? never
			: ServiceOpts,
	): Promise<Resource | null>;

	@Validate({
		service: true,
		returns: resourceSchema.nullable(),
		args: [resourcePK],
	})
	async findOne(
		filter: ResourcePK,
		opts: ServiceOpts,
	): Promise<(Resource & { __raw?: DbResource }) | null> {
		const self = this;

		async function run(tx: PrismaTx) {
			let by = filter as FillUndefineds<ResourcePK>;
			let row: DbResource | null = null;

			// Must search the course in the database if search is given by natural
			// key
			if (by.discipline !== undefined) {
				by = { courseId: await self.courseId(by, tx), slug: by.slug };
			}

			// filter by resource id
			if (by.id !== undefined) {
				row = await tx.resource.findUnique({
					where: { id: by.id },
					include: resourceInclude,
				});

				// filter by courseId and resource slug
			} else if (by.courseId !== undefined) {
				row = await tx.resource.findUnique({
					where: { courseId_slug: { courseId: by.courseId, slug: by.slug } },
					include: resourceInclude,
				});
			} else {
				throw new Error(
					"Invalid resource filter: must specify either id or courseId and slug",
				);
			}

			if (!row) return null;

			ensureAllowed({
				value: row.course,
				action: "resource.read",
				pred: (course) => hasPerm(opts.actor, "course.read-contents", course),
			});

			return fromDb(row, { __raw: row });
		}

		return opts.tx ? run(opts.tx) : run(this.prisma);
	}

	/**
	 * Lists resources narrowed to what `actor` may see.
	 *
	 * See the `course.read-contents` permission: an admin or the course's own
	 * instructor sees everything, an actively enrolled student sees the
	 * course's resources, everyone else sees none.
	 *
	 * Use {@link groupResourcesByType} on the result to build the page's
	 * four sections.
	 */
	@Validate({
		service: true,
		returns: resourceSchema.array(),
		args: [resourceFilter],
	})
	async findMany(
		filter: ResourceFilter,
		opts: ServiceOpts,
	): Promise<Resource[]> {
		const self = this;

		async function run(tx: PrismaTx) {
			const course = await self.courseInfo(filter, {
				tx,
				actor: opts.actor,
				action: "resource.read",
				perms: "read",
			});

			const rows = await tx.resource.findMany({
				where: {
					AND: [
						course
							? { courseId: course.id }
							: { course: courseContentsWhere(opts.actor) },
						filter.types ? { type: { in: filter.types } } : {},
						filter.slugs ? { slug: { in: filter.slugs } } : {},
					],
				},
				include: resourceInclude,
				orderBy: { title: "asc" },
			});
			for (const row of rows) {
				if (!hasPerm(opts.actor, "course.read-contents", row.course)) {
					throw new NotAllowed("resource.read");
				}
			}
			return rows.map(fromDb);
		}

		return opts.tx ? run(opts.tx) : this.prisma.$transaction(run);
	}

	/**
	 * Updates everything but `slug` and `courseId`.
	 *
	 * `manage import-resources` uses this to update an existing row in
	 * place when re-pushing an unchanged slug. Re-validates the merged
	 * shape, so switching a resource's `type` (unusual, but not refused)
	 * cannot leave it in an invalid one.
	 */
	@Validate({
		service: true,
		returns: resourceSchema,
		args: [resourcePK, resourceUpdate],
	})
	async update(
		filter: ResourcePK,
		fields: ResourceUpdate,
		opts: ServiceOpts,
	): Promise<Resource> {
		const self = this;

		async function run(tx: PrismaTx) {
			const target = valueOrNotFound(
				"resource",
				await self.findOne(filter, {
					tx,
					actor: opts.actor,
					skipValidation: { output: true },
				}),
			);
			const course = target.__raw.course;

			ensureAllowed({
				value: target.__raw.course,
				action: "resource.read",
				pred: (course) => hasPerm(opts.actor, "course.update-contents", course),
			});

			// Update attachment, if necessary
			let attachment:
				| Pick<Attachment, "id" | "hash" | "filename" | "mimeType">
				| undefined;
			if (fields.data?.type === "FILE") {
				const row = await self.attachment.create(
					{
						attachedTo: { type: "RESOURCE", id: target.id },
						filename: fields.data.filename,
						uploaderId: course.instructor.username,
						buffer: fields.data.buffer,
					},
					{ tx, actor: opts.actor },
				);
				attachment = {
					id: row.id,
					hash: row.hash,
					filename: row.filename,
					mimeType: row.mimeType,
				};
			}

			const row = await tx.resource.update({
				where: { id: target.id },
				data: {
					type: fields.data?.type,
					title: fields.title,
					description: fields.description,
					data: fields.data ? self.toRawData(fields.data) : undefined,
					extra: fields.data ? self.toRawExtra(fields.data) : undefined,
					attachmentId: attachment?.id,
					ref: fields.ref,
				},
				include: resourceInclude,
			});
			row.attachment = attachment ?? null;
			return fromDb(row);
		}

		return opts.tx ? run(opts.tx) : this.prisma.$transaction(run);
	}

	/**
	 * Upserts a resource keyed on `{courseId | courseRef, slug}`.
	 *
	 * PUT semantics: gated on the `course.update-contents` permission whether
	 * creating or updating, same as `create`/`update`; the shape-by-type check
	 * ({@link validateResourceShape}) re-runs on whichever branch fires.
	 */
	@Validate({
		service: true,
		returns: resourceSchema,
		args: [resourceUpsert],
	})
	async upsert(input: ResourceUpsert, opts: ServiceOpts): Promise<Resource> {
		const self = this;

		return upsert(this, input, {
			...opts,
			action: "resource.create",
			pk({ slug, courseId }) {
				return (
					typeof courseId === "number"
						? { slug, courseId }
						: { slug, ...courseId }
				) satisfies ResourcePK;
			},
			async assertCreatable(input, opts) {
				const course = await self.courseInfo(input.courseId, opts);
				if (!hasPerm(opts.actor, "course.update-contents", course))
					throw new NotAllowed("resource.create");
			},
		});
	}

	/**
	 * Removes the resource row outright.
	 *
	 * If it pointed at an `Attachment`, releases that reference:
	 * `AttachmentService.delete` only reaches the disk once the last resource
	 * pointing at the blob is gone, since content addressing means another
	 * course may still share it.
	 */
	@Validate({ service: true, args: [resourcePK] })
	async delete(filter: ResourcePK, opts: ServiceOpts): Promise<void> {
		const self = this;

		async function run(tx: PrismaTx) {
			const target = await self.findOne(filter, opts);

			if (!target) throw new NotFound("resource");

			const current = await tx.resource.findUnique({
				where: { id: target.id },
				include: resourceInclude,
			});

			if (
				!current ||
				!hasPerm(opts.actor, "course.update-contents", current.course)
			) {
				throw new NotAllowed("resource.delete");
			}
			// Detach the attachment first: `AttachmentService.delete` resolves
			// its output by looking the owning resource back up, which fails
			// once the resource row itself is gone.
			if (current.attachmentId && current.attachment) {
				await db.attachment.delete(
					{ id: current.attachmentId },
					{ tx, actor: SYSTEM },
				);
			}

			await tx.resource.delete({ where: { id: target.id } });
		}
		return run(opts.tx ?? this.prisma);
	}

	//
	// Private helpers
	//
	private toRawData(raw: ResourceCreate["data"]): DbResource["data"] {
		switch (raw.type) {
			case "LINK":
				return raw.url;
			case "CODE":
			case "MD":
				return raw.content;
			default:
				return null;
		}
	}

	private toRawExtra(raw: ResourceCreate["data"]): DbResource["extra"] {
		switch (raw.type) {
			case "LINK":
				return null;
			case "CODE":
				return raw.language ?? null;
			default:
				return null;
		}
	}

	/**
	 * Resolves the course if actor can do the given actions.
	 *
	 * Throws `NotFound` or `NotAllowed` if no course is found or the actor may not
	 * write/read its content.
	 */
	private async courseInfo(
		ref: ResourceCreate["courseId"] | { courseId: CourseId },
		args: ServiceOpts &
			({ perms: "read" | "write"; action: ActionCode } | object),
	): Promise<{
		id: CourseId;
		instructor: { username: string };
		enrollments: { username: string }[];
	}> {
		const {
			tx = this.prisma,
			perms,
			action,
			actor,
		} = args as ServiceOpts & {
			perms: "read" | "write";
			action: ActionCode;
		};

		const select = {
			id: true,
			instructor: { select: { username: true } },
			enrollments: { select: { username: true } },
		};

		const course = valueOrNotFound(
			"course",
			await tx.course.findUnique({
				where: courseRefWhere(ref),
				select,
			}),
		);

		if (perms === undefined) return course;

		const pred =
			perms === "write"
				? (c: typeof course) => hasPerm(actor, "course.update-contents", c)
				: (c: typeof course) => hasPerm(actor, "course.read-contents", c);
		return valueOrNotAllowed(action, course, pred);
	}

	private async courseId(
		filter: { courseId: CourseId } | CourseRef,
		tx: PrismaTx,
	): Promise<CourseId> {
		const by = filter as FillUndefineds<ResourcePK>;

		// Must search the course in the database if search is given by natural
		// key
		if (by.discipline !== undefined) {
			const course = await tx.course.findUnique({
				where: {
					disciplineSlug_instructorId_editionSlug: {
						disciplineSlug: by.discipline,
						instructorId: by.instructor,
						editionSlug: by.edition,
					},
				},
				select: { id: true },
			});

			return valueOrNotFound("course", course).id;
		} else {
		}
		throw new Error("Expected either courseId or courseRef to be set.");
	}
}

//
// Auxiliary functions
//

// Convert a database resource record to the public-facing resource type.
function fromDb<T = Record<string, unknown>>(
	row: DbResource,
	extra?: T,
): Resource & T {
	extra = extra ?? ({} as T);

	return {
		id: row.id,
		slug: row.slug,
		title: row.title,
		description: row.description,

		ref: row.ref,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,

		data: fillData(row),

		...extra,
	};
}

function fillData(row: DbResource): Resource["data"] {
	switch (row.type) {
		case "FILE": {
			const filename = row.attachment?.filename ?? "corrupted-file.txt";
			const hash = row.attachment?.hash ?? "corrupted";

			return {
				type: "FILE",
				filename,
				// TODO: create static routes
				link: `/files/${hash}/${filename}`,
				mimeType: row.attachment?.mimeType ?? "text/plain",
			};
		}
		case "LINK":
			return {
				type: "LINK",
				url: row.data ?? "<corrupted link>",
			};
		case "MD":
			return {
				type: "MD",
				content: row.data ?? "<corrupted markdown>",
			};
		case "CODE":
			return {
				type: "CODE",
				content: row.data ?? "<corrupted code>",
				language: row.extra ?? "text",
			};
		default:
			throw new Error(`Unsupported resource type: ${row.type}`);
	}
}

/** One of the four fixed groups the resources page renders, title-sorted, empty groups omitted. */
export interface ResourceGroup {
	type: Resource["data"]["type"];
	label: string;
	resources: Resource[];
}

/** Display order and label for each `ResourceType` — never authored, see the spec. */
const GROUP_ORDER: { type: Resource["data"]["type"]; label: string }[] = [
	{ type: "FILE", label: "Files" },
	{ type: "LINK", label: "Links" },
	{ type: "MD", label: "Notes" },
	{ type: "CODE", label: "Snippets" },
];

/**
 * Groups resources into the four fixed sections the page renders.
 *
 * Type order fixed (`FILE` → Files, `LINK` → Links, `MD` → Notes, `CODE` →
 * Snippets), title order within each, empty groups absent. Exported as a
 * pure function so the grouping/ordering is unit-testable independent of
 * the database.
 */
export function groupResourcesByType(resources: Resource[]): ResourceGroup[] {
	const groups: ResourceGroup[] = [];
	for (const { type, label } of GROUP_ORDER) {
		const inGroup = resources
			.filter((r) => r.data.type === type)
			.sort((a, b) => a.title.localeCompare(b.title));
		if (inGroup.length > 0) {
			groups.push({ type, label, resources: inGroup });
		}
	}
	return groups;
}
