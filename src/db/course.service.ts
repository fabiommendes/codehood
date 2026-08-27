import {
	canCreateCourseFor,
	canManageCourse,
	canViewCourse,
	courseVisibility,
} from "@/auth/permissions";
import { EDITION_RE } from "@/utils/course-url";
import type { FillUndefineds } from "@/utils/types";
import {
	type ActingOpts,
	type CreateAs,
	type DeleteAs,
	type FindManyAs,
	type FindOneAs,
	ForbiddenError,
	type UpdateAs,
} from "./base-service";
import {
	type Course,
	type Prisma,
	type PrismaClient,
	prisma,
	type User,
} from "./client";

/** Identifies a course the way its URL does — see `src/utils/course-url.ts`. */
export interface CourseRef {
	disciplineSlug: string;
	username: string;
	edition: string;
}

export interface CreateCourseInput {
	disciplineSlug: string;
	/** The instructor's `username`, not a numeric id — `Course.instructor` targets `User.username`. */
	instructorUsername: string;
	edition: string;
	description?: string;
	startAt: Date;
	endAt: Date;
}

export interface UpdateCourseFilter {
	id: number;
}

export interface UpdateCourseInput {
	description?: string;
	startAt?: Date;
	endAt?: Date;
}

export interface DeleteCourseFilter {
	id: number;
}

export type FindOneBy = FillUndefineds<{ id: number } | { ref: CourseRef }>;

export interface FindManyBy {
	instructorUsername?: string;
	disciplineSlug?: string;
}

export interface EnrollInput {
	courseId: number;
	userId: number;
}

export type UnenrollInput = EnrollInput;

/**
 * What every returned course carries: its discipline and instructor (every
 * view that shows a course shows both), and its `ACTIVE` enrollments —
 * needed by `canViewCourse`/`canManageCourse` to decide visibility without a
 * second query, and by `_count` for the headcount shown on course cards.
 */
const courseInclude = {
	discipline: true,
	instructor: {
		select: { id: true, publicId: true, username: true, name: true },
	},
	enrollments: {
		where: { status: "ACTIVE" as const },
		select: { userId: true },
	},
	_count: {
		select: { enrollments: { where: { status: "ACTIVE" as const } } },
	},
} satisfies Prisma.CourseInclude;

export type CourseWithDetails = Prisma.CourseGetPayload<{
	include: typeof courseInclude;
}>;

class CourseService
	implements
		CreateAs<CreateCourseInput, CourseWithDetails>,
		FindOneAs<FindOneBy, CourseWithDetails>,
		FindManyAs<FindManyBy, CourseWithDetails>,
		UpdateAs<UpdateCourseFilter, UpdateCourseInput, CourseWithDetails>,
		DeleteAs<DeleteCourseFilter>
{
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	/**
	 * Creates a course. Rejects a malformed `edition`, and rejects an
	 * instructor naming somebody else as the course's instructor — an admin
	 * (or `SYSTEM`, e.g. `manage create-course`) may do that on any
	 * instructor's behalf.
	 */
	async create(
		input: CreateCourseInput,
		opts: ActingOpts,
	): Promise<CourseWithDetails> {
		if (!EDITION_RE.test(input.edition)) {
			throw new Error(
				`"${input.edition}" is not a valid edition: it must match ${EDITION_RE}.`,
			);
		}
		const client = opts.tx ?? this.prisma;
		const instructorUser = await client.user.findUnique({
			where: { username: input.instructorUsername },
		});
		if (!instructorUser) {
			throw new Error(`No user with username "${input.instructorUsername}".`);
		}
		if (!canCreateCourseFor(opts.actor, instructorUser.id)) {
			throw new ForbiddenError();
		}
		return client.course.create({
			data: {
				disciplineSlug: input.disciplineSlug,
				instructorSlug: input.instructorUsername,
				edition: input.edition,
				description: input.description,
				startAt: input.startAt,
				endAt: input.endAt,
			},
			include: courseInclude,
		});
	}

	/**
	 * Finds a single course by id or by its URL reference. Throws
	 * `FORBIDDEN` if the course exists but `actor` may not see it (see
	 * {@link canViewCourse}); returns `null` if it does not exist.
	 */
	async findOne(
		filter: FindOneBy,
		opts: ActingOpts,
	): Promise<CourseWithDetails | null> {
		const client = opts.tx ?? this.prisma;
		let course: CourseWithDetails | null = null;

		if (filter.id !== undefined) {
			course = await client.course.findUnique({
				where: { id: filter.id },
				include: courseInclude,
			});
		} else if (filter.ref) {
			course = await client.course.findUnique({
				where: {
					disciplineSlug_instructorSlug_edition: {
						disciplineSlug: filter.ref.disciplineSlug,
						instructorSlug: filter.ref.username,
						edition: filter.ref.edition,
					},
				},
				include: courseInclude,
			});
		}

		if (!course) return null;
		if (!canViewCourse(opts.actor, course)) {
			throw new ForbiddenError();
		}
		return course;
	}

	/**
	 * Find many courses, narrowed to what `actor` may see (see
	 * {@link courseVisibility}) — for `SYSTEM`/`ADMIN`, every course; for
	 * anyone else, the courses they teach plus the courses they are
	 * enrolled in. `/courses` calls this with no extra filter and gets back
	 * exactly that actor's course list.
	 */
	async findMany(
		filter: FindManyBy,
		opts: ActingOpts,
	): Promise<CourseWithDetails[]> {
		const client = opts.tx ?? this.prisma;
		return client.course.findMany({
			where: {
				AND: [
					filter.instructorUsername
						? { instructorSlug: filter.instructorUsername }
						: {},
					filter.disciplineSlug
						? { disciplineSlug: filter.disciplineSlug }
						: {},
					courseVisibility(opts.actor),
				],
			},
			include: courseInclude,
			orderBy: { createdAt: "desc" },
		});
	}

	async update(
		filter: UpdateCourseFilter,
		fields: UpdateCourseInput,
		opts: ActingOpts,
	): Promise<CourseWithDetails> {
		const client = opts.tx ?? this.prisma;
		const course = await client.course.findUnique({
			where: { id: filter.id },
			include: courseInclude,
		});
		if (!course || !canManageCourse(opts.actor, course)) {
			throw new ForbiddenError();
		}
		return client.course.update({
			where: { id: filter.id },
			data: fields,
			include: courseInclude,
		});
	}

	async delete(filter: DeleteCourseFilter, opts: ActingOpts): Promise<void> {
		const client = opts.tx ?? this.prisma;
		const course = await client.course.findUnique({
			where: { id: filter.id },
			include: courseInclude,
		});
		if (!course || !canManageCourse(opts.actor, course)) {
			throw new ForbiddenError();
		}
		await client.course.delete({ where: { id: filter.id } });
	}

	/**
	 * Enrolls `input.userId` in `input.courseId`, or reactivates a `DROPPED`
	 * enrollment. Instructor/admin/system only — there is no self-enroll UI
	 * yet; a student joins through a classroom invite, which enrolls them as
	 * `SYSTEM` inside the invite-redemption transaction.
	 */
	async enroll(input: EnrollInput, opts: ActingOpts): Promise<void> {
		const client = opts.tx ?? this.prisma;
		const course = await client.course.findUnique({
			where: { id: input.courseId },
			include: courseInclude,
		});
		if (!course || !canManageCourse(opts.actor, course)) {
			throw new ForbiddenError();
		}
		await client.enrollment.upsert({
			where: {
				userId_courseId: { userId: input.userId, courseId: input.courseId },
			},
			update: { status: "ACTIVE" },
			create: { userId: input.userId, courseId: input.courseId },
		});
	}

	/** Marks the enrollment `DROPPED` rather than deleting it, so re-enrolling keeps history. */
	async unenroll(input: UnenrollInput, opts: ActingOpts): Promise<void> {
		const client = opts.tx ?? this.prisma;
		const course = await client.course.findUnique({
			where: { id: input.courseId },
			include: courseInclude,
		});
		if (!course || !canManageCourse(opts.actor, course)) {
			throw new ForbiddenError();
		}
		await client.enrollment.updateMany({
			where: { userId: input.userId, courseId: input.courseId },
			data: { status: "DROPPED" },
		});
	}

	/**
	 * Lists the actively-enrolled students in `courseId`. Instructor/admin/
	 * system only — students cannot list their classmates, a privacy
	 * default rather than a technical limit.
	 */
	async listStudents(courseId: number, opts: ActingOpts): Promise<User[]> {
		const client = opts.tx ?? this.prisma;
		const course = await client.course.findUnique({
			where: { id: courseId },
			include: courseInclude,
		});
		if (!course || !canManageCourse(opts.actor, course)) {
			throw new ForbiddenError();
		}
		const enrollments = await client.enrollment.findMany({
			where: { courseId, status: "ACTIVE" },
			include: { user: true },
			orderBy: { createdAt: "asc" },
		});
		return enrollments.map((e) => e.user);
	}
}

export const courseService = new CourseService();
export type { Course };
