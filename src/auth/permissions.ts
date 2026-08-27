import { type Actor, type AuthUser, SYSTEM } from "@/db/base-service";
import type { Prisma, Role } from "@/db/client";

export type { AuthUser };

const ROLE_RANK: Record<Role, number> = {
	STUDENT: 0,
	INSTRUCTOR: 1,
	ADMIN: 2,
};

export function isAtLeast(actor: Actor, role: Role): boolean {
	if (actor === SYSTEM) return true;
	return ROLE_RANK[actor.role] >= ROLE_RANK[role];
}

/** Whether `actor` is allowed to create an invite for `targetRole`. */
export function canInvite(actor: Actor, targetRole: Role): boolean {
	if (actor === SYSTEM) return true;
	if (actor.role === "ADMIN")
		return targetRole === "INSTRUCTOR" || targetRole === "STUDENT";
	if (actor.role === "INSTRUCTOR") return targetRole === "STUDENT";
	return false;
}

/** Whether `actor` may issue/revoke API keys belonging to `ownerId`. */
export function canManageApiKeys(actor: Actor, ownerId: number): boolean {
	if (actor === SYSTEM) return true;
	return actor.id === ownerId || actor.role === "ADMIN";
}

/** Whether `actor` may revoke sessions belonging to `ownerId` ("log out everywhere"). */
export function canManageSessions(actor: Actor, ownerId: number): boolean {
	if (actor === SYSTEM) return true;
	return actor.id === ownerId || actor.role === "ADMIN";
}

export function canManageUsers(actor: Actor): boolean {
	return actor === SYSTEM || actor.role === "ADMIN";
}

/**
 * Whether `actor` may create a user account directly. Real accounts are
 * always created through invite redemption (actor `SYSTEM`, since the invite
 * token — not a role — is the authorization) or the `manage create-user` CLI
 * (also `SYSTEM`, since it runs with no session). No role gets a direct,
 * user-facing "create an account for someone else" path yet.
 */
export function canCreateUser(actor: Actor): boolean {
	return actor === SYSTEM;
}

/** Whether `actor` may edit the profile fields belonging to `userId`. */
export function canEditUser(actor: Actor, userId: number): boolean {
	return actor === SYSTEM || actor.id === userId;
}

/**
 * Whether `actor` may see `user` as a single record (`findOne`). Paired with
 * {@link userVisibility}, which is the same rule as a Prisma `where`
 * fragment for `findMany`; see the agreement test in `test/user-service.spec.ts`.
 */
export function canViewUser(actor: Actor, user: { id: number }): boolean {
	return actor === SYSTEM || actor.role === "ADMIN" || actor.id === user.id;
}

/** Prisma `where` fragment implementing the same rule as {@link canViewUser}. */
export function userVisibility(actor: Actor): Prisma.UserWhereInput {
	if (actor === SYSTEM || actor.role === "ADMIN") return {};
	return { id: actor.id };
}

/** Whether `actor` may create a discipline. There is no catalog-editor role yet. */
export function canCreateDiscipline(actor: Actor): boolean {
	return actor === SYSTEM || actor.role === "ADMIN";
}

/**
 * Whether `actor` may create a course taught by `instructorId`. An admin (or
 * `SYSTEM`, e.g. `manage create-course`) may name any instructor; anyone
 * else may only name themselves.
 */
export function canCreateCourseFor(
	actor: Actor,
	instructorId: number,
): boolean {
	return (
		actor === SYSTEM || actor.role === "ADMIN" || actor.id === instructorId
	);
}

/**
 * The shape `canViewCourse`/`canManageCourse` need from a loaded course row:
 * who teaches it, and who currently holds an `ACTIVE` enrollment in it.
 * Structural, not imported from `course.service.ts`, so that module can
 * import these predicates without a cycle.
 */
export interface CourseWithEnrollment {
	instructor: { id: number };
	enrollments: { userId: number }[];
}

/**
 * Whether `actor` may see `course` as a single record (`findOne`, or the UI
 * deciding whether to render a link). Paired with {@link courseVisibility};
 * see the agreement test in `test/course-service.spec.ts`.
 */
export function canViewCourse(
	actor: Actor,
	course: CourseWithEnrollment,
): boolean {
	if (actor === SYSTEM || actor.role === "ADMIN") return true;
	if (course.instructor.id === actor.id) return true;
	return course.enrollments.some((e) => e.userId === actor.id);
}

/** Prisma `where` fragment implementing the same rule as {@link canViewCourse}. */
export function courseVisibility(actor: Actor): Prisma.CourseWhereInput {
	if (actor === SYSTEM || actor.role === "ADMIN") return {};
	return {
		OR: [
			{ instructor: { id: actor.id } },
			{ enrollments: { some: { userId: actor.id, status: "ACTIVE" } } },
		],
	};
}

/**
 * Whether `actor` may create/update/delete `course`, or enroll/unenroll a
 * student in it. Only the instructor who teaches it, never someone merely
 * enrolled in it — an instructor taking a colleague's course as a student
 * does not get to manage that course.
 */
export function canManageCourse(
	actor: Actor,
	course: CourseWithEnrollment,
): boolean {
	return (
		actor === SYSTEM ||
		actor.role === "ADMIN" ||
		course.instructor.id === actor.id
	);
}
