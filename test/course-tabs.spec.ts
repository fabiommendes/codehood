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

const HOME_FOUR = ["home", "exams", "resources", "schedule"];

function keys(tabs: readonly CourseTab[]): string[] {
	return tabs.map((t) => t.key);
}

test("a student enrolled in the course gets exactly home, exams, resources, schedule, in order", () => {
	expect(keys(courseTabs(course, ref, student as Actor))).toEqual(HOME_FOUR);
});

test("the course's instructor gets those four followed by students, manage", () => {
	expect(keys(courseTabs(course, ref, owner as Actor))).toEqual([
		...HOME_FOUR,
		"students",
		"manage",
	]);
});

test("an instructor who does not teach the course gets four; a non-owning admin gets four; an owning admin and SYSTEM get six", () => {
	expect(keys(courseTabs(course, ref, otherInstructor as Actor))).toEqual(
		HOME_FOUR,
	);
	expect(keys(courseTabs(course, ref, admin as Actor))).toEqual(HOME_FOUR);

	const adminOwnedCourse = {
		...course,
		instructor: { username: "admin" },
	};
	expect(keys(courseTabs(adminOwnedCourse, ref, admin as Actor))).toEqual([
		...HOME_FOUR,
		"students",
		"manage",
	]);
	expect(keys(courseTabs(course, ref, SYSTEM))).toEqual([
		...HOME_FOUR,
		"students",
		"manage",
	]);
});

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

test("every href is the one courseHref builds", () => {
	const base = "/cs101/ada_2026-1";
	const tabs = courseTabs(course, ref, owner as Actor);
	expect(tabs.find((t) => t.key === "home")?.href).toBe(base);
	expect(tabs.find((t) => t.key === "exams")?.href).toBe(`${base}/exams`);
	expect(tabs.find((t) => t.key === "resources")?.href).toBe(
		`${base}/resources`,
	);
	expect(tabs.find((t) => t.key === "schedule")?.href).toBe(`${base}/schedule`);
	expect(tabs.find((t) => t.key === "students")?.href).toBe(`${base}/roster`);
	expect(tabs.find((t) => t.key === "manage")?.href).toBe(`${base}/manage`);
});
