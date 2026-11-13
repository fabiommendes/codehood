import { expect, test } from "@playwright/test";
import {
	examsNav,
	resourcesNav,
	scheduleNav,
	scheduleWeekId,
} from "@/utils/course-tabs-nav";

const href = "/cs101/ada_2026-2";

test.describe("resourcesNav", () => {
	test("links to each group with its count", () => {
		const nav = resourcesNav(href, [
			{ type: "FILE", label: "Files", resources: [1, 2] },
			{ type: "MD", label: "Notes", resources: [1] },
		]);
		expect(nav.sections[0]?.entries).toEqual([
			{ label: "Files", href: `${href}/resources#group-file`, meta: 2 },
			{ label: "Notes", href: `${href}/resources#group-md`, meta: 1 },
		]);
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
