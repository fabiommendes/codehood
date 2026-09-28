import type { z } from "zod";
import { type Actor, SYSTEM, type UserActor } from "@/auth/actor";
import { hasPerm } from "@/auth/permissions";
import {
	type ActionCode,
	ImproperBehavior,
	InvalidData,
	NotAllowed,
	raise,
} from "@/core/error";
import {
	type CourseId,
	courseCreate,
	courseFilter,
	type courseNaturalKey,
	coursePK,
	courseSchema,
	courseUpdate,
} from "@/core/schemas";
import { type Crud, type ServiceOpts, upsert } from "@/db/base-service";
import type { FillUndefineds } from "@/typing";
import { Validate } from "@/utils/validate";
import {
	type Prisma,
	type PrismaClient,
	type PrismaTx,
	prisma,
} from "../client";
import { invalidIfExists, valueOrNotFound } from "../utils";
import { isEditionOpen } from "./edition.service";

export type { CourseId } from "@/core/schemas";

//
// Type definitions
//
export type Course = z.infer<typeof courseSchema>;
export type CourseCreate = z.infer<typeof courseCreate>;
export type CourseFilter = z.infer<typeof courseFilter>;
export type CoursePK = z.infer<typeof coursePK>;
export type CourseUpdate = z.infer<typeof courseUpdate>;
export type CourseNaturalKey = z.infer<typeof courseNaturalKey>;

type DbCourse = Prisma.CourseGetPayload<{ include: typeof courseInclude }>;

/**
 * What every returned course carries: its discipline and instructor (every
 * view that shows a course shows both), and its `ACTIVE` enrollments — needed
 * by the `course.read` permission to decide visibility without a second
 * query, and by `fromDb` for the headcount shown on course cards. The roster
 * itself never leaves this module: `fromDb` collapses it to
 * `enrollmentCount` before it reaches the public {@link Course} shape.
 */
const courseInclude = {
	discipline: true,
	edition: {
		select: { slug: true, name: true },
	},
	instructor: {
		select: { username: true, name: true },
	},
	enrollments: {
		where: { status: "ACTIVE" as const },
		select: {
			username: true,
			createdAt: true,
			user: { select: { name: true } },
		},
	},
} satisfies Prisma.CourseInclude;

const SYSTEM_TO_INSTRUCTOR_ERROR =
	"If actor is SYSTEM, you must provide an instructor";

export class CourseService
	implements
		Crud<{
			entity: Course;
			pkFilter: CoursePK;
			create: CourseCreate;
			filter: CourseFilter;
			update: CourseUpdate;
		}>
{
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	/**
	 * Creates a course.
	 *
	 * Rejects an unknown edition, rejects an instructor creating one outside
	 * that edition's active window, and rejects an instructor naming
	 * somebody else as the course's instructor — an admin (or `SYSTEM`, e.g.
	 * `manage create-course`) may do both of the latter on any instructor's
	 * behalf.
	 */
	@Validate({ service: true, returns: courseSchema, args: [courseCreate] })
	async create(input: CourseCreate, opts: ServiceOpts): Promise<Course> {
		const client = opts.tx ?? this.prisma;
		await assertCanCreateCourse(client, input, opts, { enforceWindow: true });

		const row = await invalidIfExists(client.course.create, {
			data: {
				disciplineSlug: input.discipline,
				instructorId:
					input.instructor ??
					(opts.actor as UserActor).username ??
					raise(new ImproperBehavior(SYSTEM_TO_INSTRUCTOR_ERROR)),
				editionSlug: input.edition,
				description: input.description,
				rev: input.rev,
				startAt: input.startAt,
				endAt: input.endAt,
			},
			include: courseInclude,
		});
		return fromDb(row, opts.actor);
	}

	/**
	 * Finds a single course by id or by its URL reference.
	 *
	 * Throws `FORBIDDEN` if the course exists but `actor` may not see it (see
	 * the `course.read` permission); returns `null` if it does not exist.
	 */
	@Validate({
		service: true,
		returns: courseSchema.nullable(),
		args: [coursePK],
	})
	async findOne(filter: CoursePK, opts: ServiceOpts): Promise<Course | null> {
		const row = await this.loadRow(filter, opts);
		return row && fromDb(row, opts.actor);
	}

	/**
	 * Loads the raw db row for `filter`, enforcing `course.read`.
	 *
	 * Shared by `findOne`, `update`, and `delete` — the latter two need the
	 * row itself (not the public {@link Course}, which no longer carries
	 * `enrollments`) to check `course.update`/`course.delete` against
	 * {@link CourseWithEnrollment}.
	 */
	private async loadRow(
		filter: CoursePK,
		opts: ServiceOpts,
	): Promise<DbCourse | null> {
		const client = opts.tx ?? this.prisma;

		let row: DbCourse | null = null;
		const by = filter as FillUndefineds<CoursePK>; // zod doesn't narrow to a single field, so we do it here

		if (by.id !== undefined) {
			row = await client.course.findUnique({
				where: { id: by.id },
				include: courseInclude,
			});
		} else if (by.discipline && by.instructor && by.edition) {
			row = await client.course.findUnique({
				where: {
					disciplineSlug_instructorId_editionSlug: {
						disciplineSlug: by.discipline,
						instructorId: by.instructor,
						editionSlug: by.edition,
					},
				},
				include: courseInclude,
			});
		}

		if (!row) return null;

		const viewAllowed = hasPerm(opts.actor, "course.read", row);
		if (!viewAllowed) throw new NotAllowed("course.read");

		return row;
	}

	/**
	 * Finds many courses, narrowed to what `actor` may see (see
	 * {@link courseWhere}).
	 *
	 * For `SYSTEM`/`ADMIN`, every course; for anyone else, the courses they
	 * teach plus the courses they are enrolled in. `/courses` calls this
	 * with no extra filter and gets back exactly that actor's course list.
	 */
	@Validate({
		service: true,
		returns: courseSchema.array(),
		args: [courseFilter],
	})
	async findMany(filter: CourseFilter, opts: ServiceOpts): Promise<Course[]> {
		const client = opts.tx ?? this.prisma;
		const rows = await client.course.findMany({
			where: {
				AND: [
					filter.instructor ? { instructorId: filter.instructor } : {},
					filter.discipline ? { disciplineSlug: filter.discipline } : {},
					filter.edition ? { editionSlug: filter.edition } : {},
					courseWhere(opts.actor),
				],
			},
			include: courseInclude,
			orderBy: { createdAt: "desc" },
		});
		for (const row of rows) {
			if (!hasPerm(opts.actor, "course.read", row)) {
				throw new NotAllowed("course.read");
			}
		}
		return rows.map((row) => fromDb(row, opts.actor));
	}

	/**
	 * Updates a course's editable fields.
	 */
	@Validate({
		service: true,
		returns: courseSchema,
		args: [coursePK, courseUpdate],
	})
	async update(
		filter: CoursePK,
		fields: CourseUpdate,
		opts: ServiceOpts,
	): Promise<Course> {
		const target = await this.loadRow(filter, opts);
		if (!target) throw new Error("course not found");
		if (!hasPerm(opts.actor, "course.update", target))
			throw new NotAllowed("course.update");

		const client = opts.tx ?? this.prisma;
		const row = await client.course.update({
			where: { id: target.id },
			data: fields,
			include: courseInclude,
		});
		return fromDb(row, opts.actor);
	}

	/**
	 * Upserts a course keyed on `{discipline, instructor, edition}`.
	 *
	 * PUT semantics: {@link assertCanCreateCourse}'s permission (unknown
	 * edition, unknown instructor, or an instructor naming someone else) is
	 * enforced on the update branch too — but not the edition-window rule,
	 * which is state-dependent rather than permission-dependent and stays
	 * `create`-branch-only, or last term's material would become permanently
	 * un-syncable.
	 */
	@Validate({ service: true, returns: courseSchema, args: [courseCreate] })
	async upsert(input: CourseCreate, opts: ServiceOpts): Promise<Course> {
		return upsert(this, input, {
			...opts,
			action: "course.create",
			pk: (i) => ({
				discipline: i.discipline,
				instructor:
					i.instructor ??
					(opts.actor as UserActor).username ??
					raise(new ImproperBehavior(SYSTEM_TO_INSTRUCTOR_ERROR)),
				edition: i.edition,
			}),
			assertCreatable: async (i, o) => {
				const client = o.tx ?? this.prisma;
				await assertCanCreateCourse(client, i, o, {
					action: "course.create",
				});
			},
		});
	}

	/**
	 * Deletes a course.
	 */
	@Validate({ service: true, args: [coursePK] })
	async delete(filter: CoursePK, opts: ServiceOpts): Promise<void> {
		const target = valueOrNotFound("course", await this.loadRow(filter, opts));

		if (!target) throw new Error("course not found");
		if (!hasPerm(opts.actor, "course.delete", target))
			throw new NotAllowed("course.delete");

		const client = opts.tx ?? this.prisma;
		await client.course.delete({ where: { id: target.id } });
	}

	//
	// Public utilities
	//
	naturalKey(courseRef: CourseNaturalKey): string {
		return `${courseRef.discipline}/${courseRef.instructor}_${courseRef.edition}`;
	}
}

//
// Auxiliary functions
//

/** Prisma `where` fragment implementing the same rule as the `course.read` permission. */
export function courseWhere(actor: Actor): Prisma.CourseWhereInput {
	if (actor === SYSTEM || actor.role === "ADMIN") return {};
	return {
		OR: [
			{ instructor: { username: actor.username } },
			{ enrollments: { some: { username: actor.username, status: "ACTIVE" } } },
		],
	};
}

/**
 * Prisma `where` fragment implementing the same rule as the
 * `course.read-contents` permission.
 */
export function courseContentsWhere(actor: Actor): Prisma.CourseWhereInput {
	return courseWhere(actor);
}

/**
 * Assert user can create course for edition and for instructor.
 */
async function assertCanCreateCourse(
	client: PrismaClient | PrismaTx,
	input: Pick<CourseCreate, "edition" | "instructor">,
	opts: ServiceOpts,
	options: { action?: ActionCode; enforceWindow?: boolean } = {},
) {
	const { action = "course.create", enforceWindow = false } = options;

	const edition = await client.edition.findUnique({
		where: { slug: input.edition },
		select: { startAt: true, endAt: true },
	});
	if (!edition) {
		throw new InvalidData({
			edition: [{ code: "not-exists", message: "Given edition do not exist" }],
		});
	}
	if (
		enforceWindow &&
		!isEditionOpen(edition) &&
		!hasPerm(opts.actor, "course.create-outside-window")
	) {
		throw new InvalidData({
			edition: [
				{ code: "not-allowed", message: "Edition not accepting new courses" },
			],
		});
	}

	if (!input.instructor && opts.actor === SYSTEM) {
		throw new ImproperBehavior(SYSTEM_TO_INSTRUCTOR_ERROR);
	}

	const instructorUser = await client.user.findUnique({
		where: { username: input.instructor ?? (opts.actor as UserActor).username },
	});
	if (!instructorUser) {
		throw new InvalidData({
			instructor: [{ code: "not-exists", message: "Invalid instructor" }],
		});
	}

	if (
		!hasPerm(opts.actor, "course.create", {
			instructor: { username: instructorUser.username },
		})
	) {
		throw new NotAllowed(action);
	}

	return { edition, instructor: instructorUser };
}

// The date `actor` joined the course: SYSTEM and anyone without an
// enrollment row (the instructor, or an admin just looking) join at course
// creation; anyone else joins when their own enrollment was created.
function joinedAtFor(row: DbCourse, actor: Actor): Date {
	if (actor === SYSTEM) return row.createdAt;
	const enrollment = row.enrollments.find((e) => e.username === actor.username);
	return enrollment?.createdAt ?? row.createdAt;
}

// Convert a database course record (with its `courseInclude` relations) to the public-facing course type.
function fromDb(row: DbCourse, actor: Actor): Course {
	// Destructured out rather than left in the `...rest` spread: `@Validate`
	// only checks its `returns` schema, it does not strip what the schema
	// doesn't declare, so the raw roster would otherwise still ride along on
	// the returned object under its own name.
	const { enrollments, ...rest } = row;
	return {
		...rest,
		id: row.id as CourseId,
		instructor: row.instructor,
		enrollmentCount: enrollments.length,
		joinedAt: joinedAtFor(row, actor),
	};
}
