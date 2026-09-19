import type { z } from "zod";
import { type CourseTarget, ensurePerm } from "@/auth/permissions";
import { NotImplemented } from "@/core/error";
import {
	type CourseId,
	enrollmentCreate,
	enrollmentFilter,
	enrollmentPK,
	enrollmentSchema,
} from "@/core/schemas";
import type { Crud, ServiceOpts } from "@/db/base-service";
import { Validate } from "@/utils/validate";
import { type Prisma, type PrismaClient, prisma } from "../client";
import { courseRefWhere, valueOrNotFound } from "../utils";
import { toUser } from "./user.service";

//
// Type definitions
//
export type Enrollment = z.infer<typeof enrollmentSchema>;
export type EnrollmentCreate = z.infer<typeof enrollmentCreate>;
export type EnrollmentFilter = z.infer<typeof enrollmentFilter>;
export type EnrollmentPK = z.infer<typeof enrollmentPK>;
export type EnrollmentUpdate = never;
export type EnrollmentUpsert = never;

type DbEnrollment = Prisma.EnrollmentGetPayload<{
	include: typeof enrollmentInclude;
}>;

type CourseRef = EnrollmentCreate["courseId"];

// The full user row, so `toUser` can unmask `githubId`/`schoolId`.
const enrollmentInclude = { user: true } satisfies Prisma.EnrollmentInclude;

/**
 * A student's membership in a course.
 *
 * Dropping marks the row `DROPPED` rather than deleting it, so re-enrolling
 * keeps history. Students cannot list their classmates, a privacy default
 * rather than a technical limit.
 */
export class EnrollmentService
	implements
		Crud<{
			entity: Enrollment;
			pkFilter: EnrollmentPK;
			create: EnrollmentCreate;
			filter: EnrollmentFilter;
			update: EnrollmentUpdate;
			upsert: EnrollmentUpsert;
		}>
{
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	/**
	 * Enrolls `input.username` in the course, or reactivates a `DROPPED` enrollment.
	 *
	 * The course's owner (or system) only: a student joins through a classroom
	 * invite, which enrolls them as `SYSTEM` inside the redemption transaction.
	 */
	@Validate({
		service: true,
		returns: enrollmentSchema,
		args: [enrollmentCreate],
	})
	async create(
		input: EnrollmentCreate,
		opts: ServiceOpts,
	): Promise<Enrollment> {
		const client = opts.tx ?? this.prisma;
		const course = await this.course(input.courseId, opts);
		ensurePerm(opts.actor, "enrollment.create", course.view);

		const row = await client.enrollment.upsert({
			where: {
				username_courseId: { username: input.username, courseId: course.id },
			},
			update: { status: "ACTIVE" },
			create: { username: input.username, courseId: course.id },
			include: enrollmentInclude,
		});
		return fromDb(row);
	}

	/**
	 * Finds `filter.username`'s enrollment in the course, in any status.
	 *
	 * Visible to the course's owner and to the student themselves.
	 */
	@Validate({
		service: true,
		returns: enrollmentSchema.nullable(),
		args: [enrollmentPK],
	})
	async findOne(
		filter: EnrollmentPK,
		opts: ServiceOpts,
	): Promise<Enrollment | null> {
		const client = opts.tx ?? this.prisma;
		const course = await this.course(filter.courseId, opts);
		ensurePerm(opts.actor, "enrollment.read", {
			course: course.view,
			user: { username: filter.username },
		});

		const row = await client.enrollment.findUnique({
			where: {
				username_courseId: { username: filter.username, courseId: course.id },
			},
			include: enrollmentInclude,
		});
		return row && fromDb(row);
	}

	/**
	 * Lists a course's enrollments in `filter.status`, `ACTIVE` by default.
	 *
	 * The course's owner (or system) only; a non-owning admin is refused too.
	 */
	@Validate({
		service: true,
		returns: enrollmentSchema.array(),
		args: [enrollmentFilter],
	})
	async findMany(
		filter: EnrollmentFilter,
		opts: ServiceOpts,
	): Promise<Enrollment[]> {
		const client = opts.tx ?? this.prisma;
		const ref = "courseId" in filter ? filter.courseId : filter;
		const course = await this.course(ref, opts);
		ensurePerm(opts.actor, "enrollment.read", course.view);

		const rows = await client.enrollment.findMany({
			where: { courseId: course.id, status: filter.status ?? "ACTIVE" },
			include: enrollmentInclude,
			orderBy: { createdAt: "asc" },
		});
		return rows.map(fromDb);
	}

	// No update: the only mutable field is `status`, driven by create/delete.
	async update<Opt extends ServiceOpts>(
		_filter: EnrollmentPK,
		_update: never,
		_opts: Opt,
	): Promise<never> {
		throw new NotImplemented("enrollment.update");
	}

	// No upsert: `create` already reactivates a dropped enrollment.
	async upsert<Opt extends ServiceOpts>(
		_input: never,
		_opts: Opt,
	): Promise<never> {
		throw new NotImplemented("enrollment.upsert");
	}

	/**
	 * Marks the enrollment `DROPPED`; idempotent.
	 *
	 * The course's owner drops any student; a student drops only themselves (FR-CRS-042).
	 */
	@Validate({ service: true, args: [enrollmentPK] })
	async delete(filter: EnrollmentPK, opts: ServiceOpts): Promise<void> {
		const client = opts.tx ?? this.prisma;
		const course = await this.course(filter.courseId, opts);
		ensurePerm(opts.actor, "enrollment.delete", {
			course: course.view,
			user: { username: filter.username },
		});

		await client.enrollment.updateMany({
			where: { username: filter.username, courseId: course.id },
			data: { status: "DROPPED" },
		});
	}

	//
	// Utility methods
	//

	// Resolves a course reference to its id and the shape the enrollment
	// permissions need; throws `NotFound` for an unknown course.
	private async course(
		ref: CourseRef,
		opts: ServiceOpts,
	): Promise<{ id: CourseId; view: CourseTarget }> {
		const client = opts.tx ?? this.prisma;
		const course = valueOrNotFound(
			"course",
			await client.course.findUnique({
				where: courseRefWhere(ref),
				select: { id: true, instructor: { select: { username: true } } },
			}),
		);
		return {
			id: course.id as CourseId,
			view: { id: course.id, instructor: course.instructor },
		};
	}
}

//
// Auxiliary functions
//

// Convert a database enrollment record to the public-facing enrollment type.
function fromDb(row: DbEnrollment): Enrollment {
	const user = toUser(row.user);
	return {
		username: user.username,
		name: user.name,
		email: user.email,
		githubId: user.githubId,
		schoolId: user.schoolId,
		courseId: row.courseId as CourseId,
		status: row.status,
		enrolledAt: row.createdAt,
	};
}
