import { expect, test } from "@playwright/test";
import { type CourseNav, markCourseNav } from "@/utils/course-nav";

const exam = "/cs201/turing_2026-1/exams/test-02";

/// The same nav every page of an exam hands to the layout.
const nav: CourseNav = {
	context: "Test 2",
	sections: [
		{
			entries: [
				{
					label: "Overview",
					href: exam,
					children: [
						{ label: "Instructions", href: `${exam}#instructions` },
						{ label: "Results", href: `${exam}#results` },
					],
				},
				{
					label: "Grading",
					href: `${exam}/grading`,
					children: [{ label: "Q1", href: `${exam}/grading/q1` }],
				},
				{ label: "Regrades", href: `${exam}/regrades` },
			],
		},
	],
};

function mark(path: string) {
	return markCourseNav(nav, new URL(path, "http://localhost"));
}

function entries(path: string) {
	return mark(path).sections[0]?.entries ?? [];
}

test.describe("markCourseNav", () => {
	test("the entry of the current page is current and open", () => {
		const [overview, grading] = entries(exam);
		expect(overview?.current).toBe(true);
		expect(overview?.open).toBe(true);
		expect(grading?.current).toBe(false);
		expect(grading?.open).toBe(false);
	});

	test("links into the current page become in-page anchors", () => {
		const [overview, grading] = entries(exam);
		expect(overview?.children.map((c) => [c.href, c.anchor])).toEqual([
			["#instructions", true],
			["#results", true],
		]);
		expect(grading?.children[0]?.anchor).toBe(false);
	});

	test("links into another page keep their full href", () => {
		const [overview] = entries(`${exam}/grading`);
		expect(overview?.children[0]?.href).toBe(`${exam}#instructions`);
		expect(overview?.children[0]?.anchor).toBe(false);
	});

	test("a current child makes its entry current and open", () => {
		const [, grading] = entries(`${exam}/grading/q1`);
		expect(grading?.current).toBe(true);
		expect(grading?.open).toBe(true);
		expect(grading?.children[0]?.current).toBe(true);
		expect(mark(`${exam}/grading/q1`).current?.label).toBe("Grading");
	});

	test("an entry without children never opens", () => {
		const regrades = entries(`${exam}/regrades`)[2];
		expect(regrades?.current).toBe(true);
		expect(regrades?.open).toBe(false);
	});

	test("query parameters the link does not carry are ignored", () => {
		const [, grading] = entries(`${exam}/grading?names=1`);
		expect(grading?.current).toBe(true);
	});

	test("a query parameter the link carries must match", () => {
		const withQuery: CourseNav = {
			sections: [{ entries: [{ label: "A", href: "/x?page=a" }] }],
		};
		const marked = (path: string) =>
			markCourseNav(withQuery, new URL(path, "http://localhost")).sections[0]
				?.entries[0]?.current;
		expect(marked("/x?page=a&frame")).toBe(true);
		expect(marked("/x?page=b")).toBe(false);
	});

	test("a trailing slash does not matter", () => {
		expect(entries(`${exam}/`)[0]?.current).toBe(true);
	});
});
