import { z } from "zod";
import {
	canCreateCourseFor,
	canCreateCourseOutsideWindow,
	canDropEnrollment,
	canManageCourse,
	canManageEnrollment,
	canViewCourse,
	courseVisibility,
} from "@/auth/permissions";
import { NotAllowed } from "@/core/error";
import type { FillUndefineds } from "@/utils/types";
import { Validate } from "@/utils/validate";
import {
	type CourseId,
	courseCreate,
	courseEnrollInput,
	courseFilter,
	coursePK,
	type courseRef,
	courseSchema,
	courseUpdate,
	type UserId,
	userSchema,
} from "../../core/schemas";
import type { Crud, ServiceOpts } from "../base-service";
import { type Prisma, type PrismaClient, prisma, type User } from "../client";
import { isEditionOpen } from "./edition.service";

export type { CourseId } from "../../core/schemas";

//
// Type definitions
//
export type CourseCreate = z.infer<typeof courseCreate>;
export type Course = z.infer<typeof courseSchema>;
export type CourseFilter = z.infer<typeof courseFilter>;
export type CoursePK = z.infer<typeof coursePK>;
export type CourseUpdate = z.infer<typeof courseUpdate>;
export type CourseEnrollInput = z.infer<typeof courseEnrollInput>;
export type CourseUnenrollInput = CourseEnrollInput;
export type CourseRef = z.infer<typeof courseRef>;

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
		select: { id: true, publicId: true, username: true, name: true },
	},
	enrollments: {
		where: { status: "ACTIVE" as const },
		select: { userId: true, createdAt: true },
	},
	_count: {
		select: { enrollments: { where: { status: "ACTIVE" as const } } },
	},
} satisfies Prisma.CourseInclude;

type DbCourse = Prisma.CourseGetPayload<{ include: typeof courseInclude }>;

class CourseService
	implements
	Crud<{
		entity: Course;
		pkFilter: CoursePK;
		create: CourseCreate;
		filter: CourseFilter;
		update: CourseUpdate;
	}> {
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
		const edition = await client.edition.findUnique({
			where: { slug: input.editionSlug },
		});
		if (!edition) {
			throw new Error(
				`No edition "${input.editionSlug}". Editions are created by an admin.`,
			);
		}
		if (!isEditionOpen(edition) && !canCreateCourseOutsideWindow(opts.actor)) {
			throw new Error(
				`Edition "${edition.slug}" is not accepting new courses: its window ran from ${edition.startAt.toISOString().slice(0, 10)} to ${edition.endAt.toISOString().slice(0, 10)}.`,
			);
		}
		const instructorUser = await client.user.findUnique({
			where: { username: input.instructorUsername },
		});
		if (!instructorUser) {
			throw new Error(`No user with username "${input.instructorUsername}".`);
		}
		if (!canCreateCourseFor(opts.actor, instructorUser.id)) {
			throw new NotAllowed({ action: "create-course" });
		}
		const row = await client.course.create({
			data: {
				disciplineSlug: input.disciplineSlug,
				instructorSlug: input.instructorUsername,
				editionSlug: input.editionSlug,
				description: input.description,
				startAt: input.startAt,
				endAt: input.endAt,
			},
			include: courseInclude,
		});
		return toCourse(row);
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
					disciplineSlug_instructorSlug_editionSlug: {
						disciplineSlug: by.ref.disciplineSlug,
						instructorSlug: by.ref.username,
						editionSlug: by.ref.edition,
					},
				},
				include: courseInclude,
			});
		}

		if (!row) return null;
		if (!canViewCourse(opts.actor, row)) {
			throw new NotAllowed({ action: "read-course" });
		}
		return toCourse(row);
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
						? { instructorSlug: filter.instructorUsername }
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
		return rows.map(toCourse);
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
		if (!canManageCourse(opts.actor, target))
			throw new NotAllowed({ action: "update-course" });

		const client = opts.tx ?? this.prisma;
		const row = await client.course.update({
			where: { id: target.id },
			data: fields,
			include: courseInclude,
		});
		return toCourse(row);
	}

	/**
	 * Deletes a course.
	 */
	@Validate({ service: true, args: [coursePK] })
	async delete(filter: CoursePK, opts: ServiceOpts): Promise<void> {
		const target = await this.findOne(filter, opts);
		if (!target) throw new Error("course not found");
		if (!canManageCourse(opts.actor, target))
			throw new NotAllowed({ action: "delete-course" });

		const client = opts.tx ?? this.prisma;
		await client.course.delete({ where: { id: target.id } });
	}

	/**
	 * Enrolls `input.userId` in `input.courseId`, or reactivates a `DROPPED`
	 * enrollment.
	 *
	 * The course's owner (or system) only — there is no self-enroll UI yet;
	 * a student joins through a classroom invite, which enrolls them as
	 * `SYSTEM` inside the invite-redemption transaction.
	 */
	@Validate({ service: true, args: [courseEnrollInput] })
	async enroll(input: CourseEnrollInput, opts: ServiceOpts): Promise<void> {
		const client = opts.tx ?? this.prisma;
		const course = await client.course.findUnique({
			where: { id: input.courseId },
			include: courseInclude,
		});
		if (!course || !canManageEnrollment(opts.actor, course)) {
			throw new NotAllowed({ action: "do-course:enroll" });
		}
		await client.enrollment.upsert({
			where: {
				userId_courseId: { userId: input.userId, courseId: input.courseId },
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
	@Validate({ service: true, args: [courseEnrollInput] })
	async drop(input: CourseUnenrollInput, opts: ServiceOpts): Promise<void> {
		const client = opts.tx ?? this.prisma;
		const course = await client.course.findUnique({
			where: { id: input.courseId },
			include: courseInclude,
		});
		if (!course || !canDropEnrollment(opts.actor, course, input.userId)) {
			throw new NotAllowed({ action: "do-course:drop" });
		}
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
		courseId: number,
		opts: ServiceOpts,
	): Promise<(User & { enrolledAt: Date })[]> {
		const client = opts.tx ?? this.prisma;
		const course = await client.course.findUnique({
			where: { id: courseId },
			include: courseInclude,
		});
		if (!course || !canManageEnrollment(opts.actor, course)) {
			throw new NotAllowed({ action: "read-course.students" });
		}
		const enrollments = await client.enrollment.findMany({
			where: { courseId, status: "ACTIVE" },
			include: { user: true },
			orderBy: { createdAt: "asc" },
		});
		return enrollments.map((e) => ({ ...e.user, enrolledAt: e.createdAt }));
	}
}

export const courseService = new CourseService();

//
// Auxiliary functions
//

// Convert a database course record (with its `courseInclude` relations) to the public-facing course type.
function toCourse(row: DbCourse): Course {
	return {
		...row,
		id: row.id as CourseId,
		instructor: { ...row.instructor, id: row.instructor.id as UserId },
		enrollments: row.enrollments.map((e) => ({
			...e,
			userId: e.userId as UserId,
		})),
	};
}
