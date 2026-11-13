import { expect, test } from "@playwright/test";
import { examNav } from "@/utils/exam-nav";

const href = "/cs101/ada_2026-2/exams/test-02";
const sections = [{ id: "questions", label: "Questions" }];

function hrefs(practice: boolean) {
	const nav = examNav({
		href,
		title: "Test 2",
		sections,
		manage: true,
		practice,
	});
	return nav.sections[0]?.entries.map((e) => e.href);
}

test.describe("examNav", () => {
	test("the manager's first entry carries the exam title", () => {
		const nav = examNav({ href, title: "Test 2", sections, manage: true });
		expect(nav.context).toBeUndefined();
		expect(nav.sections[0]?.entries[0]?.label).toBe("Test 2");
	});

	test("practice exams link to no grading nor regrades page", () => {
		expect(hrefs(true)).toEqual([href]);
		expect(hrefs(false)).toEqual([href, `${href}/grading`, `${href}/regrades`]);
	});

	test("students see the sections under the exam title", () => {
		const nav = examNav({ href, title: "Test 2", sections, manage: false });
		expect(nav.context).toBe("Test 2");
		expect(nav.sections[0]?.entries.map((e) => e.href)).toEqual([
			`${href}#questions`,
		]);
	});
});
