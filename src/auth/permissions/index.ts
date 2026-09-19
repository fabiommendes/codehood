import { type Actor, SYSTEM, type UserActor } from "@/auth/actor";
import type { schema, User } from "@/db";
import type { Role } from "@/db/client";

type UserId = schema.UserId;

import { NotAllowed } from "@/core/error";
import type { Assert, AssertNever, NotNever, Pretty } from "@/typing";
import type { JSONObject, JSONValue } from "@/typing/concrete-types";
import type {
	DuplicateKeys,
	ExpandKeys,
	ExpandPermDefs,
	MissingAudit,
	PermDef,
	PermDefExpanded,
	PermOverloads,
	TargetSimplifier,
} from "./permission-typing";

/// Every permission checkable through {@link hasPerm}/{@link ensurePerm}, derived from `PERMISSIONS` so an undefined permission is a type error.
export type Perm = keyof PermDefsByKey;

/// CRUD actions available for all entities
export type PermAction = "create" | "read" | "update" | "delete";

/// Entities for which permissions can be defined
export type RoleEntity =
	| "system"
	| "user"
	| "course"
	| "enrollment"
	| "invite"
	| "discipline"
	| "edition"
	| "question"
	| "api-key"
	| "session";

/// Extra permissions not covered by the standard RoleEntity.PermAction pattern
type ExtraPerms =
	| "course.create-outside-window"
	| "course.read-contents"
	| "course.update-contents"
	| "question.read-public"
	| "api-key.manage"
	| "session.manage"
	| "enrollment.manage"
	| "system.manage";

/// The allowed `entity.action` vocabulary, checked against `PERMISSIONS`' keys by `_AssertPermissionsKeys`.
type PermVocab = `${RoleEntity}.${PermAction}` | ExtraPerms;

// -----------------------------------------------------------------------------
// Main API functions

/**
 * Checks if the given `actor` has the specified `perm` on the optional target `on`.
 *
 * Use this or {@link ensurePerm} to check if an actor has a specific permission.
 */
export const hasPerm = hasPermImpl as PermOverloads<PermDefsByKey, boolean>;

/**
 * Ensures that the given `actor` has the specified `perm` on the optional target `on`.
 *
 * @throws {NotAllowed} If the actor does not have the permission.
 */
export const ensurePerm = ((actor: Actor, perm: Perm, on?: unknown): void => {
	if (!hasPermImpl(actor, perm, on)) {
		throw new NotAllowed(perm, { target: simplifyTargetImpl(perm, on) });
	}
}) as PermOverloads<PermDefsByKey, void>;

/**
 * Reduces a permission target to the minimal fields worth recording, so audits
 * and error responses never carry the whole row.
 *
 * Permissions without an `audit` reducer record nothing.
 */
export const simplifyTarget =
	simplifyTargetImpl as TargetSimplifier<PermDefsByKey>;

// -----------------------------------------------------------------------------
// Permission Definitions

type UserTarget = Pick<User, "username">;

/// Minimal course shape for ownership checks. `id` is only used for auditing.
export type CourseTarget = { id?: number; instructor: { username: string } };

/**
 * The shape the `course.read`/`course.read-contents`/`course.update`/
 * `course.delete` permissions need from a loaded course row: who teaches it,
 * and who currently holds an `ACTIVE` enrollment in it.
 *
 * Structural, not imported from `course.service.ts`, so that module can pass
 * these targets without a cycle.
 *
 * `enrollments` is keyed by `username`, matching the `Enrollment` model column
 * (see `courseWhere` and `courseInclude` in `course.service.ts`) — not what
 * the *public* `Course.enrollments` shape uses after `fromDb` renames it.
 * Passing that public shape back in (e.g. `toEnrollmentView`) means mapping
 * it to `username` first.
 */
export interface CourseWithEnrollment {
	id?: number;
	instructor: { username: string };
	enrollments: { username: UserId }[] | UserId[];
}

/// A single user's enrollment in a course.
export type EnrollmentTarget = { course: CourseTarget; user: UserTarget };

/// Role an invite being created grants on redemption.
export type InviteCreateTarget = { invitedRole: Role };

/// Existing invite, identified by who issued it. `id` is only used for auditing.
export type InviteTarget = { id?: number; createdBy: UserTarget };

/**
 * The shape the `question.read`/`question.read-public` permissions need from
 * a loaded question row. `id` is only used for auditing.
 *
 * `course` accepts either course shape: `question.read` only ever checks
 * ownership, so a bare {@link CourseTarget} is enough; `question.read-public`
 * additionally checks course-contents visibility, which needs the
 * enrollments {@link CourseWithEnrollment} carries.
 */
export interface QuestionWithCourse {
	id?: number;
	status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
	course: CourseTarget | CourseWithEnrollment;
}

/// Permissions are declared in a single object so hasPerm can statically verify
/// the target types at compile time.
///
/// Some guidelines:
///
/// * Keep the natural language description of business rules clear and concise.
/// * Unless explicitly mentioned, SYSTEM and admin have full permissions. No
///   need to declare them in each rule.
/// * The audit helpers are defined in the end of this file or inline, if not reused.
const PERMISSIONS = {
	// SYSTEM ------------------------------------------------------------------
	// Rule: only admins can manage the system globally
	"system.manage": { admin: true },

	// USER --------------------------------------------------------------------
	// Rule: only admins can create and remove new users
	"user.create | user.delete": { admin: true },

	// Rule: users can only read or edit their own information.
	"user.read | user.update": {
		admin: true,
		other: (actor, target) => actor.username === target.username,
		audit: (target) => ({ username: target.username }),
	} satisfies PermDef<UserTarget>,

	// ENROLLMENT --------------------------------------------------------------
	// A course target covers all its enrollments; `{ course, user }` covers one.

	// Rule: only the course's owner enrolls students or runs the course's
	// operations (invites, roster, manage pages).
	"enrollment.create | enrollment.update | enrollment.manage": {
		admin: true,
		other: (actor, target) => isCourseOwner(actor, courseOf(target)),
		audit: auditEnrollment,
	} satisfies PermDef<CourseTarget | EnrollmentTarget>,

	// Rule: the course's owner sees and drops any enrollment; a student sees
	// and drops only their own.
	"enrollment.read | enrollment.delete": {
		other: (actor, target) =>
			isCourseOwner(actor, courseOf(target)) ||
			("user" in target && target.user.username === actor.username),
		audit: auditEnrollment,
	} satisfies PermDef<CourseTarget | EnrollmentTarget>,

	// INVITE ------------------------------------------------------------------
	// Rule: invites follow the role hierarchy. Admins invite instructors and
	// students, instructors invite students, students invite no one.
	"invite.create": {
		admin: (_, target) => target.invitedRole !== "ADMIN",
		instructor: (_, target) => target.invitedRole === "STUDENT",
		student: false,
		audit: (target) => ({ invitedRole: target.invitedRole }),
	} satisfies PermDef<InviteCreateTarget>,

	// Rule: seeing an invite and controlling it are the same right.
	// Instructors controls invites they issued.
	"invite.read | invite.update | invite.delete": {
		admin: true,
		student: false,
		instructor: (actor, target) => target.createdBy.username === actor.username,
		audit: (target) => ({
			...(target.id !== undefined && { id: target.id }),
			createdBy: target.createdBy.username,
		}),
	} satisfies PermDef<InviteTarget>,

	// DISCIPLINE --------------------------------------------------------------
	// Rule: only admins manage disciplines. A discipline slug occupies the
	// root URL namespace shared with every system route.
	"discipline.create | discipline.update | discipline.delete": { admin: true },

	// EDITION -----------------------------------------------------------------
	// Rule: only admins. Edition slugs appear in every course URL.
	"edition.create | edition.update | edition.delete": { admin: true },

	// Rule: only admins create a course in an edition whose active window is
	// closed, e.g. fixing a course after the term rolls over.
	"course.create-outside-window": { admin: true },

	// COURSE --------------------------------------------------------------------
	// Rule: SYSTEM and admins may name any instructor; anybody else only
	// themselves. The actor's role is otherwise not consulted.
	"course.create": {
		admin: true,
		other: (actor, target) => actor.username === target.instructor.username,
		audit: auditCourse,
	} satisfies PermDef<CourseTarget>,

	// Rule: SYSTEM, admin, the course's instructor, or an `ACTIVE` enrollment.
	// `course.read` and `course.read-contents` are the same rule today; they
	// stay separate keys because `course.read` will later widen to any
	// authenticated user.
	"course.read | course.read-contents": {
		admin: true,
		other: (actor, target) =>
			isCourseOwner(actor, target) || isEnrolled(actor, target),
		audit: auditCourse,
	} satisfies PermDef<CourseWithEnrollment>,

	// Rule: SYSTEM or the course's own instructor. No admin branch — an admin
	// who does not teach the course is denied (FR-ACC-010). Unlike
	// `course.update`/`course.delete`, a non-owning admin gets no branch here:
	// an admin's authority stops at the course *record* (`/admin/courses`),
	// and never reaches into content only its instructor may write. Contrast
	// `enrollment.manage`, which covers course *operations* and is the other
	// permission with no admin branch.
	"course.update-contents": {
		other: (actor, target) => isCourseOwner(actor, target),
		audit: auditCourse,
	} satisfies PermDef<CourseTarget>,

	// Rule: SYSTEM, any admin, or the instructor (FR-ACC-011) — that authority
	// is exercised from `/admin/courses`, not from the course itself. Contrast
	// `enrollment.manage`, which covers course *operations* and pointedly does
	// not grant them to a non-owning admin.
	"course.update | course.delete": {
		admin: true,
		other: (actor, target) => isCourseOwner(actor, target),
		audit: auditCourse,
	} satisfies PermDef<CourseWithEnrollment>,

	// QUESTION ------------------------------------------------------------------
	// Rule: the whole document goes to whoever may write it — identical to
	// `course.update-contents` on `question.course`, so a non-owning admin is
	// denied here too.
	"question.read": {
		other: (actor, target) => isCourseOwner(actor, target.course),
		audit: auditQuestion,
	} satisfies PermDef<QuestionWithCourse>,

	// Rule: the public half goes to whoever may write the question, or, once
	// `PUBLISHED`, to whoever may see the course's contents; a draft or
	// archived question is its author's alone.
	"question.read-public": {
		other: (actor, target) =>
			isCourseOwner(actor, target.course) ||
			(target.status === "PUBLISHED" && courseVisible(actor, target.course)),
		audit: auditQuestion,
	} satisfies PermDef<QuestionWithCourse>,

	// API KEY / SESSION ----------------------------------------------------------
	// Rule: the owner, any admin, or SYSTEM.
	"api-key.manage | session.manage": {
		admin: true,
		other: (actor, owner) => actor.username === owner,
		audit: (owner) => ({ owner }),
	} satisfies PermDef<UserId>,
} as const;

/// Whether `actor` teaches `course`, regardless of role.
function isCourseOwner(
	actor: UserActor,
	course: { instructor: { username: string } },
): boolean {
	return course.instructor.username === actor.username;
}

/// Whether `actor` holds an `ACTIVE` enrollment in `course`.
function isEnrolled(actor: UserActor, course: CourseWithEnrollment): boolean {
	return course.enrollments.some((e) =>
		typeof e === "object"
			? e.username === actor.username
			: e === actor.username,
	);
}

/// Whether `actor` may see `course`'s contents: an admin, its instructor, or an `ACTIVE` enrollment.
function courseVisible(
	actor: UserActor,
	course: CourseTarget | CourseWithEnrollment,
): boolean {
	return (
		actor.role === "ADMIN" ||
		isCourseOwner(actor, course) ||
		("enrollments" in course && isEnrolled(actor, course))
	);
}

/// Course of an enrollment permission target.
function courseOf(target: CourseTarget | EnrollmentTarget): CourseTarget {
	return "course" in target ? target.course : target;
}

/// Audit record of an enrollment target: the course, plus the user for a single enrollment.
function auditEnrollment(target: CourseTarget | EnrollmentTarget): JSONObject {
	const course = courseOf(target);
	return {
		...(course.id !== undefined ? { id: course.id } : {}),
		instructor: course.instructor.username,
		...("user" in target && { user: target.user.username }),
	};
}

/// Audit record of a course target: its `id`, if the target carries one, plus its instructor.
function auditCourse(target: CourseTarget | CourseWithEnrollment): JSONObject {
	return {
		...(target.id !== undefined && { id: target.id }),
		instructor: target.instructor.username,
	};
}

/// Audit record of a question target: its `id`, if carried, its status, and its course's audit record.
function auditQuestion(target: QuestionWithCourse): JSONObject {
	return {
		...(target.id !== undefined && { id: target.id }),
		status: target.status,
		course: auditCourse(target.course),
	};
}

/// Each permission of `PERMISSIONS` paired with its definition, `"a | b"` keys split apart.
const _PERMISSION_ENTRIES = Object.entries(PERMISSIONS).flatMap(
	([key, value]) =>
		key.split(" | ").map((k) => [k.trim(), value as PermDef<unknown>] as const),
);

/// `audit` reducer of each permission that defines one.
const _AUDITORS: Record<string, (target: unknown) => JSONValue> =
	Object.fromEntries(
		_PERMISSION_ENTRIES.flatMap(([k, data]) =>
			data.audit ? [[k, data.audit]] : [],
		),
	);

const _EXPANDED_PERMISSIONS = (() => {
	const expanded = {} as Record<string, unknown>;
	for (const [k, data] of _PERMISSION_ENTRIES) {
		expanded[k] = {
			system: data.system ?? true,
			admin: data.admin ?? data.other ?? false,
			instructor: data.instructor ?? data.other ?? false,
			student: data.student ?? data.other ?? false,
		};
	}
	return expanded as Pretty<ExpandPermDefs<ExpandKeys<typeof PERMISSIONS>>>;
	// return expanded as Pretty<ExpandKeys<typeof PERMISSIONS>>;
})();

type PermKey = keyof typeof _EXPANDED_PERMISSIONS;

// Static compile checks. On failure, the error names the offending permissions.
type _AssertPermissionsKeys = AssertNever<
	Exclude<keyof ExpandKeys<typeof PERMISSIONS>, PermVocab>
>;
type _AssertPermissionsUnique = AssertNever<DuplicateKeys<typeof PERMISSIONS>>;
type _AssertPermissionsAudited = AssertNever<MissingAudit<PermDefsByKey>>;
type _AssertPermissionsValues = Assert<
	NotNever<
		// biome-ignore lint/suspicious/noExplicitAny: `PermDef<any>` matches a definition of any target type.
		(typeof PERMISSIONS)[keyof typeof PERMISSIONS] extends PermDef<any>
			? (typeof PERMISSIONS)[keyof typeof PERMISSIONS]
			: never
	>
>;

type PermDefsByKey = ExpandKeys<typeof PERMISSIONS>;

// -----------------------------------------------------------------------------
// Auxiliary functions and types

/// Untyped implementation of `simplifyTarget`, also used by `assertPerm`.
function simplifyTargetImpl(
	perm: Perm,
	target?: unknown,
): JSONValue | undefined {
	const audit = _AUDITORS[perm];
	return audit && target !== undefined ? audit(target) : undefined;
}

/// Private non-curried implementation of hasPerm(). We also define the
/// overrides here to statically check if the method requires an "on" argument
/// and if it has the correct type
function hasPermImpl<T>(
	actor: Actor,
	perm: Perm,
	on: T = undefined as unknown as T,
): boolean {
	const perms = _EXPANDED_PERMISSIONS[perm as PermKey] as PermDefExpanded<T>;
	if (actor === SYSTEM)
		return typeof perms.system === "boolean" ? perms.system : perms.system(on);

	const userActor = actor;

	function call(obj: boolean | ((actor: UserActor, target: T) => boolean)) {
		return typeof obj === "boolean" ? obj : obj(userActor, on);
	}

	switch (actor.role) {
		case "ADMIN":
			return call(perms.admin);
		case "INSTRUCTOR":
			return call(perms.instructor);
		case "STUDENT":
			return call(perms.student);
		default:
			return false;
	}
}
