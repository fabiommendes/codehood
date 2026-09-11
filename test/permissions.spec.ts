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
import type { UserId } from "@/core/schemas";

const admin = {
	role: "ADMIN" as const,
	username: "admin",
	name: "Admin",
};
const instructor = {
	role: "INSTRUCTOR" as const,
	username: "instructor",
	name: "Instructor",
};
const student = {
	role: "STUDENT" as const,
	username: "student",
	name: "Student",
};

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
	expect(canManageApiKeys(instructor, instructor.username)).toBe(true);
	expect(canManageApiKeys(instructor, "other")).toBe(false);
	expect(canManageApiKeys(admin, "other")).toBe(true);
});

test("session ownership: owner or admin", () => {
	expect(canManageSessions(instructor, instructor.username)).toBe(true);
	expect(canManageSessions(instructor, "other")).toBe(false);
	expect(canManageSessions(admin, "other")).toBe(true);
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
	expect(canEditUser(student, student)).toBe(true);
	expect(canEditUser(student, { username: "other" as UserId })).toBe(false);
	expect(canEditUser(SYSTEM, { username: "other" as UserId })).toBe(true);
});

test("canViewUser and userVisibility agree: self and admins see everyone, others see only themselves", () => {
	const fixtures = [admin, instructor, student];
	const actors: Actor[] = [admin, instructor, student, SYSTEM];

	for (const actor of actors) {
		const visible = fixtures.filter((u) => canViewUser(actor, u));
		const expected =
			actor === SYSTEM || actor.role === "ADMIN"
				? fixtures
				: fixtures.filter((u) => u.username === actor.username);
		expect(visible).toEqual(expected);

		// The Prisma fragment must accept exactly the same rows the predicate does.
		const fragment = userVisibility(actor);
		if (actor === SYSTEM || actor.role === "ADMIN") {
			expect(fragment).toEqual({});
		} else {
			expect(fragment).toEqual({ username: actor.username });
		}
	}
});

test("canManageEnrollment is owner-only, unlike canManageCourse", () => {
	const course = {
		instructor: { id: instructor.username, username: instructor.username },
		enrollments: [],
	};
	expect(canManageEnrollment(instructor, course)).toBe(true);
	expect(canManageEnrollment(SYSTEM, course)).toBe(true);
	// The row that separates it from canManageCourse: an admin who does not
	// teach the course gets no branch here, even though canManageCourse
	// keeps granting it for the course record.
	expect(canManageEnrollment(admin, course)).toBe(false);
	expect(canManageCourse(admin, course)).toBe(true);
});

test("canDropEnrollment: the owning instructor, a student dropping themselves, never another student's userId", () => {
	const course = {
		instructor: { id: instructor.username, username: instructor.username },
		enrollments: [],
	};
	expect(canDropEnrollment(instructor, course, student.username)).toBe(true);
	expect(canDropEnrollment(student, course, student.username)).toBe(true);
	expect(canDropEnrollment(student, course, "other")).toBe(false);
	expect(canDropEnrollment(SYSTEM, course, student.username)).toBe(true);
});

test("canViewCourseContents is exactly canViewCourse, and courseContentsVisibility exactly courseVisibility", () => {
	const outsider = {
		role: "STUDENT" as const,
		username: "outsider",
		name: "Outsider",
	};
	const enrolled = {
		role: "STUDENT" as const,
		username: "enrolled",
		name: "Enrolled",
	};
	const course = {
		instructor: { id: instructor.username, username: instructor.username },
		enrollments: [{ username: enrolled.username, name: "" }],
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
	const course = { instructor: { username: instructor.username } };
	expect(canWriteCourseContent(SYSTEM, course)).toBe(true);
	expect(canWriteCourseContent(instructor, course)).toBe(true);
	// The row that separates it from canManageCourse: an admin who does not
	// teach the course gets no branch here.
	expect(canWriteCourseContent(admin, course)).toBe(false);
	expect(canWriteCourseContent(student, course)).toBe(false);
	const otherInstructor = {
		role: "INSTRUCTOR" as const,
		username: "other-instructor",
		name: "Other Instructor",
	};
	expect(canWriteCourseContent(otherInstructor, course)).toBe(false);
	// The point of the predicate: an admin who *is* the course's instructor
	// passes, because the check reads ownership and never the role.
	const teachingAdminCourse = { instructor: { username: admin.username } };
	expect(canWriteCourseContent(admin, teachingAdminCourse)).toBe(true);
});

test("SYSTEM bypasses every rule", () => {
	expect(isAtLeast(SYSTEM, "ADMIN")).toBe(true);
	expect(canInvite(SYSTEM, "INSTRUCTOR")).toBe(true);
	expect(canManageApiKeys(SYSTEM, "other")).toBe(true);
	expect(canManageSessions(SYSTEM, "other")).toBe(true);
	expect(canManageUsers(SYSTEM)).toBe(true);
	expect(canViewUser(SYSTEM, { username: "other" as UserId })).toBe(true);
});
