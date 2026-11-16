import { expect, test } from "@playwright/test";
import {
	examsNav,
	homeNav,
	resourcesNav,
	scheduleNav,
	scheduleWeekId,
	studentHomeNav,
	studentsNav,
} from "@/utils/course-tabs-nav";

const href = "/cs101/ada_2026-2";

test.describe("resourcesNav", () => {
	const groups = [
		{ type: "FILE", label: "Files", resources: [1, 2] },
		{ type: "MD", label: "Notes", resources: [1] },
	];

	test("folds the groups under the resources entry only when expanded", () => {
		const [entry] =
			resourcesNav(href, groups, 0, { expand: true }).sections[0]?.entries ??
			[];
		expect(entry?.href).toBe(`${href}/resources`);
		expect(entry?.children).toEqual([
			{ label: "Files", href: `${href}/resources#group-file`, meta: 2 },
			{ label: "Notes", href: `${href}/resources#group-md`, meta: 1 },
		]);
		const [plain] = resourcesNav(href, groups).sections[0]?.entries ?? [];
		expect(plain?.children).toEqual([]);
	});

	test("ends with the repositories page when the actor sees any", () => {
		const entries = resourcesNav(href, [], 2).sections[0]?.entries;
		expect(entries?.map((e) => e.href)).toEqual([
			`${href}/resources`,
			`${href}/repositories`,
		]);
		expect(entries?.[1]?.meta).toBe(2);
		expect(resourcesNav(href, []).sections[0]?.entries).toHaveLength(1);
	});

	test("carries the entity of the page as context", () => {
		expect(resourcesNav(href, [], 0, { context: "Notes" }).context).toBe(
			"Notes",
		);
	});
});

test.describe("scheduleNav", () => {
	const weeks = { past: [{ week: 1 }, { week: 2 }], ahead: [{ week: 3 }] };

	test("lists every week when none is folded", () => {
		const entries = scheduleNav(href, weeks, false).sections[0]?.entries;
		expect(entries?.map((e) => e.href)).toEqual(
			[1, 2, 3].map((w) => `${href}/schedule#${scheduleWeekId(w)}`),
		);
	});

	test("folds the past weeks under one entry", () => {
		const entries = scheduleNav(href, weeks, true).sections[0]?.entries;
		expect(entries).toHaveLength(2);
		expect(entries?.[0]?.children?.map((c) => c.href)).toEqual([
			`${href}/schedule#week-1`,
			`${href}/schedule#week-2`,
		]);
		expect(entries?.[1]?.href).toBe(`${href}/schedule#week-3`);
	});
});

test.describe("examsNav", () => {
	test("one section per type present, in a fixed order", () => {
		const nav = examsNav(href, [
			{ slug: "q1", title: "Quiz 1", type: "QUIZ" },
			{ slug: "mid", title: "Midterm", type: "EXAM" },
			{ slug: "q2", title: "Quiz 2", type: "QUIZ" },
		]);
		expect(nav.sections).toHaveLength(2);
		expect(nav.sections[0]?.entries.map((e) => e.href)).toEqual([
			`${href}/exams/mid`,
		]);
		expect(nav.sections[1]?.entries.map((e) => e.label)).toEqual([
			"Quiz 1",
			"Quiz 2",
		]);
	});

	test("no exams, no sections", () => {
		expect(examsNav(href, []).sections).toEqual([]);
	});
});

test.describe("studentsNav", () => {
	test("links the roster, the grades and the attendance, in that order", () => {
		const entries = studentsNav(href).sections[0]?.entries;
		expect(entries).toEqual([
			{ label: "Roster", href: `${href}/roster` },
			{ label: "Grades", href: `${href}/grades` },
			{ label: "Attendance", href: `${href}/attendance` },
		]);
	});
});

test.describe("homeNav", () => {
	test("lists home, reports and settings on every page", () => {
		expect(homeNav(href).sections[0]?.entries.map((e) => e.href)).toEqual([
			href,
			`${href}/reports`,
			`${href}/settings`,
		]);
	});

	test("folds the sections of the page the reader is on under its entry", () => {
		const entries = homeNav(href, {
			page: "home",
			sections: [
				{ id: "schedule", label: "Schedule" },
				{ id: "exams", label: "Exams" },
			],
		}).sections[0]?.entries;
		expect(entries?.[0]?.children).toEqual([
			{ label: "Schedule", href: `${href}#schedule` },
			{ label: "Exams", href: `${href}#exams` },
		]);
		expect(entries?.[2]?.children).toEqual([]);
	});

	test("settings sections hang from the settings entry", () => {
		const entries = homeNav(href, {
			page: "settings",
			sections: [{ id: "settings-cli", label: "CLI" }],
		}).sections[0]?.entries;
		expect(entries?.[0]?.children).toEqual([]);
		expect(entries?.[2]?.children).toEqual([
			{ label: "CLI", href: `${href}/settings#settings-cli` },
		]);
	});
});

test.describe("studentHomeNav", () => {
	test("puts the home sections at the first level, with the Home tab", () => {
		const nav = studentHomeNav([
			{ id: "schedule", label: "Schedule" },
			{ id: "attendance", label: "Attendance" },
		]);
		expect(nav.tab).toBe("Home");
		expect(nav.sections).toEqual([
			{
				entries: [
					{ label: "Schedule", href: "#schedule" },
					{ label: "Attendance", href: "#attendance" },
				],
			},
		]);
	});
});
