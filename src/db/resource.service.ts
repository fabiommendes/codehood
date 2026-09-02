import {
	canViewCourseContents,
	canWriteCourseContent,
	courseContentsVisibility,
} from "@/auth/permissions";
import type { FillUndefineds } from "@/utils/types";
import {
	type Create,
	type Delete,
	type FindMany,
	type FindOne,
	ForbiddenError,
	type ServiceOpts,
	SYSTEM,
	type Update,
} from "./base-service";
import {
	type File,
	type Prisma,
	type PrismaClient,
	prisma,
	type ResourceType,
} from "./client";
import { fileService } from "./file.service";

export interface CreateResource {
	courseId: number;
	/** Natural key from the repository path — FR-SYNC-010. */
	slug: string;
	type: ResourceType;
	title: string;
	description?: string;
	/** Url, for LINK. Markdown, for MD. Source, for CODE. Absent for FILE. */
	data?: string;
	/** Language, for CODE. Absent otherwise. */
	extra?: string;
	fileId?: number;
	/** Supplied by the writer, stored verbatim. */
	contentHash: string;
}

export type ResourceRef = { courseId: number; slug: string };

export type FindResourceBy = FillUndefineds<
	{ id: number } | { ref: ResourceRef }
>;

export interface FindResourcesBy {
	courseId?: number;
	types?: ResourceType[];
	slugs?: string[];
}

export interface UpdateResourceFilter {
	id: number;
}

/**
 * The editable fields. `slug` is deliberately absent: it is the sync natural
 * key, and renaming is a delete plus a create (FR-SYNC-011).
 */
export interface UpdateResource {
	type?: ResourceType;
	title?: string;
	description?: string;
	data?: string;
	extra?: string;
	fileId?: number;
	contentHash?: string;
}

export interface DeleteResourceFilter {
	id: number;
}

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

type ResourceRow = Prisma.ResourceGetPayload<{
	include: typeof resourceInclude;
}>;

/** What every read returns: the resource's own fields plus the `File` it links, if any. */
export type ResourceWithFile = Omit<ResourceRow, "course">;

function omitCourse(row: ResourceRow): ResourceWithFile {
	const { course: _course, ...rest } = row;
	return rest;
}

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
	type: ResourceType,
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
	type: ResourceType;
	label: string;
	resources: ResourceWithFile[];
}

/** Display order and label for each `ResourceType` — never authored, see the spec. */
const GROUP_ORDER: { type: ResourceType; label: string }[] = [
	{ type: "FILE", label: "Files" },
	{ type: "LINK", label: "Links" },
	{ type: "MD", label: "Notes" },
	{ type: "CODE", label: "Snippets" },
];

/**
 * Groups resources into the four fixed sections the page renders — type
 * order fixed (`FILE` → Files, `LINK` → Links, `MD` → Notes, `CODE` →
 * Snippets), title order within each, empty groups absent. Exported as a pure
 * function so the grouping/ordering is unit-testable independent of the
 * database.
 */
export function groupResourcesByType(
	resources: ResourceWithFile[],
): ResourceGroup[] {
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
	Create<CreateResource, ResourceWithFile>,
	FindOne<FindResourceBy, ResourceWithFile>,
	FindMany<FindResourcesBy, ResourceWithFile>,
	Update<UpdateResourceFilter, UpdateResource, ResourceWithFile>,
	Delete<DeleteResourceFilter> {
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	async create(
		input: CreateResource,
		opts: ServiceOpts,
	): Promise<ResourceWithFile> {
		const client = opts.tx ?? this.prisma;
		const course = await client.course.findUnique({
			where: { id: input.courseId },
			select: { instructor: { select: { id: true } } },
		});
		if (!course || !canWriteCourseContent(opts.actor, course)) {
			throw new ForbiddenError();
		}
		if (!input.contentHash) {
			throw new Error("contentHash is required.");
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
		return omitCourse(row);
	}

	/**
	 * Finds a resource by id or by its `(courseId, slug)` natural key. Throws
	 * `FORBIDDEN` if it exists but `actor` may not see its course's contents
	 * (see {@link canViewCourseContents}); returns `null` if it does not
	 * exist.
	 */
	async findOne(
		filter: FindResourceBy,
		opts: ServiceOpts,
	): Promise<ResourceWithFile | null> {
		const client = opts.tx ?? this.prisma;
		let row: ResourceRow | null = null;

		if (filter.id !== undefined) {
			row = await client.resource.findUnique({
				where: { id: filter.id },
				include: resourceInclude,
			});
		} else if (filter.ref) {
			row = await client.resource.findUnique({
				where: {
					courseId_slug: {
						courseId: filter.ref.courseId,
						slug: filter.ref.slug,
					},
				},
				include: resourceInclude,
			});
		}

		if (!row) return null;
		if (!canViewCourseContents(opts.actor, row.course)) {
			throw new ForbiddenError();
		}
		return omitCourse(row);
	}

	/**
	 * Lists resources narrowed to what `actor` may see (see
	 * {@link courseContentsVisibility}): an admin or the course's own
	 * instructor sees everything, an actively enrolled student sees the
	 * course's resources, everyone else sees none. Use
	 * {@link groupResourcesByType} on the result to build the page's four
	 * sections.
	 */
	async findMany(
		filter: FindResourcesBy,
		opts: ServiceOpts,
	): Promise<ResourceWithFile[]> {
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
		return rows.map(omitCourse);
	}

	/**
	 * Updates everything but `slug` and `courseId` — `manage import-resources`
	 * uses this to update an existing row in place when re-pushing an
	 * unchanged slug. Re-validates the merged shape, so switching a resource's
	 * `type` (unusual, but not refused) cannot leave it in an invalid one.
	 */
	async update(
		filter: UpdateResourceFilter,
		fields: UpdateResource,
		opts: ServiceOpts,
	): Promise<ResourceWithFile> {
		const client = opts.tx ?? this.prisma;
		const current = await client.resource.findUnique({
			where: { id: filter.id },
			include: resourceInclude,
		});
		if (!current || !canWriteCourseContent(opts.actor, current.course)) {
			throw new ForbiddenError();
		}

		const merged = {
			type: fields.type ?? current.type,
			data: fields.data !== undefined ? fields.data : current.data,
			extra: fields.extra !== undefined ? fields.extra : current.extra,
			fileId: fields.fileId !== undefined ? fields.fileId : current.fileId,
		};
		validateResourceShape(merged.type, merged);

		const row = await client.resource.update({
			where: { id: filter.id },
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
		return omitCourse(row);
	}

	/**
	 * Removes the resource row outright (matching FR-SYNC-013's "deleted" row
	 * for calendar events — there is no soft delete at this layer). If it
	 * pointed at a `File`, releases that reference: `FileService.delete` only
	 * reaches the disk once the last resource pointing at the blob is gone,
	 * since content addressing means another course may still share it.
	 */
	async delete(filter: DeleteResourceFilter, opts: ServiceOpts): Promise<void> {
		const client = opts.tx ?? this.prisma;
		const current = await client.resource.findUnique({
			where: { id: filter.id },
			include: resourceInclude,
		});
		if (!current || !canWriteCourseContent(opts.actor, current.course)) {
			throw new ForbiddenError();
		}
		await client.resource.delete({ where: { id: filter.id } });
		if (current.fileId && current.file) {
			await fileService.delete(
				{ slugHash: current.file.slugHash },
				{ tx: client, actor: SYSTEM },
			);
		}
	}
}

export const resourceService = new ResourceService();
export type { File };
