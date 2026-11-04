import type { z } from "zod";
import { type CourseTarget, ensurePerm } from "@/auth/permissions";
import {
	type CourseId,
	enrollmentCreate,
	enrollmentFilter,
	enrollmentPK,
	enrollmentSchema,
} from "@/core/schemas";
import type { ServiceOptsWithoutTx } from "@/db/base-service";
import { defineService, op } from "@/db/define-service";
import type { Prisma, PrismaTx } from "../client";
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

type DbEnrollment = Prisma.EnrollmentGetPayload<{
	include: typeof enrollmentInclude;
}>;

type CourseRef = EnrollmentCreate["course"];

// The full user row, so `toUser` can unmask `githubId`/`schoolId`.
const enrollmentInclude = { user: true } satisfies Prisma.EnrollmentInclude;

/// The CRUD shape of the enrollment service. `update` and `upsert` are off:
/// the only mutable field is `status`, driven by `create` and `delete`.
type EnrollmentT = {
	entity: Enrollment;
	pkFilter: EnrollmentPK;
	create: EnrollmentCreate;
	filter: EnrollmentFilter;
	update: EnrollmentUpdate;
	upsert: false;
};

/**
 * A student's membership in a course.
 *
 * Dropping marks the row `DROPPED` rather than deleting it, so re-enrolling
 * keeps history. Students cannot list their classmates, a privacy default
 * rather than a technical limit.
 */
export const makeEnrollmentService = defineService<EnrollmentT>()(() => {
	/**
	 * Enrolls `input.username` in the course, or reactivates a `DROPPED` enrollment.
	 *
	 * The course's owner (or system) only: a student joins through a classroom
	 * invite, which enrolls them as `SYSTEM` inside the redemption transaction.
	 */
	const create = op({
		args: [enrollmentCreate],
		returns: enrollmentSchema,
		run: async (
			tx: PrismaTx,
			input: EnrollmentCreate,
			opts: ServiceOptsWithoutTx,
		): Promise<Enrollment> => {
			const course = await resolveCourse(tx, input.course);
			ensurePerm(opts.actor, "enrollment.create", course.view);

			const row = await tx.enrollment.upsert({
				where: {
					username_courseId: { username: input.username, courseId: course.id },
				},
				update: { status: "ACTIVE" },
				create: { username: input.username, courseId: course.id },
				include: enrollmentInclude,
			});
			return fromDb(row);
		},
	});

	/**
	 * Finds `filter.username`'s enrollment in the course, in any status.
	 *
	 * Visible to the course's owner and to the student themselves.
	 */
	const findOne = op({
		transaction: false,
		args: [enrollmentPK],
		returns: enrollmentSchema.nullable(),
		run: async (
			tx: PrismaTx,
			filter: EnrollmentPK,
			opts: ServiceOptsWithoutTx,
		): Promise<Enrollment | null> => {
			const course = await resolveCourse(tx, filter.course);
			ensurePerm(opts.actor, "enrollment.read", {
				course: course.view,
				user: { username: filter.username },
			});

			const row = await tx.enrollment.findUnique({
				where: {
					username_courseId: { username: filter.username, courseId: course.id },
				},
				include: enrollmentInclude,
			});
			return row && fromDb(row);
		},
	});

	/**
	 * Lists a course's enrollments in `filter.status` (one or several), `ACTIVE` by default.
	 *
	 * The course's owner (or system) only; a non-owning admin is refused too.
	 */
	const findMany = op({
		transaction: false,
		args: [enrollmentFilter],
		returns: enrollmentSchema.array(),
		run: async (
			tx: PrismaTx,
			filter: EnrollmentFilter,
			opts: ServiceOptsWithoutTx,
		): Promise<Enrollment[]> => {
			const course = await resolveCourse(tx, filter.course);
			ensurePerm(opts.actor, "enrollment.read", course.view);

			const rows = await tx.enrollment.findMany({
				where: {
					courseId: course.id,
					status: { in: [filter.status ?? "ACTIVE"].flat() },
				},
				include: enrollmentInclude,
				orderBy: { createdAt: "asc" },
			});
			return rows.map(fromDb);
		},
	});

	/**
	 * Marks the enrollment `DROPPED`; idempotent.
	 *
	 * The course's owner drops any student; a student drops only themselves.
	 */
	const remove = op({
		args: [enrollmentPK],
		run: async (
			tx: PrismaTx,
			filter: EnrollmentPK,
			opts: ServiceOptsWithoutTx,
		): Promise<void> => {
			const course = await resolveCourse(tx, filter.course);
			ensurePerm(opts.actor, "enrollment.delete", {
				course: course.view,
				user: { username: filter.username },
			});

			await tx.enrollment.updateMany({
				where: { username: filter.username, courseId: course.id },
				data: { status: "DROPPED" },
			});
		},
	});

	return { create, findOne, findMany, delete: remove };
});

/** The enrollment service, as built by {@link makeEnrollmentService}. */
export type EnrollmentService = ReturnType<typeof makeEnrollmentService>;

//
// Auxiliary functions
//

// Resolves a course reference to its id and the shape the enrollment
// permissions need; throws `NotFound` for an unknown course.
async function resolveCourse(
	tx: PrismaTx,
	ref: CourseRef,
): Promise<{ id: CourseId; view: CourseTarget }> {
	const course = valueOrNotFound(
		"course",
		await tx.course.findUnique({
			where: courseRefWhere(ref),
			select: { id: true, instructor: { select: { username: true } } },
		}),
	);
	return {
		id: course.id as CourseId,
		view: { id: course.id, instructor: course.instructor },
	};
}

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
