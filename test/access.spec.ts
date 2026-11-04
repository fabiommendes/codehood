import { expect, test } from "@playwright/test";
import {
	ACCESS_ORDER,
	type Access,
	accessError,
	examAccess,
	maxAccess,
	questionAccess,
	requireAccess,
	responseAccess,
} from "@/auth/access";
import { SYSTEM, type UserActor } from "@/auth/actor";
import { NotAllowed, NotFound } from "@/core/error";

const user = (username: string, role: UserActor["role"]): UserActor => ({
	username,
	role,
	name: username,
});

const owner = user("owner", "INSTRUCTOR");
const admin = user("admin", "ADMIN");
const student = user("student", "STUDENT");
const other = user("other", "STUDENT");
const outsider = user("outsider", "STUDENT");

const course = {
	id: 1,
	instructor: { username: "owner" },
	enrollments: [{ username: "student" }, { username: "other" }],
};

const STATUSES = ["DRAFT", "PUBLISHED", "HIDDEN", "ARCHIVED"] as const;

test("maxAccess picks the highest level, and none when given nothing", () => {
	expect(ACCESS_ORDER).toEqual(["none", "see", "read", "write"]);
	expect(maxAccess()).toBe("none");
	expect(maxAccess("see", "write", "read")).toBe("write");
	expect(maxAccess("none", "see")).toBe("see");
});

const LEVELS: Access[] = ["none", "see", "read", "write"];
const NEEDED = ["read", "write"] as const;

for (const access of LEVELS) {
	for (const needed of NEEDED) {
		const deficit = ACCESS_ORDER.indexOf(access) < ACCESS_ORDER.indexOf(needed);
		const expected =
			access === "none" ? NotFound : deficit ? NotAllowed : undefined;
		test(`accessError: ${access} for ${needed} is ${expected?.name ?? "fine"}`, () => {
			const error = accessError(access, needed, "exam.update");
			if (expected) expect(error).toBeInstanceOf(expected);
			else expect(error).toBeUndefined();
			if (expected === NotAllowed) {
				expect((error as NotAllowed).action).toBe("exam.update");
			}
			if (expected === NotFound) {
				expect((error as NotFound).resource).toBe("exam");
			}
		});
	}
}

test("requireAccess throws what accessError returns", () => {
	expect(() => requireAccess("write", "write", "exam.update")).not.toThrow();
	expect(() => requireAccess("read", "write", "exam.update")).toThrow(
		NotAllowed,
	);
	expect(() => requireAccess("none", "read", "exam.read")).toThrow(NotFound);
});

// Exam ----------------------------------------------------------------------

test("an exam outsider gets the same access to a draft as to a published exam", () => {
	const draft = examAccess(outsider, { status: "DRAFT", course });
	const published = examAccess(outsider, { status: "ONGOING", course });
	expect(draft).toBe(published);
	expect(draft).toBe("see");
});

test("examAccess: the owner writes, members read published exams, drafts vanish", () => {
	for (const status of ["DRAFT", "ARCHIVED", "SCHEDULED", "ONGOING"] as const) {
		const hidden = status === "DRAFT" || status === "ARCHIVED";
		expect(examAccess(owner, { status, course })).toBe("write");
		expect(examAccess(SYSTEM, { status, course })).toBe("write");
		expect(examAccess(student, { status, course })).toBe(
			hidden ? "none" : "read",
		);
		expect(examAccess(admin, { status, course })).toBe(
			hidden ? "none" : "read",
		);
		expect(examAccess(outsider, { status, course })).toBe("see");
	}
});

// Question ------------------------------------------------------------------

test("questionAccess: the owner writes, a member reads what is published or pinned", () => {
	for (const status of STATUSES) {
		for (const pinned of [false, true]) {
			expect(questionAccess(owner, { status, course }, pinned)).toBe("write");
			expect(questionAccess(outsider, { status, course }, pinned)).toBe("see");
		}
	}
	expect(questionAccess(student, { status: "PUBLISHED", course }, false)).toBe(
		"read",
	);
	expect(questionAccess(student, { status: "DRAFT", course }, true)).toBe(
		"none",
	);
	expect(questionAccess(student, { status: "HIDDEN", course }, false)).toBe(
		"none",
	);
	expect(questionAccess(student, { status: "HIDDEN", course }, true)).toBe(
		"read",
	);
	expect(questionAccess(admin, { status: "PUBLISHED", course }, false)).toBe(
		"read",
	);
});

// Response ------------------------------------------------------------------

test("responseAccess: the owner writes, the author reads, others see nothing", () => {
	const row = { author: { username: "student" }, course };
	expect(responseAccess(owner, row)).toBe("write");
	expect(responseAccess(SYSTEM, row)).toBe("write");
	expect(responseAccess(student, row)).toBe("read");
	expect(responseAccess(other, row)).toBe("none");
	expect(responseAccess(outsider, row)).toBe("none");
});
