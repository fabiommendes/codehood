import { expect, test } from "@playwright/test";
import type { Actor } from "@/auth/actor";
import { SYSTEM } from "@/auth/actor";
import { hasPerm } from "@/auth/permissions";
import { type CourseNaturalKey, courseHref } from "@/urls";
import { type CourseTab, courseTabs } from "@/utils/course-tabs";

const admin = { username: "admin", role: "ADMIN" as const };
const owner = { username: "owner", role: "INSTRUCTOR" as const };
const otherInstructor = {
	username: "otherInstructor",
	role: "INSTRUCTOR" as const,
};
const student = { username: "student", role: "STUDENT" as const };

/// A course `owner` teaches, with `student` as its only enrollment.
const course = {
	instructor: { username: owner.username },
	enrollments: [{ username: student.username }],
};
const ref: CourseNaturalKey = {
	discipline: "cs101",
	instructor: owner.username,
	edition: "2026-1",
};

function keys(tabs: readonly CourseTab[]): string[] {
	return tabs.map((t) => t.key);
}

test("instructor: the questions tab sits before students and manage, with the right href", () => {
	const tabs = courseTabs(course, ref, owner as Actor);
	const questionsTab = tabs.find((t) => t.key === "questions");

	expect(questionsTab).toEqual({
		key: "questions",
		label: "Questions",
		href: `${courseHref(ref)}/questions`,
	});
	const questionsIndex = keys(tabs).indexOf("questions");
	expect(questionsIndex).toBeLessThan(keys(tabs).indexOf("students"));
	expect(questionsIndex).toBeLessThan(keys(tabs).indexOf("manage"));
});

test("student: the questions tab is absent", () => {
	expect(keys(courseTabs(course, ref, student as Actor))).not.toContain(
		"questions",
	);
});

test("a non-owning admin gets no manage tabs: enrollment.manage is the course's own instructor", () => {
	expect(keys(courseTabs(course, ref, admin as Actor))).not.toContain("manage");
});

test("the pinning test: manage appears iff enrollment.manage agrees, for every actor", () => {
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
		).toBe(hasPerm(actor, "enrollment.manage", course));
	}
});
