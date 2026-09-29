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

test("instructor: the tabs are Home, Exams, Resources, Schedule, Questions, Students, Grades, in that order", () => {
	const tabs = courseTabs(course, ref, owner as Actor);

	expect(tabs.map((t) => t.label)).toEqual([
		"Home",
		"Exams",
		"Resources",
		"Schedule",
		"Questions",
		"Students",
		"Grades",
	]);
	expect(keys(tabs)).toEqual([
		"home",
		"exams",
		"resources",
		"schedule",
		"questions",
		"students",
		"grades",
	]);
});

test("instructor: the questions and students tabs carry the right hrefs", () => {
	const tabs = courseTabs(course, ref, owner as Actor);

	expect(tabs.find((t) => t.key === "questions")).toEqual({
		key: "questions",
		label: "Questions",
		href: `${courseHref(ref)}/questions`,
	});
	expect(tabs.find((t) => t.key === "students")).toEqual({
		key: "students",
		label: "Students",
		href: `${courseHref(ref)}/roster`,
	});
});

test("instructor: the grades tab leads to the course's grades page", () => {
	const tabs = courseTabs(course, ref, owner as Actor);

	expect(tabs.find((t) => (t.key as string) === "grades")).toEqual({
		key: "grades",
		label: "Grades",
		href: `${courseHref(ref)}/grades`,
	});
});

test("no actor gets a manage tab", () => {
	const actors: Actor[] = [
		admin as Actor,
		owner as Actor,
		otherInstructor as Actor,
		student as Actor,
		SYSTEM,
	];
	for (const actor of actors) {
		expect(
			keys(courseTabs(course, ref, actor)),
			String(actor === SYSTEM ? "SYSTEM" : actor.username),
		).not.toContain("manage");
	}
});

test("student: the questions, students and grades tabs are absent", () => {
	const tabs = keys(courseTabs(course, ref, student as Actor));

	expect(tabs).toEqual(["home", "exams", "resources", "schedule"]);
});

test("a non-owning admin gets no instructor tabs: enrollment.manage is the course's own instructor", () => {
	expect(keys(courseTabs(course, ref, admin as Actor))).toEqual([
		"home",
		"exams",
		"resources",
		"schedule",
	]);
});

test("the pinning test: the instructor tabs appear iff enrollment.manage agrees, for every actor", () => {
	const actors: Actor[] = [
		admin as Actor,
		owner as Actor,
		otherInstructor as Actor,
		student as Actor,
		SYSTEM,
	];
	for (const actor of actors) {
		const tabs = keys(courseTabs(course, ref, actor));
		const allowed = hasPerm(actor, "enrollment.manage", course);
		const name = String(actor === SYSTEM ? "SYSTEM" : actor.username);

		expect(tabs.includes("questions"), name).toBe(allowed);
		expect(tabs.includes("students"), name).toBe(allowed);
		expect(tabs.includes("grades"), name).toBe(allowed);
	}
});
