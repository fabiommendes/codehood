import { z } from "zod";
import {
	type CourseWithEnrollment,
	canCreateCourseFor,
	canCreateCourseOutsideWindow,
	canDropEnrollment,
	canManageCourse,
	canManageEnrollment,
	canViewCourse,
	courseVisibility,
} from "@/auth/permissions";
import { type Actor, SYSTEM } from "@/core/actor";
import { type ActionCode, NotAllowed } from "@/core/error";
import type { FillUndefineds } from "@/typing";
import { Validate } from "@/utils/validate";
import {
	type CourseId,
	courseCreate,
	courseFilter,
	coursePK,
	type courseRef,
	courseSchema,
	courseUpdate,
	courseUpsert,
	createCourseEnrollment,
	userSchema,
} from "../../core/schemas";
import { type Crud, type ServiceOpts, upsert } from "../base-service";
import {
	type Prisma,
	type PrismaClient,
	type PrismaTx,
	prisma,
} from "../client";
import { isEditionOpen } from "./edition.service";
import { toUser, type User } from "./user.service";

export type { CourseId } from "../../core/schemas";

//
// Type definitions
//
export type CourseCreate = z.infer<typeof courseCreate>;
export type Course = z.infer<typeof courseSchema>;
export type CourseFilter = z.infer<typeof courseFilter>;
export type CoursePK = z.infer<typeof coursePK>;
export type CourseUpdate = z.infer<typeof courseUpdate>;
export type CourseUpsert = z.infer<typeof courseUpsert>;
export type CourseEnrollment = z.infer<typeof createCourseEnrollment>;
export type CourseRef = z.infer<typeof courseRef>;

type DbCourse = Prisma.CourseGetPayload<{ include: typeof courseInclude }>;

/**
 * What every returned course carries: its discipline and instructor (every
 * view that shows a course shows both), and its `ACTIVE` enrollments —
 * needed by `canViewCourse`/`canManageCourse` to decide visibility without a
 * second query, and by `_count` for the headcount shown on course cards.
 */
const courseInclude = {
	discipline: true,
	edition: true,
	instructor: {
		select: { username: true, name: true },
	},
	enrollments: {
		where: { status: "ACTIVE" as const },
		select: {
			userId: true,
			createdAt: true,
			user: { select: { name: true } },
		},
	},
} satisfies Prisma.CourseInclude;

class CourseService
	implements
		Crud<{
			entity: Course;
			pkFilter: CoursePK;
			create: CourseCreate;
			filter: CourseFilter;
			update: CourseUpdate;
			upsert: CourseUpsert;
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
		const row = await client.course.create({
			data: {
				disciplineSlug: input.discipline,
				instructorId: input.instructor,
				editionSlug: input.edition,
				description: input.description,
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
	 * {@link canViewCourse}); returns `null` if it does not exist.
	 */
	@Validate({
		service: true,
		returns: courseSchema.nullable(),
		args: [coursePK],
	})
	async findOne(filter: CoursePK, opts: ServiceOpts): Promise<Course | null> {
		const client = opts.tx ?? this.prisma;

		let row: DbCourse | null = null;
		const by = filter as FillUndefineds<CoursePK>; // zod doesn't narrow to a single field, so we do it here

		if (by.id !== undefined) {
			row = await client.course.findUnique({
				where: { id: by.id },
				include: courseInclude,
			});
		} else if (by.ref) {
			row = await client.course.findUnique({
				where: {
					disciplineSlug_instructorId_editionSlug: {
						disciplineSlug: by.ref.discipline,
						instructorId: by.ref.instructor,
						editionSlug: by.ref.edition,
					},
				},
				include: courseInclude,
			});
		}

		if (!row) return null;

		const viewAllowed = canViewCourse(opts.actor, row);
		if (!viewAllowed) throw new NotAllowed({ action: "read-course" });

		return fromDb(row, opts.actor);
	}

	/**
	 * Finds many courses, narrowed to what `actor` may see (see
	 * {@link courseVisibility}).
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
					filter.instructorUsername
						? { instructorId: filter.instructorUsername }
						: {},
					filter.disciplineSlug
						? { disciplineSlug: filter.disciplineSlug }
						: {},
					filter.editionSlug ? { editionSlug: filter.editionSlug } : {},
					courseVisibility(opts.actor),
				],
			},
			include: courseInclude,
			orderBy: { createdAt: "desc" },
		});
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
		const target = await this.findOne(filter, opts);
		if (!target) throw new Error("course not found");
		if (!canManageCourse(opts.actor, toEnrollmentView(target)))
			throw new NotAllowed({ action: "update-course" });

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
	@Validate({ service: true, returns: courseSchema, args: [courseUpsert] })
	async upsert(input: CourseUpsert, opts: ServiceOpts): Promise<Course> {
		return upsert(
			this.prisma,
			this,
			input,
			opts,
			{
				pk: (i) => ({
					ref: {
						discipline: i.discipline,
						instructor: i.instructor,
						edition: i.edition,
					},
				}),
				assertCreatable: async (i, o) => {
					const client = o.tx ?? this.prisma;
					await assertCanCreateCourse(client, i, o, {
						action: "upsert-course",
					});
				},
			},
			"upsert-course",
		);
	}

	/**
	 * Deletes a course.
	 */
	@Validate({ service: true, args: [coursePK] })
	async delete(filter: CoursePK, opts: ServiceOpts): Promise<void> {
		const target = await this.findOne(filter, opts);
		if (!target) throw new Error("course not found");
		if (!canManageCourse(opts.actor, toEnrollmentView(target)))
			throw new NotAllowed({ action: "delete-course" });

		const client = opts.tx ?? this.prisma;
		await client.course.delete({ where: { id: target.id } });
	}

	// FIXME: the enroll/unenroll methods should not be part of a course service;
	// we should follow REST semantics and have a separate enrollment service,
	// and it be mapped to create/delete methods
	/**
	 * Enrolls `input.userId` in `input.courseId`, or reactivates a `DROPPED`
	 * enrollment.
	 *
	 * The course's owner (or system) only — there is no self-enroll UI yet;
	 * a student joins through a classroom invite, which enrolls them as
	 * `SYSTEM` inside the invite-redemption transaction.
	 */
	@Validate({ service: true, args: [createCourseEnrollment] })
	async enroll(input: CourseEnrollment, opts: ServiceOpts): Promise<void> {
		const client = opts.tx ?? this.prisma;

		const course = await client.course.findUnique({
			where: { id: input.courseId },
			include: courseInclude,
		});

		const canEnroll = course && canManageEnrollment(opts.actor, course);
		if (!canEnroll) throw new NotAllowed({ action: "do-course:enroll" });

		await client.enrollment.upsert({
			where: {
				userId_courseId: {
					userId: input.userId,
					courseId: input.courseId,
				},
			},
			update: { status: "ACTIVE" },
			create: { userId: input.userId, courseId: input.courseId },
		});
	}

	/**
	 * Marks the enrollment `DROPPED` rather than deleting it, so re-enrolling
	 * keeps history.
	 *
	 * Gated by {@link canDropEnrollment}: the course's owner dropping any
	 * student, or a student dropping themselves (FR-CRS-042) — idempotent,
	 * so dropping an already-`DROPPED` enrollment is a no-op.
	 */
	@Validate({ service: true, args: [createCourseEnrollment] })
	async drop(input: CourseEnrollment, opts: ServiceOpts): Promise<void> {
		const client = opts.tx ?? this.prisma;

		const course = await client.course.findUnique({
			where: { id: input.courseId },
			include: courseInclude,
		});

		const canDrop =
			course && canDropEnrollment(opts.actor, course, input.userId);
		if (!canDrop) throw new NotAllowed({ action: "do-course:drop" });

		await client.enrollment.updateMany({
			where: { userId: input.userId, courseId: input.courseId },
			data: { status: "DROPPED" },
		});
	}

	/**
	 * Lists the actively-enrolled students in `courseId`, each carrying
	 * `enrolledAt`.
	 *
	 * The course's owner (or system) only — students cannot list their
	 * classmates, a privacy default rather than a technical limit, and a
	 * non-owning admin gets no branch either (see {@link canManageEnrollment}).
	 */
	@Validate({
		service: true,
		returns: userSchema.extend({ enrolledAt: z.date() }).array(),
	})
	async listStudents(
		courseId: CourseId,
		opts: ServiceOpts,
	): Promise<(User & { enrolledAt: Date })[]> {
		const client = opts.tx ?? this.prisma;

		const course = await client.course.findUnique({
			where: { id: courseId },
			include: courseInclude,
		});

		const canView = course && canManageEnrollment(opts.actor, course);
		if (!canView) throw new NotAllowed({ action: "read-course.students" });

		const studentUsernames = course.enrollments.map((e) => e.userId);
		const studentToDate = new Map(
			course.enrollments.map((e) => [e.userId, e.createdAt]),
		);
		const students = await client.user.findMany({
			where: { username: { in: studentUsernames } },
		});

		return students.map((dbUser) => {
			return {
				...toUser(dbUser),
				enrolledAt: studentToDate.get(dbUser.username) as Date,
			};
		});
	}

	//
	// Public utilities
	//
	naturalKey(courseRef: CourseRef): string {
		return `${courseRef.discipline}/${courseRef.instructor}_${courseRef.edition}`;
	}
}

export const courseService = new CourseService();

/**
 * Adapts a public {@link Course} to the raw-row shape the permission
 * predicates in `@/auth/permissions` expect ({@link CourseWithEnrollment}) —
 * needed anywhere a page already has the public entity (from {@link
 * courseService.findOne}) rather than a freshly-loaded Prisma row.
 */
export function toEnrollmentView(course: Course): CourseWithEnrollment {
	return {
		instructor: course.instructor,
		enrollments: course.enrollments.map((e) => ({ userId: e.username })),
	};
}

//
// Auxiliary functions
//

/**
 * Looks up the edition and instructor `create`/`upsert` both need, and
 * enforces {@link canCreateCourseFor}, tagged with `action`.
 *
 * `enforceWindow` gates the edition-window rule (see `create`'s doc): it is
 * state-dependent, not permission-dependent, so `upsert`'s update branch
 * leaves it off — the same request must not flip outcome depending on
 * whether the row already exists.
 */
async function assertCanCreateCourse(
	client: PrismaClient | PrismaTx,
	input: Pick<CourseCreate, "edition" | "instructor">,
	opts: ServiceOpts,
	options: { action?: ActionCode; enforceWindow?: boolean } = {},
) {
	const { action = "create-course", enforceWindow = false } = options;
	const edition = await client.edition.findUnique({
		where: { slug: input.edition },
	});
	if (!edition) {
		throw new Error(
			`No edition "${input.edition}". Editions are created by an admin.`,
		);
	}
	if (
		enforceWindow &&
		!isEditionOpen(edition) &&
		!canCreateCourseOutsideWindow(opts.actor)
	) {
		throw new Error(
			`Edition "${edition.slug}" is not accepting new courses: its window ran from ${edition.startAt.toISOString().slice(0, 10)} to ${edition.endAt.toISOString().slice(0, 10)}.`,
		);
	}
	const instructorUser = await client.user.findUnique({
		where: { username: input.instructor },
	});
	if (!instructorUser) {
		throw new Error(`No user with username "${input.instructor}".`);
	}
	if (!canCreateCourseFor(opts.actor, instructorUser.username)) {
		throw new NotAllowed({ action });
	}
	return { edition, instructor: instructorUser };
}

// The date `actor` joined the course: SYSTEM and anyone without an
// enrollment row (the instructor, or an admin just looking) join at course
// creation; anyone else joins when their own enrollment was created.
function joinedAtFor(row: DbCourse, actor: Actor): Date {
	if (actor === SYSTEM) return row.createdAt;
	const enrollment = row.enrollments.find((e) => e.userId === actor.username);
	return enrollment?.createdAt ?? row.createdAt;
}

// Convert a database course record (with its `courseInclude` relations) to the public-facing course type.
function fromDb(row: DbCourse, actor: Actor): Course {
	return {
		...row,
		id: row.id as CourseId,
		instructor: row.instructor,
		enrollments: row.enrollments.map((e) => ({
			username: e.userId,
			name: e.user.name,
		})),
		joinedAt: joinedAtFor(row, actor),
	};
}
