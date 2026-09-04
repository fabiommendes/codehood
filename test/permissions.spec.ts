import { expect, test } from "@playwright/test";
import {
	canCreateUser,
	canDropEnrollment,
	canEditUser,
	canInvite,
	canManageApiKeys,
	canManageCourse,
	canManageEnrollment,
	canManageSessions,
	canManageUsers,
	canViewCourse,
	canViewCourseContents,
	canViewUser,
	canWriteCourseContent,
	courseContentsVisibility,
	courseVisibility,
	isAtLeast,
	userVisibility,
} from "@/auth/permissions";
import type { Actor } from "@/core/actor";
import { SYSTEM } from "@/core/actor";

const admin = { id: 1, role: "ADMIN" as const };
const instructor = { id: 2, role: "INSTRUCTOR" as const };
const student = { id: 3, role: "STUDENT" as const };

test("role hierarchy", () => {
	expect(isAtLeast(admin, "INSTRUCTOR")).toBe(true);
	expect(isAtLeast(student, "INSTRUCTOR")).toBe(false);
});

test("invite permissions follow admin -> instructor -> student", () => {
	expect(canInvite(admin, "INSTRUCTOR")).toBe(true);
	expect(canInvite(admin, "STUDENT")).toBe(true);
	expect(canInvite(instructor, "STUDENT")).toBe(true);
	expect(canInvite(instructor, "INSTRUCTOR")).toBe(false);
	expect(canInvite(student, "STUDENT")).toBe(false);
});

test("api key ownership: owner or admin", () => {
	expect(canManageApiKeys(instructor, instructor.id)).toBe(true);
	expect(canManageApiKeys(instructor, 999)).toBe(false);
	expect(canManageApiKeys(admin, 999)).toBe(true);
});

test("session ownership: owner or admin", () => {
	expect(canManageSessions(instructor, instructor.id)).toBe(true);
	expect(canManageSessions(instructor, 999)).toBe(false);
	expect(canManageSessions(admin, 999)).toBe(true);
});

test("only admins manage users", () => {
	expect(canManageUsers(admin)).toBe(true);
	expect(canManageUsers(instructor)).toBe(false);
});

test("the system and admins create user accounts directly", () => {
	expect(canCreateUser(SYSTEM)).toBe(true);
	expect(canCreateUser(admin)).toBe(true);
	expect(canCreateUser(instructor)).toBe(false);
	expect(canCreateUser(student)).toBe(false);
});

test("users edit only their own profile", () => {
	expect(canEditUser(student, student.id)).toBe(true);
	expect(canEditUser(student, 999)).toBe(false);
	expect(canEditUser(SYSTEM, 999)).toBe(true);
});

test("canViewUser and userVisibility agree: self and admins see everyone, others see only themselves", () => {
	const fixtures = [admin, instructor, student];
	const actors: Actor[] = [admin, instructor, student, SYSTEM];

	for (const actor of actors) {
		const visible = fixtures.filter((u) => canViewUser(actor, u));
		const expected =
			actor === SYSTEM || actor.role === "ADMIN"
				? fixtures
				: fixtures.filter((u) => u.id === actor.id);
		expect(visible).toEqual(expected);

		// The Prisma fragment must accept exactly the same rows the predicate does.
		const fragment = userVisibility(actor);
		if (actor === SYSTEM || actor.role === "ADMIN") {
			expect(fragment).toEqual({});
		} else {
			expect(fragment).toEqual({ id: actor.id });
		}
	}
});

test("canManageEnrollment is owner-only, unlike canManageCourse", () => {
	const course = { instructor: { id: instructor.id }, enrollments: [] };
	expect(canManageEnrollment(instructor, course)).toBe(true);
	expect(canManageEnrollment(SYSTEM, course)).toBe(true);
	// The row that separates it from canManageCourse: an admin who does not
	// teach the course gets no branch here, even though canManageCourse
	// keeps granting it for the course record.
	expect(canManageEnrollment(admin, course)).toBe(false);
	expect(canManageCourse(admin, course)).toBe(true);
});

test("canDropEnrollment: the owning instructor, a student dropping themselves, never another student's userId", () => {
	const course = { instructor: { id: instructor.id }, enrollments: [] };
	expect(canDropEnrollment(instructor, course, student.id)).toBe(true);
	expect(canDropEnrollment(student, course, student.id)).toBe(true);
	expect(canDropEnrollment(student, course, 999)).toBe(false);
	expect(canDropEnrollment(SYSTEM, course, student.id)).toBe(true);
});

test("canViewCourseContents is exactly canViewCourse, and courseContentsVisibility exactly courseVisibility", () => {
	const outsider = { id: 999, role: "STUDENT" as const };
	const enrolled = { id: 4, role: "STUDENT" as const };
	const course = {
		instructor: { id: instructor.id },
		enrollments: [{ userId: enrolled.id }],
	};
	const viewActors: Actor[] = [SYSTEM, admin, instructor, enrolled, outsider];
	for (const actor of viewActors) {
		expect(canViewCourseContents(actor, course)).toBe(
			canViewCourse(actor, course),
		);
	}
	const visibilityActors: Actor[] = [SYSTEM, admin, instructor, student];
	for (const actor of visibilityActors) {
		expect(courseContentsVisibility(actor)).toEqual(courseVisibility(actor));
	}
});

test("canWriteCourseContent is SYSTEM or the course's own instructor, with no admin branch", () => {
	const course = { instructor: { id: instructor.id } };
	expect(canWriteCourseContent(SYSTEM, course)).toBe(true);
	expect(canWriteCourseContent(instructor, course)).toBe(true);
	// The row that separates it from canManageCourse: an admin who does not
	// teach the course gets no branch here.
	expect(canWriteCourseContent(admin, course)).toBe(false);
	expect(canWriteCourseContent(student, course)).toBe(false);
	const otherInstructor = { id: 5, role: "INSTRUCTOR" as const };
	expect(canWriteCourseContent(otherInstructor, course)).toBe(false);
	// The point of the predicate: an admin who *is* the course's instructor
	// passes, because the check reads ownership and never the role.
	const teachingAdminCourse = { instructor: { id: admin.id } };
	expect(canWriteCourseContent(admin, teachingAdminCourse)).toBe(true);
});

test("SYSTEM bypasses every rule", () => {
	expect(isAtLeast(SYSTEM, "ADMIN")).toBe(true);
	expect(canInvite(SYSTEM, "INSTRUCTOR")).toBe(true);
	expect(canManageApiKeys(SYSTEM, 999)).toBe(true);
	expect(canManageSessions(SYSTEM, 999)).toBe(true);
	expect(canManageUsers(SYSTEM)).toBe(true);
	expect(canViewUser(SYSTEM, { id: 999 })).toBe(true);
});
