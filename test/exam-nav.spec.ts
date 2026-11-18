import { expect, test } from "@playwright/test";
import { markCourseNav } from "@/utils/course-nav";
import { examNav } from "@/utils/exam-nav";

const href = "/cs101/ada_2026-2/exams/test-02";
const sections = [{ id: "questions", label: "Questions" }];

function manager(practice: boolean, adjustments = 0) {
	return examNav({
		href,
		title: "Test 2",
		sections,
		manage: true,
		practice,
		pending: 3,
		regrades: 0,
		adjustments,
	});
}

test.describe("examNav", () => {
	test("the manager's card carries the exam title as context", () => {
		expect(manager(false).context).toBe("Test 2");
	});

	test("the manager gets one list of the exam's pages", () => {
		const nav = manager(false);
		expect(nav.sections).toHaveLength(1);
		expect(nav.sections[0]?.entries.map((e) => e.label)).toEqual([
			"Overview",
			"Preview",
			"Exceptions",
			"Grading",
			"Regrade requests",
			"Adjustments",
			"Results",
		]);
	});

	test("meta counts pending answers and open regrades, and hides zero", () => {
		const entries = manager(false).sections[0]?.entries;
		expect(entries?.find((e) => e.label === "Grading")?.meta).toBe(3);
		expect(
			entries?.find((e) => e.label === "Regrade requests")?.meta,
		).toBeUndefined();
	});

	test("the Adjustments entry counts the active adjustments", () => {
		const entries = manager(false, 2).sections[0]?.entries;
		expect(entries?.find((e) => e.label === "Adjustments")?.meta).toBe(2);
	});

	test("the Adjustments entry hides a count of zero", () => {
		const entries = manager(false, 0).sections[0]?.entries;
		expect(
			entries?.find((e) => e.label === "Adjustments")?.meta,
		).toBeUndefined();
	});

	test("there is no Sanctions entry left", () => {
		const labels = manager(false, 2).sections[0]?.entries.map((e) => e.label);
		expect(labels).not.toContain("Sanctions");
	});

	test("the manager's entries are pages of their own", () => {
		expect(manager(false).sections[0]?.entries.map((e) => e.href)).toEqual([
			href,
			`${href}/preview`,
			`${href}/exceptions`,
			`${href}/grading`,
			`${href}/regrades`,
			`${href}/adjustments`,
			`${href}/results`,
		]);
	});

	test("results fold into the by-question and by-student blocks, in page order", () => {
		const results = manager(false).sections[0]?.entries.at(-1);
		expect(results?.children?.map((c) => c.href)).toEqual([
			`${href}/results#by-question`,
			`${href}/results#by-student`,
		]);
	});

	test("practice exams have only the overview and the preview", () => {
		expect(manager(true).sections[0]?.entries.map((e) => e.href)).toEqual([
			href,
			`${href}/preview`,
		]);
	});

	test("pages under grading and attempts mark their own entry", () => {
		const current = (path: string) =>
			markCourseNav(manager(false), new URL(path, "http://x")).current?.label;
		expect(current(`${href}/grading/q1`)).toBe("Grading");
		expect(current(`${href}/attempts/ada`)).toBe("Results");
		expect(current(`${href}/regrades`)).toBe("Regrade requests");
		expect(current(`${href}/adjustments`)).toBe("Adjustments");
	});

	test("students see the sections under the exam title", () => {
		const nav = examNav({ href, title: "Test 2", sections, manage: false });
		expect(nav.context).toBe("Test 2");
		expect(nav.sections[0]?.entries.map((e) => e.href)).toEqual([
			`${href}#questions`,
		]);
	});
});
