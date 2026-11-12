import type { z } from "zod";
import { SYSTEM } from "@/auth/actor";
import { hasPerm } from "@/auth/permissions";
import { type ActionCode, NotAllowed, NotFound } from "@/core/error";
import {
	type CourseId,
	type CourseRef,
	resourceCreate,
	resourceFilter,
	resourcePK,
	resourceSchema,
	resourceUpdate,
} from "@/core/schemas";
import type { ServiceOptsWithoutTx } from "@/db/base-service";
import {
	checkExpectedUpdatedAt,
	checkVersion,
	guardedDelete,
	guardedUpdate,
} from "@/db/conditional-write";
import { defineService, op } from "@/db/define-service";
import { m } from "@/i18n";
import type { FillUndefineds, Pretty } from "@/typing";
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
import type { AttachmentService } from "./attachment.service";
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

type DbResource = Prisma.ResourceGetPayload<{
	include: Pretty<typeof resourceInclude>;
}>;

/** The minimal course shape the write/read predicates need, loaded alongside every row. */
const resourceInclude = {
	course: {
		select: {
			id: true,
			instructor: { select: { username: true } },
			enrollments: {
				where: { status: "ACTIVE" as const },
				select: { username: true },
			},
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
	event: {
		select: { id: true, week: true, timeSlot: { select: { slug: true } } },
	},
} satisfies Prisma.ResourceInclude;

/// The CRUD shape of the resource service.
type ResourceT = {
	entity: Resource;
	pkFilter: ResourcePK;
	create: ResourceCreate;
	filter: ResourceFilter;
	update: ResourceUpdate;
};

/**
 * The resource service of `client` (the shared client by default), storing
 * the bytes of `FILE` resources through `attachment`.
 */
export function makeResourceService(
	attachment: AttachmentService,
	client: PrismaClient = prisma,
) {
	/// Attaches a `FILE`'s bytes when they were sent, else the blob already
	/// stored under its hash, which must exist.
	function attachFile(
		tx: PrismaTx,
		id: Resource["id"],
		data: Extract<ResourceCreate["data"], { type: "FILE" }>,
		actor: ServiceOptsWithoutTx["actor"],
	) {
		const owner = {
			attachedTo: { type: "RESOURCE" as const, id },
			filename: data.filename,
		};
		return "buffer" in data
			? attachment.create({ ...owner, buffer: data.buffer }, { tx, actor })
			: attachment.attach({ ...owner, hash: data.hash }, { tx, actor });
	}

	return defineService<ResourceT>()(() => {
		/**
		 * Creates a resource.
		 *
		 * A `FILE` carries its bytes, or the hash of a blob the server already
		 * has; either way the attachment is charged to the actor's quota.
		 *
		 * @throws {@link NotFound} If a `FILE` names a hash with no blob.
		 */
		const create = op({
			args: [resourceCreate],
			returns: resourceSchema,
			run: async (
				tx: PrismaTx,
				input: ResourceCreate,
				opts: ServiceOptsWithoutTx,
			): Promise<Resource> => {
				const course = await courseInfo(tx, input.course, {
					actor: opts.actor,
					action: "resource.create",
					perms: "write",
				});

				const eventId = await resolveEventId(tx, course.id, input.event);
				let row = await tx.resource.create({
					data: {
						courseId: course.id,
						eventId,
						slug: input.slug,
						type: input.data.type,
						title: input.title,
						description: input.description,
						data: toRawData(input.data),
						extra: toRawExtra(input.data),

						// We set attachment to null and then use the attachment
						// service to create the real Attachment and Blob
						attachmentId: null,
						rev: input.rev,
					},
					include: resourceInclude,
				});

				// Create attachment now that we have the row id.
				if (input.data.type === "FILE") {
					const stored = await attachFile(tx, row.id, input.data, opts.actor);

					// The row above was created with `attachmentId: null` since the
					// attachment can't exist before the resource's own id does — link
					// it back now, or every re-fetch after this one finds no
					// attachment and falls back to `fillData`'s "corrupted-file" stub.
					// Reading the row back keeps the `updatedAt` it returns the stored one.
					row = await guardedUpdate(
						tx,
						"resource",
						{ id: row.id },
						{ attachmentId: stored.id },
						{},
						{ include: resourceInclude },
					);
				}

				return fromDb(row);
			},
		});

		/**
		 * Finds a resource by id or by its `(courseId, slug)` natural key.
		 *
		 * Throws `FORBIDDEN` if it exists but `actor` may not see its course's
		 * contents (see the `course.read-contents` permission); returns `null` if
		 * it does not exist.
		 */
		const findOne = op({
			transaction: false,
			args: [resourcePK],
			returns: resourceSchema.nullable(),
			run: async (
				tx: PrismaTx,
				filter: ResourcePK,
				opts: ServiceOptsWithoutTx,
			): Promise<Resource | null> => {
				const row = await readableRow(tx, filter, opts.actor);
				return row && fromDb(row);
			},
		});

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
		const findMany = op({
			transaction: false,
			args: [resourceFilter],
			returns: resourceSchema.array(),
			run: async (
				tx: PrismaTx,
				filter: ResourceFilter,
				opts: ServiceOptsWithoutTx,
			): Promise<Resource[]> => {
				const course = await courseInfo(tx, filter.course, {
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
							filter.event === undefined ? {} : { eventId: filter.event },
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
			},
		});

		/**
		 * Updates everything but `slug` and `courseId`.
		 *
		 * `manage import-resources` uses this to update an existing row in
		 * place when re-pushing an unchanged slug. Re-validates the merged
		 * shape, so switching a resource's `type` (unusual, but not refused)
		 * cannot leave it in an invalid one.
		 */
		const update = op({
			args: [resourcePK, resourceUpdate],
			returns: resourceSchema,
			run: async (
				tx: PrismaTx,
				filter: ResourcePK,
				fields: ResourceUpdate,
				opts: ServiceOptsWithoutTx,
			): Promise<Resource> => {
				const found = await readableRow(tx, filter, opts.actor);
				if (!found) checkExpectedUpdatedAt(null, opts.expectedUpdatedAt);
				const target = valueOrNotFound("resource", found);
				ensureAllowed({
					value: target.course,
					action: "resource.update",
					pred: (course) =>
						hasPerm(opts.actor, "course.update-contents", course),
				});
				// Before the attachment is stored: a stale caller must not write blobs.
				await checkVersion(tx, "resource", { id: target.id }, opts);

				// The same bytes and filename come back as the current attachment.
				const previousId = target.attachmentId;
				const attachmentId =
					fields.data?.type === "FILE"
						? (await attachFile(tx, target.id, fields.data, opts.actor)).id
						: undefined;

				const eventId = await resolveEventId(tx, target.courseId, fields.event);
				const row = await guardedUpdate(
					tx,
					"resource",
					{ id: target.id },
					{
						eventId,
						type: fields.data?.type,
						title: fields.title,
						description: fields.description,
						data: fields.data ? toRawData(fields.data) : undefined,
						extra: fields.data ? toRawExtra(fields.data) : undefined,
						attachmentId,
						rev: fields.rev,
					},
					opts,
					{ include: resourceInclude },
				);

				// Last, so the files it removes stay put if anything above fails.
				if (
					previousId &&
					attachmentId !== undefined &&
					attachmentId !== previousId
				) {
					await attachment.delete({ id: previousId }, { tx, actor: SYSTEM });
				}
				return fromDb(row);
			},
		});

		/**
		 * Upserts a resource keyed on `{courseId | courseRef, slug}`.
		 *
		 * PUT semantics: gated on the `course.update-contents` permission whether
		 * creating or updating, same as `create`/`update`; the shape-by-type check
		 * re-runs on whichever branch fires.
		 */
		const upsert = op({
			args: [resourceCreate],
			returns: resourceSchema,
			run: async (
				tx: PrismaTx,
				input: ResourceCreate,
				opts: ServiceOptsWithoutTx,
			): Promise<Resource> => {
				const pk = {
					slug: input.slug,
					course: input.course,
				} satisfies ResourcePK;

				let existing: DbResource | null;
				try {
					existing = await readableRow(tx, pk, opts.actor);
				} catch (error) {
					throw error instanceof NotAllowed
						? error.as("resource.create")
						: error;
				}
				if (!existing) {
					checkExpectedUpdatedAt(null, opts.expectedUpdatedAt);
					return create(tx, input, opts);
				}

				const course = await courseInfo(tx, input.course);
				if (!hasPerm(opts.actor, "course.update-contents", course)) {
					throw new NotAllowed("resource.create");
				}
				return update(tx, pk, { ...input, event: input.event ?? null }, opts);
			},
		});

		/**
		 * Removes the resource row outright.
		 *
		 * If it pointed at an `Attachment`, releases that reference:
		 * `AttachmentService.delete` only reaches the disk once the last resource
		 * pointing at the blob is gone, since content addressing means another
		 * course may still share it.
		 */
		const remove = op({
			args: [resourcePK],
			run: async (
				tx: PrismaTx,
				filter: ResourcePK,
				opts: ServiceOptsWithoutTx,
			): Promise<void> => {
				const current = await readableRow(tx, filter, opts.actor);
				if (!current) {
					checkExpectedUpdatedAt(null, opts.expectedUpdatedAt);
					throw new NotFound("resource");
				}

				if (!hasPerm(opts.actor, "course.update-contents", current.course)) {
					throw new NotAllowed("resource.delete");
				}
				await guardedDelete(tx, "resource", { id: current.id }, opts);

				// Last, so the files it removes stay put if anything above fails.
				if (current.attachmentId) {
					await attachment.delete(
						{ id: current.attachmentId },
						{ tx, actor: SYSTEM },
					);
				}
			},
		});

		return { create, findOne, findMany, update, upsert, delete: remove };
	})(client);
}

/** The resource service, as built by {@link makeResourceService}. */
export type ResourceService = ReturnType<typeof makeResourceService>;

//
// Auxiliary functions
//

/// The row `filter` names, or `null` when there is none, refusing an actor who may not read its course's contents.
async function readableRow(
	tx: PrismaTx,
	filter: ResourcePK,
	actor: ServiceOptsWithoutTx["actor"],
): Promise<DbResource | null> {
	const by = filter as FillUndefineds<ResourcePK>;
	let row: DbResource | null = null;

	// filter by resource id
	if (by.id !== undefined) {
		row = await tx.resource.findUnique({
			where: { id: by.id },
			include: resourceInclude,
		});

		// filter by course and resource slug
	} else if (by.course !== undefined) {
		const courseId = await resolveCourseId(tx, by.course);
		row = await tx.resource.findUnique({
			where: {
				courseId_slug: { courseId, slug: by.slug },
			},
			include: resourceInclude,
		});
	} else {
		throw new Error(
			"Invalid resource filter: must specify either id or course and slug",
		);
	}

	if (!row) return null;

	ensureAllowed({
		value: row.course,
		action: "resource.read",
		pred: (course) => hasPerm(actor, "course.read-contents", course),
	});
	return row;
}

function toRawData(raw: ResourceCreate["data"]): DbResource["data"] {
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

function toRawExtra(raw: ResourceCreate["data"]): DbResource["extra"] {
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
 * Resolves the course, and when `check` is given also that the actor can do
 * the given actions on it.
 *
 * Throws `NotFound` or `NotAllowed` if no course is found or the actor may not
 * write/read its content.
 */
async function courseInfo(
	tx: PrismaTx,
	ref: ResourceCreate["course"],
	check?: {
		actor: ServiceOptsWithoutTx["actor"];
		perms: "read" | "write";
		action: ActionCode;
	},
): Promise<{
	id: CourseId;
	instructor: { username: string };
	enrollments: { username: string }[];
}> {
	const select = {
		id: true,
		instructor: { select: { username: true } },
		enrollments: {
			where: { status: "ACTIVE" as const },
			select: { username: true },
		},
	};

	const course = valueOrNotFound(
		"course",
		await tx.course.findUnique({
			where: courseRefWhere(ref),
			select,
		}),
	);

	if (check === undefined) return course;

	const { actor, perms, action } = check;
	const pred =
		perms === "write"
			? (c: typeof course) => hasPerm(actor, "course.update-contents", c)
			: (c: typeof course) => hasPerm(actor, "course.read-contents", c);
	return valueOrNotAllowed(action, course, pred);
}

/**
 * Resolves an event key within a course to the event id.
 *
 * Returns `undefined` when the key is omitted (leave unchanged) and `null`
 * when it is null (no event). Throws `NotFound` if the course has no such event.
 */
async function resolveEventId(
	tx: PrismaTx,
	courseId: CourseId,
	key: ResourceCreate["event"],
): Promise<number | null | undefined> {
	if (key === undefined || key === null) return key;

	const event = await tx.calendarEvent.findFirst({
		where: {
			courseId,
			week: key.week,
			timeSlot: { slug: key.timeSlot, courseId },
		},
		select: { id: true },
	});
	return valueOrNotFound("calendar event", event).id;
}

async function resolveCourseId(
	tx: PrismaTx,
	ref: CourseRef,
): Promise<CourseId> {
	if (typeof ref === "number") return ref;

	const course = await tx.course.findUnique({
		where: courseRefWhere(ref),
		select: { id: true },
	});
	return valueOrNotFound("course", course).id;
}

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

		courseId: row.courseId,
		rev: row.rev,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,

		data: fillData(row),
		event: row.event && {
			id: row.event.id,
			week: row.event.week,
			timeSlot: row.event.timeSlot.slug,
		},

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
	{ type: "FILE", label: m.courses_resource_group_files() },
	{ type: "LINK", label: m.courses_resource_group_links() },
	{ type: "MD", label: m.courses_resource_group_notes() },
	{ type: "CODE", label: m.courses_resource_group_snippets() },
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
