import { type Actor, type AuthUser, SYSTEM } from "@/db/base-service";
import type { Prisma, Role } from "@/db/client";
import type { User } from "@/db/user.service";
import type { Impl, Require } from "@/utils/types";


const ROLE_RANK: Record<Role, number> = {
	STUDENT: 0,
	INSTRUCTOR: 1,
	ADMIN: 2,
};

/**
 * True if `actor` has at least the given `role`. SYSTEM is the highest role.
 */
export function isAtLeast(actor: Actor, role: Role): boolean {
	if (actor === SYSTEM) return true;
	return ROLE_RANK[actor.role] >= ROLE_RANK[role];
}

/** 
 * Actor can invite users with the given `targetRole`.
 * 
 * - SYSTEM can invite any role, 
 * - ADMIN can invite INSTRUCTOR or STUDENT
 * - INSTRUCTOR can only invite STUDENT
 * - STUDENT cannot invite anyone.
 */
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
 * Can create new users:
 * - SYSTEM
 * - Admins
 */
export function canCreateUser(actor: Actor): boolean {
	return actor === SYSTEM || actor.role === "ADMIN";
}

/** 
 * Can edit an user:
 * 
 * 	- SYSTEM
 *  - Admins
 *  - The user themselves
 */
export function canEditUser(actor: Actor, user: Impl<User, "id">): boolean {
	return actor === SYSTEM || actor.role === "ADMIN" || actor.id === user.id;
}

/**
 * Can view details of an user:
 * 
 * 	- SYSTEM
 * 	- Admins
 *  - The user themselves
 */
export function canViewUser(actor: Actor, user: Impl<User, "id">): boolean {
	return actor === SYSTEM || actor.role === "ADMIN" || actor.id === user.id;
}

/** Prisma `where` fragment implementing the same rule as {@link canViewUser}. */
export function userVisibility(actor: Actor): Prisma.UserWhereInput {
	if (actor === SYSTEM || actor.role === "ADMIN") return {};
	return { id: actor.id };
}

/**
 * Whether `actor` may create, rename, or remove a discipline. There is no
 * catalog-editor role yet, and a discipline slug occupies the root URL
 * namespace shared with every system route, so this stays with admins.
 */
export function canManageDisciplines(actor: Actor): boolean {
	return actor === SYSTEM || actor.role === "ADMIN";
}

/**
 * Whether `actor` may create, edit, or remove an academic edition. Editions
 * are shared infrastructure — their slugs appear in every course URL — so
 * they belong to admins, like disciplines.
 */
export function canManageEditions(actor: Actor): boolean {
	return actor === SYSTEM || actor.role === "ADMIN";
}

/**
 * Whether `actor` may create a course in an edition whose active window has
 * closed (or not opened yet). The window exists to keep instructors inside the
 * current term; an admin fixing a course after the term rolls over, and
 * `SYSTEM` seeding historical data, both need to ignore it.
 */
export function canCreateCourseOutsideWindow(actor: Actor): boolean {
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
 * Whether `actor` may see a course's contents — its resources, questions,
 * exams, and calendar. Exactly {@link canViewCourse} today: system, admin,
 * the course's instructor, or an `ACTIVE` enrollment. Split into its own name
 * because FR-CRS-030 will widen `canViewCourse` to "any authenticated user may
 * see a course exists", and every content-visibility call site needs to keep
 * this narrower rule when that happens.
 */
export function canViewCourseContents(
	actor: Actor,
	course: CourseWithEnrollment,
): boolean {
	return canViewCourse(actor, course);
}

/** Prisma `where` fragment implementing the same rule as {@link canViewCourseContents}. */
export function courseContentsVisibility(
	actor: Actor,
): Prisma.CourseWhereInput {
	return courseVisibility(actor);
}

/**
 * Whether `actor` may write a course's content — resources, questions, exams,
 * calendar. `SYSTEM` or the course's own instructor; the actor's role is not
 * consulted at all (FR-ACC-010). Unlike {@link canManageCourse}, a non-owning
 * admin gets no branch here — an admin's authority stops at the course
 * *record* (`/admin/courses`), and never reaches into content only its
 * instructor may write. Contrast {@link canManageEnrollment}, which covers
 * course *operations* and is the other predicate with no admin branch.
 */
export function canWriteCourseContent(
	actor: Actor,
	course: { instructor: { id: number } },
): boolean {
	return actor === SYSTEM || course.instructor.id === actor.id;
}

/**
 * Whether `actor` may create/update/delete `course`'s record, or archive it.
 * An admin may, alongside the course's own instructor (FR-ACC-011) — that
 * authority is exercised from `/admin/courses`, not from the course itself.
 * Contrast {@link canManageEnrollment}, which covers course *operations* and
 * pointedly does not grant them to a non-owning admin.
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

/**
 * Whether `actor` may run course operations: enrolling or dropping a
 * student, issuing or revoking a classroom invite, and opening `/manage` or
 * `/roster`. Owner only — unlike {@link canManageCourse}, an admin who does
 * not teach the course gets no branch here (see the "Who sees what" table in
 * `02-courses.md`: **Admin, other** reads `Manage: no`).
 */
export function canManageEnrollment(
	actor: Actor,
	course: CourseWithEnrollment,
): boolean {
	return actor === SYSTEM || course.instructor.id === actor.id;
}

/**
 * Whether `actor` may drop `userId`'s enrollment in `course`: the course's
 * owner dropping any student, or a student dropping themselves (FR-CRS-042).
 * A student naming somebody else's `userId` gets neither branch — the case
 * that would otherwise turn a self-service "Leave course" control into a way
 * to expel a classmate.
 */
export function canDropEnrollment(
	actor: Actor,
	course: CourseWithEnrollment,
	userId: number,
): boolean {
	if (actor === SYSTEM) return true;
	return canManageEnrollment(actor, course) || actor.id === userId;
}

/**
 * The shape `canViewInvite` needs from a loaded invite: who created it.
 * Structural, not imported from `invite.service.ts`, so that module can import
 * this predicate without a cycle.
 */
export interface InviteWithCreator {
	createdById: number;
}

/**
 * Whether `actor` may see and control `invite`. Seeing an invite and revoking
 * it are the same right here: an admin holds both over every invite, an
 * instructor over the ones they issued, and a student over none — a student
 * has no invite-creating path, so there is nothing for them to hold.
 *
 * Paired with {@link inviteVisibility}; see the agreement test in
 * `test/invite-service.spec.ts`.
 */
export function canViewInvite(
	actor: Actor,
	invite: InviteWithCreator,
): boolean {
	if (actor === SYSTEM || actor.role === "ADMIN") return true;
	if (actor.role === "STUDENT") return false;
	return invite.createdById === actor.id;
}

/** Prisma `where` fragment implementing the same rule as {@link canViewInvite}. */
export function inviteVisibility(actor: Actor): Prisma.InviteWhereInput {
	if (actor === SYSTEM || actor.role === "ADMIN") return {};
	if (actor.role === "STUDENT") return { id: { in: [] } };
	return { createdById: actor.id };
}
