import {
	canCreateCourseFor,
	canCreateCourseOutsideWindow,
	canDropEnrollment,
	canManageCourse,
	canManageEnrollment,
	canViewCourse,
	courseVisibility,
} from "@/auth/permissions";
import type { FillUndefineds } from "@/utils/types";
import {
	type Create,
	type Delete,
	type FindMany,
	type FindOne,
	ForbiddenError,
	type ServiceOpts,
	type Update,
} from "./base-service";
import {
	type Course,
	type Prisma,
	type PrismaClient,
	prisma,
	type User,
} from "./client";
import { isEditionOpen } from "./edition.service";

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
	editionSlug: string;
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
	editionSlug?: string;
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

export type CourseWithDetails = Prisma.CourseGetPayload<{
	include: typeof courseInclude;
}>;

class CourseService
	implements
	Create<CreateCourseInput, CourseWithDetails>,
	FindOne<FindOneBy, CourseWithDetails>,
	FindMany<FindManyBy, CourseWithDetails>,
	Update<UpdateCourseFilter, UpdateCourseInput, CourseWithDetails>,
	Delete<DeleteCourseFilter> {
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	/**
	 * Creates a course. Rejects an unknown edition, rejects an instructor
	 * creating one outside that edition's active window, and rejects an
	 * instructor naming somebody else as the course's instructor — an admin
	 * (or `SYSTEM`, e.g. `manage create-course`) may do both of the latter on
	 * any instructor's behalf.
	 */
	async create(
		input: CreateCourseInput,
		opts: ServiceOpts,
	): Promise<CourseWithDetails> {
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
			throw new ForbiddenError();
		}
		return client.course.create({
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
	}

	/**
	 * Finds a single course by id or by its URL reference. Throws
	 * `FORBIDDEN` if the course exists but `actor` may not see it (see
	 * {@link canViewCourse}); returns `null` if it does not exist.
	 */
	async findOne(
		filter: FindOneBy,
		opts: ServiceOpts,
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
					disciplineSlug_instructorSlug_editionSlug: {
						disciplineSlug: filter.ref.disciplineSlug,
						instructorSlug: filter.ref.username,
						editionSlug: filter.ref.edition,
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
		opts: ServiceOpts,
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
					filter.editionSlug ? { editionSlug: filter.editionSlug } : {},
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
		opts: ServiceOpts,
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

	async delete(filter: DeleteCourseFilter, opts: ServiceOpts): Promise<void> {
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
	 * enrollment. The course's owner (or system) only — there is no
	 * self-enroll UI yet; a student joins through a classroom invite, which
	 * enrolls them as `SYSTEM` inside the invite-redemption transaction.
	 */
	async enroll(input: EnrollInput, opts: ServiceOpts): Promise<void> {
		const client = opts.tx ?? this.prisma;
		const course = await client.course.findUnique({
			where: { id: input.courseId },
			include: courseInclude,
		});
		if (!course || !canManageEnrollment(opts.actor, course)) {
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

	/**
	 * Marks the enrollment `DROPPED` rather than deleting it, so re-enrolling
	 * keeps history. Gated by {@link canDropEnrollment}: the course's owner
	 * dropping any student, or a student dropping themselves (FR-CRS-042) —
	 * idempotent, so dropping an already-`DROPPED` enrollment is a no-op.
	 */
	async unenroll(input: UnenrollInput, opts: ServiceOpts): Promise<void> {
		const client = opts.tx ?? this.prisma;
		const course = await client.course.findUnique({
			where: { id: input.courseId },
			include: courseInclude,
		});
		if (!course || !canDropEnrollment(opts.actor, course, input.userId)) {
			throw new ForbiddenError();
		}
		await client.enrollment.updateMany({
			where: { userId: input.userId, courseId: input.courseId },
			data: { status: "DROPPED" },
		});
	}

	/**
	 * Lists the actively-enrolled students in `courseId`, each carrying
	 * `enrolledAt`. The course's owner (or system) only — students cannot
	 * list their classmates, a privacy default rather than a technical
	 * limit, and a non-owning admin gets no branch either (see
	 * {@link canManageEnrollment}).
	 */
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
			throw new ForbiddenError();
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
export type { Course };
