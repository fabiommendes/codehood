import { expect, test } from "@playwright/test";
import { examNav } from "@/utils/exam-nav";

const href = "/cs101/ada_2026-2/exams/test-02";
const sections = [{ id: "questions", label: "Questions" }];

function manager(practice: boolean) {
	return examNav({
		href,
		title: "Test 2",
		sections,
		manage: true,
		practice,
		pending: 3,
		regrades: 0,
	});
}

test.describe("examNav", () => {
	test("the manager's card carries the exam title as context", () => {
		expect(manager(false).context).toBe("Test 2");
	});

	test("the manager's first section is the exam, the second what follows it", () => {
		const [exam, after] = manager(false).sections;
		expect(exam?.entries.map((e) => e.label)).toEqual([
			"Overview",
			"Questions",
		]);
		expect(after?.entries.map((e) => e.label)).toEqual([
			"Exceptions",
			"Grading",
			"Regrade requests",
			"Results",
		]);
	});

	test("meta counts pending answers and open regrades, and hides zero", () => {
		const after = manager(false).sections[1]?.entries;
		expect(after?.find((e) => e.label === "Grading")?.meta).toBe(3);
		expect(
			after?.find((e) => e.label === "Regrade requests")?.meta,
		).toBeUndefined();
	});

	test("the manager's entries are pages of their own", () => {
		const [exam, after] = manager(false).sections;
		expect(exam?.entries.map((e) => e.href)).toEqual([
			href,
			`${href}/questions`,
		]);
		expect(after?.entries.map((e) => e.href)).toEqual([
			`${href}/exceptions`,
			`${href}/grading`,
			`${href}/regrades`,
			`${href}/results`,
		]);
	});

	test("results fold into the by-student and by-question blocks", () => {
		const results = manager(false).sections[1]?.entries.at(-1);
		expect(results?.children?.map((c) => c.href)).toEqual([
			`${href}/results#by-student`,
			`${href}/results#by-question`,
		]);
	});

	test("practice exams have only the first section", () => {
		expect(manager(true).sections).toHaveLength(1);
		expect(manager(false).sections).toHaveLength(2);
	});

	test("students see the sections under the exam title", () => {
		const nav = examNav({ href, title: "Test 2", sections, manage: false });
		expect(nav.context).toBe("Test 2");
		expect(nav.sections[0]?.entries.map((e) => e.href)).toEqual([
			`${href}#questions`,
		]);
	});
});
