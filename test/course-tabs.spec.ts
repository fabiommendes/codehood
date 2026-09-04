import { expect, test } from "@playwright/test";
import { canManageEnrollment } from "@/auth/permissions";
import { SYSTEM } from "@/core/actor";
import { type CourseTab, courseTabs } from "@/utils/course-tabs";

const admin = { id: 1, role: "ADMIN" as const };
const owner = { id: 2, role: "INSTRUCTOR" as const };
const otherInstructor = { id: 3, role: "INSTRUCTOR" as const };
const student = { id: 4, role: "STUDENT" as const };

const course = {
	instructor: { id: owner.id },
	enrollments: [{ userId: student.id }],
	disciplineSlug: "cs101",
	username: "ada",
	edition: "2026-1",
};

const HOME_FOUR = ["home", "exams", "resources", "schedule"];

function keys(tabs: readonly CourseTab[]): string[] {
	return tabs.map((t) => t.key);
}

test("a student enrolled in the course gets exactly home, exams, resources, schedule, in order", () => {
	expect(keys(courseTabs(course, student))).toEqual(HOME_FOUR);
});

test("the course's instructor gets those four followed by students, manage", () => {
	expect(keys(courseTabs(course, owner))).toEqual([
		...HOME_FOUR,
		"students",
		"manage",
	]);
});

test("an instructor who does not teach the course gets four; a non-owning admin gets four; an owning admin and SYSTEM get six", () => {
	expect(keys(courseTabs(course, otherInstructor))).toEqual(HOME_FOUR);
	expect(keys(courseTabs(course, admin))).toEqual(HOME_FOUR);

	const adminOwnedCourse = { ...course, instructor: { id: admin.id } };
	expect(keys(courseTabs(adminOwnedCourse, admin))).toEqual([
		...HOME_FOUR,
		"students",
		"manage",
	]);
	expect(keys(courseTabs(course, SYSTEM))).toEqual([
		...HOME_FOUR,
		"students",
		"manage",
	]);
});

test("the pinning test: manage appears iff canManageEnrollment agrees, for every actor", () => {
	for (const actor of [admin, owner, otherInstructor, student, SYSTEM]) {
		const hasManageTab = keys(courseTabs(course, actor)).includes("manage");
		expect(hasManageTab, String(actor === SYSTEM ? "SYSTEM" : actor.id)).toBe(
			canManageEnrollment(actor, course),
		);
	}
});

test("every href is the one courseHref builds", () => {
	const base = "/cs101/ada_2026-1";
	const tabs = courseTabs(course, owner);
	expect(tabs.find((t) => t.key === "home")?.href).toBe(base);
	expect(tabs.find((t) => t.key === "exams")?.href).toBe(`${base}/exams`);
	expect(tabs.find((t) => t.key === "resources")?.href).toBe(
		`${base}/resources`,
	);
	expect(tabs.find((t) => t.key === "schedule")?.href).toBe(`${base}/schedule`);
	expect(tabs.find((t) => t.key === "students")?.href).toBe(`${base}/roster`);
	expect(tabs.find((t) => t.key === "manage")?.href).toBe(`${base}/manage`);
});
