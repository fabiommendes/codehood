import { expect, test } from "@playwright/test";
import type { Actor } from "@/auth/actor";
import { hasMinimumRole, SYSTEM } from "@/auth/actor";
import { ensurePerm, hasPerm, simplifyTarget } from "@/auth/permissions";
import { NotAllowed } from "@/core/error";
import type { UserId } from "@/core/schemas";
import { courseContentsWhere, courseWhere } from "@/db/services/course.service";
import { userWhere } from "@/db/services/user.service";

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
const otherInstructor = {
	role: "INSTRUCTOR" as const,
	username: "other-instructor",
	name: "Other Instructor",
};
const student = {
	role: "STUDENT" as const,
	username: "student",
	name: "Student",
};
const enrolledStudent = {
	role: "STUDENT" as const,
	username: "enrolled",
	name: "Enrolled",
};
const outsiderStudent = {
	role: "STUDENT" as const,
	username: "outsider",
	name: "Outsider",
};

/// A course taught by `instructor`, with `enrolledStudent` as its only ACTIVE enrollment.
function courseFixture(id = 1) {
	return {
		id,
		instructor: { username: instructor.username },
		enrollments: [{ username: enrolledStudent.username }],
	};
}

test("role hierarchy", () => {
	expect(hasMinimumRole(admin, "INSTRUCTOR")).toBe(true);
	expect(hasMinimumRole(student, "INSTRUCTOR")).toBe(false);
});

test("invite permissions follow admin -> instructor -> student", () => {
	const invite = (invitedRole: "ADMIN" | "INSTRUCTOR" | "STUDENT") =>
		({ invitedRole }) as const;
	expect(hasPerm(admin, "invite.create", invite("INSTRUCTOR"))).toBe(true);
	expect(hasPerm(admin, "invite.create", invite("STUDENT"))).toBe(true);
	expect(hasPerm(admin, "invite.create", invite("ADMIN"))).toBe(false);
	expect(hasPerm(instructor, "invite.create", invite("STUDENT"))).toBe(true);
	expect(hasPerm(instructor, "invite.create", invite("INSTRUCTOR"))).toBe(
		false,
	);
	expect(hasPerm(student, "invite.create", invite("STUDENT"))).toBe(false);
});

test("invite read/update/delete: admins on every invite, instructors on their own, students never", () => {
	const own = { createdBy: { username: instructor.username } };
	const others = { createdBy: { username: "other" } };
	for (const perm of [
		"invite.read",
		"invite.update",
		"invite.delete",
	] as const) {
		expect(hasPerm(admin, perm, others), perm).toBe(true);
		expect(hasPerm(instructor, perm, own), perm).toBe(true);
		expect(hasPerm(instructor, perm, others), perm).toBe(false);
		expect(hasPerm(student, perm, own), perm).toBe(false);
		expect(hasPerm(SYSTEM, perm, others), perm).toBe(true);
	}
});

test("disciplines, editions and out-of-window courses are admin-only", () => {
	for (const perm of [
		"discipline.create",
		"discipline.update",
		"discipline.delete",
		"edition.create",
		"edition.update",
		"edition.delete",
		"course.create-outside-window",
	] as const) {
		expect(hasPerm(admin, perm), perm).toBe(true);
		expect(hasPerm(SYSTEM, perm), perm).toBe(true);
		expect(hasPerm(instructor, perm), perm).toBe(false);
		expect(hasPerm(student, perm), perm).toBe(false);
	}
});

test("api-key.manage and session.manage: owner, admin, or SYSTEM", () => {
	for (const perm of ["api-key.manage", "session.manage"] as const) {
		expect(hasPerm(instructor, perm, instructor.username as UserId), perm).toBe(
			true,
		);
		expect(hasPerm(instructor, perm, "other" as UserId), perm).toBe(false);
		expect(hasPerm(admin, perm, "other" as UserId), perm).toBe(true);
		expect(hasPerm(SYSTEM, perm, "other" as UserId), perm).toBe(true);
	}
});

test("course.create: SYSTEM and admins may name any instructor; anybody else only themselves", () => {
	const target = (username: string) => ({ instructor: { username } });
	expect(hasPerm(SYSTEM, "course.create", target("anyone"))).toBe(true);
	expect(hasPerm(admin, "course.create", target("anyone"))).toBe(true);
	expect(
		hasPerm(instructor, "course.create", target(instructor.username)),
	).toBe(true);
	expect(hasPerm(instructor, "course.create", target("other"))).toBe(false);
	// The actor's role is not otherwise consulted: a student naming themselves passes.
	expect(hasPerm(student, "course.create", target(student.username))).toBe(
		true,
	);
	expect(hasPerm(student, "course.create", target("other"))).toBe(false);
});

test("user.read and userWhere agree: self and admins see everyone, others see only themselves", () => {
	const fixtures = [admin, instructor, student];
	const actors: Actor[] = [admin, instructor, student, SYSTEM];

	for (const actor of actors) {
		const visible = fixtures.filter((u) => hasPerm(actor, "user.read", u));
		const expected =
			actor === SYSTEM || actor.role === "ADMIN"
				? fixtures
				: fixtures.filter((u) => u.username === actor.username);
		expect(visible).toEqual(expected);

		// The Prisma fragment must accept exactly the same rows the predicate does.
		const fragment = userWhere(actor);
		if (actor === SYSTEM || actor.role === "ADMIN") {
			expect(fragment).toEqual({});
		} else {
			expect(fragment).toEqual({ username: actor.username });
		}
	}
});

test("enrollment.create/update/manage are owner-only, unlike course.update", () => {
	const course = {
		instructor: { username: instructor.username },
		enrollments: [],
	};
	const own = { course, user: { username: student.username } };
	for (const perm of [
		"enrollment.create",
		"enrollment.update",
		"enrollment.manage",
	] as const) {
		expect(hasPerm(instructor, perm, course), perm).toBe(true);
		expect(hasPerm(SYSTEM, perm, course), perm).toBe(true);
		// An admin who does not teach the course gets no branch here, even
		// though course.update keeps granting it for the course record.
		expect(hasPerm(admin, perm, course), perm).toBe(false);
		// Naming themselves does not let a student manage their enrollment.
		expect(hasPerm(student, perm, own), perm).toBe(false);
	}
	expect(hasPerm(admin, "course.update", { ...course, id: 1 })).toBe(true);
});

test("enrollment.read/delete: the owning instructor on any enrollment, a student only on their own", () => {
	const course = { instructor: { username: instructor.username } };
	const own = { course, user: { username: student.username } };
	const other = { course, user: { username: "other" } };
	for (const perm of ["enrollment.read", "enrollment.delete"] as const) {
		expect(hasPerm(instructor, perm, course), perm).toBe(true);
		expect(hasPerm(instructor, perm, own), perm).toBe(true);
		expect(hasPerm(student, perm, own), perm).toBe(true);
		expect(hasPerm(student, perm, other), perm).toBe(false);
		// A bare course target means every enrollment: owner only.
		expect(hasPerm(student, perm, course), perm).toBe(false);
		expect(hasPerm(admin, perm, other), perm).toBe(false);
		expect(hasPerm(SYSTEM, perm, own), perm).toBe(true);
	}
});

test("course.read and course.read-contents agree, for every actor: SYSTEM, admin, the instructor, or an ACTIVE enrollment", () => {
	const course = courseFixture();
	const actors: { label: string; actor: Actor; expected: boolean }[] = [
		{ label: "SYSTEM", actor: SYSTEM, expected: true },
		{ label: "admin", actor: admin, expected: true },
		{ label: "instructor", actor: instructor, expected: true },
		{ label: "otherInstructor", actor: otherInstructor, expected: false },
		{ label: "enrolledStudent", actor: enrolledStudent, expected: true },
		{ label: "outsiderStudent", actor: outsiderStudent, expected: false },
	];
	for (const { label, actor, expected } of actors) {
		expect(hasPerm(actor, "course.read", course), label).toBe(expected);
		expect(hasPerm(actor, "course.read-contents", course), label).toBe(
			expected,
		);
	}

	const visibilityActors: Actor[] = [SYSTEM, admin, instructor, student];
	for (const actor of visibilityActors) {
		expect(courseContentsWhere(actor)).toEqual(courseWhere(actor));
	}
});

test("course.update-contents denies a non-owning admin; course.update and course.delete grant it", () => {
	const course = courseFixture();

	expect(hasPerm(SYSTEM, "course.update-contents", course)).toBe(true);
	expect(hasPerm(instructor, "course.update-contents", course)).toBe(true);
	// The row that separates it from course.update: an admin who does not
	// teach the course gets no branch here.
	expect(hasPerm(admin, "course.update-contents", course)).toBe(false);
	expect(hasPerm(otherInstructor, "course.update-contents", course)).toBe(
		false,
	);
	expect(hasPerm(student, "course.update-contents", course)).toBe(false);
	// The point of the rule: an admin who *is* the course's instructor
	// passes, because it reads ownership and never the role.
	const teachingAdminCourse = courseFixture();
	teachingAdminCourse.instructor = { username: admin.username };
	expect(hasPerm(admin, "course.update-contents", teachingAdminCourse)).toBe(
		true,
	);

	for (const perm of ["course.update", "course.delete"] as const) {
		expect(hasPerm(SYSTEM, perm, course), perm).toBe(true);
		expect(hasPerm(admin, perm, course), perm).toBe(true);
		expect(hasPerm(instructor, perm, course), perm).toBe(true);
		expect(hasPerm(otherInstructor, perm, course), perm).toBe(false);
		expect(hasPerm(student, perm, course), perm).toBe(false);
	}
});

test("question.read is exactly course.update-contents on question.course: no admin branch for a non-owning admin", () => {
	const course = courseFixture();
	const question = (status: "DRAFT" | "PUBLISHED" | "ARCHIVED") => ({
		status,
		course,
	});

	expect(hasPerm(SYSTEM, "question.read", question("DRAFT"))).toBe(true);
	expect(hasPerm(instructor, "question.read", question("DRAFT"))).toBe(true);
	expect(hasPerm(admin, "question.read", question("DRAFT"))).toBe(false);
	expect(hasPerm(otherInstructor, "question.read", question("PUBLISHED"))).toBe(
		false,
	);
	expect(hasPerm(student, "question.read", question("PUBLISHED"))).toBe(false);
});

test("question.read-public grants question.read, or a course-contents viewer only once PUBLISHED", () => {
	const course = courseFixture();
	const draft = { status: "DRAFT" as const, course };
	const published = { status: "PUBLISHED" as const, course };

	// The owning instructor sees both, regardless of status (question.read alone grants it).
	expect(hasPerm(instructor, "question.read-public", draft)).toBe(true);
	expect(hasPerm(instructor, "question.read-public", published)).toBe(true);

	// An enrolled student is denied a draft, even though enrolled.
	expect(hasPerm(enrolledStudent, "question.read-public", draft)).toBe(false);
	// The same student is granted once the question is published.
	expect(hasPerm(enrolledStudent, "question.read-public", published)).toBe(
		true,
	);

	// An outsider is denied either way: never enrolled, never course.read-contents.
	expect(hasPerm(outsiderStudent, "question.read-public", draft)).toBe(false);
	expect(hasPerm(outsiderStudent, "question.read-public", published)).toBe(
		false,
	);

	// A non-owning admin has course.read-contents (so PUBLISHED grants it) but
	// no question.read branch (so DRAFT still denies it).
	expect(hasPerm(admin, "question.read-public", draft)).toBe(false);
	expect(hasPerm(admin, "question.read-public", published)).toBe(true);
});

test("SYSTEM bypasses every rule", () => {
	expect(hasMinimumRole(SYSTEM, "ADMIN")).toBe(true);
	expect(hasPerm(SYSTEM, "invite.create", { invitedRole: "ADMIN" })).toBe(true);
	expect(hasPerm(SYSTEM, "api-key.manage", "other" as UserId)).toBe(true);
	expect(hasPerm(SYSTEM, "session.manage", "other" as UserId)).toBe(true);
	expect(hasPerm(SYSTEM, "system.manage")).toBe(true);
	expect(hasPerm(SYSTEM, "user.read", { username: "other" as UserId })).toBe(
		true,
	);
});

test("simplifyTarget keeps only the identifying fields of each target", () => {
	const course = { id: 7, instructor: { username: "ada" }, title: "Secret" };
	expect(simplifyTarget("enrollment.manage", course)).toEqual({
		id: 7,
		instructor: "ada",
	});
	expect(
		simplifyTarget("enrollment.delete", {
			course,
			user: { username: "bob" },
		}),
	).toEqual({ id: 7, instructor: "ada", user: "bob" });
	expect(
		simplifyTarget("invite.update", {
			id: 3,
			createdBy: { username: "ada", name: "Ada" },
			email: "invitee@codehood.test",
		} as { id: number; createdBy: { username: UserId } }),
	).toEqual({ id: 3, createdBy: "ada" });
	expect(simplifyTarget("invite.create", { invitedRole: "STUDENT" })).toEqual({
		invitedRole: "STUDENT",
	});
	expect(simplifyTarget("system.manage")).toBeUndefined();
	expect(simplifyTarget("api-key.manage", "ada" as UserId)).toEqual({
		owner: "ada",
	});
	expect(simplifyTarget("course.update-contents", course)).toEqual({
		id: 7,
		instructor: "ada",
	});
	const question = {
		id: 9,
		status: "DRAFT" as const,
		course,
		question: { type: "multiple-choice" },
	};
	expect(simplifyTarget("question.read", question)).toEqual({
		id: 9,
		status: "DRAFT",
		course: { id: 7, instructor: "ada" },
	});
});

test("a failed ensurePerm reports the simplified target, never the whole row", () => {
	const row = {
		username: "other" as UserId,
		email: "other@codehood.test",
		passwordHash: "$argon2id$secret",
	};
	let error: unknown;
	try {
		ensurePerm(student, "user.read", row);
	} catch (e) {
		error = e;
	}
	expect(error).toBeInstanceOf(NotAllowed);
	expect((error as NotAllowed).target).toEqual({ username: "other" });
});

test("a denied api-key.manage reports the simplified owner", () => {
	let error: unknown;
	try {
		ensurePerm(instructor, "api-key.manage", "other" as UserId);
	} catch (e) {
		error = e;
	}
	expect(error).toBeInstanceOf(NotAllowed);
	expect((error as NotAllowed).target).toEqual({ owner: "other" });
});

test("a denied question.read reports the simplified course target", () => {
	const course = { id: 5, instructor: { username: instructor.username } };
	const question = { id: 9, status: "DRAFT" as const, course };
	let error: unknown;
	try {
		ensurePerm(otherInstructor, "question.read", question);
	} catch (e) {
		error = e;
	}
	expect(error).toBeInstanceOf(NotAllowed);
	expect((error as NotAllowed).target).toEqual({
		id: 9,
		status: "DRAFT",
		course: { id: 5, instructor: instructor.username },
	});
});
