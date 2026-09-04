import type { z } from "zod";
import {
	canViewCourseContents,
	canWriteCourseContent,
	courseContentsVisibility,
} from "@/auth/permissions";
import { SYSTEM } from "@/core/actor";
import { NotAllowed } from "@/core/error";
import type { FillUndefineds } from "@/utils/types";
import { Validate } from "@/utils/validate";
import {
	type CourseId,
	type FileId,
	type ResourceId,
	resourceCreate,
	resourceFilter,
	resourcePK,
	type resourceRef,
	resourceSchema,
	resourceUpdate,
} from "../../core/schemas";
import type { Crud, ServiceOpts } from "../base-service";
import { type Prisma, type PrismaClient, prisma } from "../client";
import { fileService } from "./file.service";

export type { ResourceId } from "../../core/schemas";

//
// Type definitions
//
export type ResourceCreate = z.infer<typeof resourceCreate>;
export type Resource = z.infer<typeof resourceSchema>;
export type ResourceFilter = z.infer<typeof resourceFilter>;
export type ResourcePK = z.infer<typeof resourcePK>;
export type ResourceUpdate = z.infer<typeof resourceUpdate>;
export type ResourceRef = z.infer<typeof resourceRef>;

/** The minimal course shape the write/read predicates need, loaded alongside every row. */
const resourceInclude = {
	course: {
		select: {
			instructor: { select: { id: true } },
			enrollments: {
				where: { status: "ACTIVE" as const },
				select: { userId: true },
			},
		},
	},
	file: true,
} satisfies Prisma.ResourceInclude;

type DbResource = Prisma.ResourceGetPayload<{
	include: typeof resourceInclude;
}>;

/** Whole-string URL check — the heuristic the create/update validation uses. */
const BARE_URL_RE = /^https?:\/\/\S+$/i;

/**
 * Enforces the shape each `ResourceType` implies (see the table in
 * `dev/specs/to-do/resources.md`): `LINK` needs `data` and no `fileId`,
 * `FILE` needs `fileId` and no `data`, `MD` needs `data` and no `fileId`,
 * `CODE` needs `data` and `extra` and no `fileId`. A `data` that is nothing
 * but a bare URL is refused for `MD`/`CODE`, on the theory that it was meant
 * to be a `LINK`.
 */
function validateResourceShape(
	type: Resource["type"],
	fields: {
		data?: string | null;
		extra?: string | null;
		fileId?: number | null;
	},
): void {
	const { data, extra, fileId } = fields;
	switch (type) {
		case "LINK":
			if (!data) throw new Error("A LINK resource requires data (the URL).");
			if (fileId != null)
				throw new Error("A LINK resource must not have a fileId.");
			break;
		case "FILE":
			if (fileId == null) throw new Error("A FILE resource requires fileId.");
			if (data != null) throw new Error("A FILE resource must not have data.");
			break;
		case "MD":
			if (!data)
				throw new Error("An MD resource requires data (the markdown content).");
			if (fileId != null)
				throw new Error("An MD resource must not have a fileId.");
			break;
		case "CODE":
			if (!data) throw new Error("A CODE resource requires data (the source).");
			if (!extra)
				throw new Error("A CODE resource requires extra (the language).");
			if (fileId != null)
				throw new Error("A CODE resource must not have a fileId.");
			break;
	}
	if (
		(type === "MD" || type === "CODE") &&
		data &&
		BARE_URL_RE.test(data.trim())
	) {
		throw new Error(
			`A ${type} resource's data looks like a bare URL; use type: LINK for links.`,
		);
	}
}

/** One of the four fixed groups the resources page renders, title-sorted, empty groups omitted. */
export interface ResourceGroup {
	type: Resource["type"];
	label: string;
	resources: Resource[];
}

/** Display order and label for each `ResourceType` — never authored, see the spec. */
const GROUP_ORDER: { type: Resource["type"]; label: string }[] = [
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
			.filter((r) => r.type === type)
			.sort((a, b) => a.title.localeCompare(b.title));
		if (inGroup.length > 0) {
			groups.push({ type, label, resources: inGroup });
		}
	}
	return groups;
}

class ResourceService
	implements
	Crud<{
		entity: Resource;
		pkFilter: ResourcePK;
		create: ResourceCreate;
		filter: ResourceFilter;
		update: ResourceUpdate;
	}> {
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	/**
	 * Creates a resource, rejecting a shape that doesn't match its
	 * `type` (see {@link validateResourceShape}).
	 */
	@Validate({ service: true, returns: resourceSchema, args: [resourceCreate] })
	async create(input: ResourceCreate, opts: ServiceOpts): Promise<Resource> {
		const client = opts.tx ?? this.prisma;
		const course = await client.course.findUnique({
			where: { id: input.courseId },
			select: { instructor: { select: { id: true } } },
		});
		if (!course || !canWriteCourseContent(opts.actor, course)) {
			throw new NotAllowed({ action: "create-resource" });
		}
		validateResourceShape(input.type, input);

		const row = await client.resource.create({
			data: {
				courseId: input.courseId,
				slug: input.slug,
				type: input.type,
				title: input.title,
				description: input.description,
				data: input.data,
				extra: input.extra,
				fileId: input.fileId,
				contentHash: input.contentHash,
			},
			include: resourceInclude,
		});
		return toResource(row);
	}

	/**
	 * Finds a resource by id or by its `(courseId, slug)` natural key.
	 *
	 * Throws `FORBIDDEN` if it exists but `actor` may not see its course's
	 * contents (see {@link canViewCourseContents}); returns `null` if it
	 * does not exist.
	 */
	@Validate({
		service: true,
		returns: resourceSchema.nullable(),
		args: [resourcePK],
	})
	async findOne(
		filter: ResourcePK,
		opts: ServiceOpts,
	): Promise<Resource | null> {
		const client = opts.tx ?? this.prisma;
		const by = filter as FillUndefineds<ResourcePK>; // zod doesn't narrow to a single field, so we do it here
		let row: DbResource | null = null;

		if (by.id !== undefined) {
			row = await client.resource.findUnique({
				where: { id: by.id },
				include: resourceInclude,
			});
		} else if (by.ref) {
			row = await client.resource.findUnique({
				where: {
					courseId_slug: { courseId: by.ref.courseId, slug: by.ref.slug },
				},
				include: resourceInclude,
			});
		}

		if (!row) return null;
		if (!canViewCourseContents(opts.actor, row.course)) {
			throw new NotAllowed({ action: "read-resource" });
		}
		return toResource(row);
	}

	/**
	 * Lists resources narrowed to what `actor` may see (see
	 * {@link courseContentsVisibility}): an admin or the course's own
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
		const client = opts.tx ?? this.prisma;
		const rows = await client.resource.findMany({
			where: {
				AND: [
					filter.courseId !== undefined ? { courseId: filter.courseId } : {},
					filter.types ? { type: { in: filter.types } } : {},
					filter.slugs ? { slug: { in: filter.slugs } } : {},
					{ course: courseContentsVisibility(opts.actor) },
				],
			},
			include: resourceInclude,
			orderBy: { title: "asc" },
		});
		return rows.map(toResource);
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
		const target = await this.findOne(filter, opts);
		if (!target) throw new Error("resource not found");

		const client = opts.tx ?? this.prisma;
		const current = await client.resource.findUnique({
			where: { id: target.id },
			include: resourceInclude,
		});
		if (!current || !canWriteCourseContent(opts.actor, current.course)) {
			throw new NotAllowed({ action: "update-resource" });
		}

		const merged = {
			type: fields.type ?? current.type,
			data: fields.data !== undefined ? fields.data : current.data,
			extra: fields.extra !== undefined ? fields.extra : current.extra,
			fileId: fields.fileId !== undefined ? fields.fileId : current.fileId,
		};
		validateResourceShape(merged.type, merged);

		const row = await client.resource.update({
			where: { id: target.id },
			data: {
				type: fields.type,
				title: fields.title,
				description: fields.description,
				data: fields.data,
				extra: fields.extra,
				fileId: fields.fileId,
				contentHash: fields.contentHash,
			},
			include: resourceInclude,
		});
		return toResource(row);
	}

	/**
	 * Removes the resource row outright (matching FR-SYNC-013's "deleted"
	 * row for calendar events — there is no soft delete at this layer).
	 *
	 * If it pointed at a `File`, releases that reference: `FileService.delete`
	 * only reaches the disk once the last resource pointing at the blob is
	 * gone, since content addressing means another course may still share
	 * it.
	 */
	@Validate({ service: true, args: [resourcePK] })
	async delete(filter: ResourcePK, opts: ServiceOpts): Promise<void> {
		const target = await this.findOne(filter, opts);
		if (!target) throw new Error("resource not found");

		const client = opts.tx ?? this.prisma;
		const current = await client.resource.findUnique({
			where: { id: target.id },
			include: resourceInclude,
		});
		if (!current || !canWriteCourseContent(opts.actor, current.course)) {
			throw new NotAllowed({ action: "delete-resource" });
		}
		await client.resource.delete({ where: { id: target.id } });
		if (current.fileId && current.file) {
			await fileService.delete(
				{ slugHash: current.file.slugHash },
				{ tx: client, actor: SYSTEM },
			);
		}
	}
}

export const resourceService = new ResourceService();

//
// Auxiliary functions
//

// Convert a database resource record to the public-facing resource type.
function toResource(row: DbResource): Resource {
	return {
		...row,
		id: row.id as ResourceId,
		courseId: row.courseId as CourseId,
		fileId: row.fileId as FileId | null,
		file: row.file && { ...row.file, id: row.file.id as FileId },
	};
}
