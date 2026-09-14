import { expect, test } from "@playwright/test";
import { canManageEnrollment } from "@/auth/permissions";
import type { Actor } from "@/core/actor";
import { SYSTEM } from "@/core/actor";
import { type CourseTab, courseTabs } from "@/utils/course-tabs";
import type { CourseRef } from "@/utils/course-url";

const admin = { username: "admin", role: "ADMIN" as const };
const owner = { username: "owner", role: "INSTRUCTOR" as const };
const otherInstructor = {
	username: "otherInstructor",
	role: "INSTRUCTOR" as const,
};
const student = { username: "student", role: "STUDENT" as const };

const course = {
	instructor: { username: "ada" },
	enrollments: [{ userId: student.username }],
};
const ref: CourseRef = {
	discipline: "cs101",
	instructor: "ada",
	edition: "2026-1",
};

function keys(tabs: readonly CourseTab[]): string[] {
	return tabs.map((t) => t.key);
}

test("the pinning test: manage appears iff canManageEnrollment agrees, for every actor", () => {
	const actors: Actor[] = [
		admin as Actor,
		owner as Actor,
		otherInstructor as Actor,
		student as Actor,
		SYSTEM,
	];
	for (const actor of actors) {
		const hasManageTab = keys(courseTabs(course, ref, actor)).includes(
			"manage",
		);
		expect(
			hasManageTab,
			String(actor === SYSTEM ? "SYSTEM" : actor.username),
		).toBe(canManageEnrollment(actor, course));
	}
});
