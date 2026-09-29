import { expect, test } from "@playwright/test";
import { breadcrumbs, type CrumbLabels } from "@/utils/breadcrumbs";

/// Labels every course page carries.
const course: CrumbLabels["course"] = {
	discipline: { slug: "cs201" },
	edition: { slug: "2026-1" },
};
const courseLabel = "cs201 · 2026-1";
const home = "/cs201/turing_2026-1";

function trail(path: string, labels: CrumbLabels = { course }) {
	return breadcrumbs(new URL(path, "http://localhost"), labels);
}

test.describe("course tabs and items", () => {
	test("course home is a single unlinked crumb", () => {
		const crumbs = trail(home);
		expect(crumbs).toEqual([{ label: courseLabel }]);
		expect(crumbs.at(0)).not.toHaveProperty("href");
	});

	const tabs = [
		["exams", "Exams"],
		["resources", "Resources"],
		["schedule", "Schedule"],
		["questions", "Questions"],
		["roster", "Students"],
		["grades", "Grades"],
	] as const;

	for (const [segment, label] of tabs) {
		test(`tab page /${segment} is course then ${label}`, () => {
			const crumbs = trail(`${home}/${segment}`);
			expect(crumbs).toEqual([{ label: courseLabel, href: home }, { label }]);
			expect(crumbs.at(1)).not.toHaveProperty("href");
		});
	}

	const items = [
		["exams", "Exams", "Midterm"],
		["questions", "Questions", "Recursion basics"],
		["resources", "Resources", "Lecture notes"],
	] as const;

	for (const [segment, tabLabel, title] of items) {
		test(`item page under ${segment} is course, ${tabLabel}, item title`, () => {
			const crumbs = trail(`${home}/${segment}/some-slug`, {
				course,
				item: title,
			});
			expect(crumbs).toEqual([
				{ label: courseLabel, href: home },
				{ label: tabLabel, href: `${home}/${segment}` },
				{ label: title },
			]);
		});
	}

	test("item crumb uses labels.item and never the slug", () => {
		const crumbs = trail(`${home}/exams/midterm`, { course, item: "Midterm" });
		expect(crumbs.map((c) => c.label)).not.toContain("midterm");
	});

	test("last crumb of an item page has no href property", () => {
		const crumbs = trail(`${home}/exams/midterm`, { course, item: "Midterm" });
		expect(crumbs.at(-1)).not.toHaveProperty("href");
	});

	test("trailing slash does not change a tab trail", () => {
		expect(trail(`${home}/exams/`)).toEqual(trail(`${home}/exams`));
	});

	test("trailing slash does not change an item trail", () => {
		const labels = { course, item: "Midterm" };
		expect(trail(`${home}/exams/midterm/`, labels)).toEqual(
			trail(`${home}/exams/midterm`, labels),
		);
	});

	test("trailing slash does not change the course home trail", () => {
		expect(trail(`${home}/`)).toEqual(trail(home));
	});

	test("query string and hash are not copied into hrefs", () => {
		const crumbs = trail(`${home}/exams/midterm?tab=2&x=y#top`, {
			course,
			item: "Midterm",
		});
		expect(crumbs.map((c) => c.href)).toEqual([
			home,
			`${home}/exams`,
			undefined,
		]);
	});

	test("query string does not alter the labels of a tab page", () => {
		expect(trail(`${home}/exams?page=2#x`)).toEqual([
			{ label: courseLabel, href: home },
			{ label: "Exams" },
		]);
	});
});

test.describe("grading, attempts, admin and other pages", () => {
	const exam = `${home}/exams/midterm`;
	const examCrumbs = [
		{ label: courseLabel, href: home },
		{ label: "Exams", href: `${home}/exams` },
		{ label: "Midterm", href: exam },
	];

	test("grading page is course, Exams, exam, Grading", () => {
		expect(trail(`${exam}/grading`, { course, item: "Midterm" })).toEqual([
			...examCrumbs,
			{ label: "Grading" },
		]);
	});

	test("grading question page ends with the question title", () => {
		const labels = { course, item: "Midterm", question: "Two sums" };
		expect(trail(`${exam}/grading/q1`, labels)).toEqual([
			...examCrumbs,
			{ label: "Grading", href: `${exam}/grading` },
			{ label: "Two sums" },
		]);
	});

	test("names=1 is carried on the Grading crumb only", () => {
		const labels = { course, item: "Midterm", question: "Two sums" };
		const crumbs = trail(`${exam}/grading/q1?names=1&other=2#x`, labels);
		expect(crumbs.map((c) => c.href)).toEqual([
			home,
			`${home}/exams`,
			exam,
			`${exam}/grading?names=1`,
			undefined,
		]);
	});

	test("Grading is unlinked on the grading page even with names=1", () => {
		const crumbs = trail(`${exam}/grading?names=1`, {
			course,
			item: "Midterm",
		});
		expect(crumbs[crumbs.length - 1]).toEqual({ label: "Grading" });
	});

	test("student label never appears on the grading page", () => {
		const crumbs = trail(`${exam}/grading`, {
			course,
			item: "Midterm",
			student: "Alice Liddell",
		});
		expect(crumbs.map((c) => c.label)).not.toContain("Alice Liddell");
	});

	test("student label never appears on the grading question page", () => {
		const crumbs = trail(`${exam}/grading/q1`, {
			course,
			item: "Midterm",
			question: "Two sums",
			student: "Alice Liddell",
		});
		expect(crumbs.map((c) => c.label)).not.toContain("Alice Liddell");
	});

	test("attempt page is course, Exams, exam, student name", () => {
		const crumbs = trail(`${exam}/attempts/alice`, {
			course,
			item: "Midterm",
			student: "Alice Liddell",
		});
		expect(crumbs).toEqual([...examCrumbs, { label: "Alice Liddell" }]);
	});

	test("attempt page never uses the username as a label", () => {
		const crumbs = trail(`${exam}/attempts/alice`, {
			course,
			item: "Midterm",
		});
		expect(crumbs.map((c) => c.label)).not.toContain("alice");
	});

	test("admin home is a single unlinked crumb", () => {
		expect(trail("/admin", {})).toEqual([{ label: "Admin" }]);
	});

	const adminPages = [
		["users", "Users"],
		["courses", "Courses"],
		["disciplines", "Disciplines"],
		["editions", "Editions"],
	] as const;

	for (const [segment, label] of adminPages) {
		test(`admin page /admin/${segment} is Admin then ${label}`, () => {
			expect(trail(`/admin/${segment}`, {})).toEqual([
				{ label: "Admin", href: "/admin" },
				{ label },
			]);
		});
	}

	test("other page is a single unlinked crumb with labels.page", () => {
		expect(trail("/calendar", { page: "Calendar" })).toEqual([
			{ label: "Calendar" },
		]);
	});

	test("other page without labels.page has an empty trail", () => {
		expect(trail("/calendar", {})).toEqual([]);
	});

	test("two-segment URL outside courses is not a course", () => {
		expect(trail("/courses/join", { page: "Join a course" })).toEqual([
			{ label: "Join a course" },
		]);
	});

	test("item page without labels.item drops the item crumb", () => {
		expect(trail(`${home}/exams/midterm`)).toEqual([
			{ label: courseLabel, href: home },
			{ label: "Exams" },
		]);
	});

	test("unknown tab segment drops its crumb and unlinks the course", () => {
		expect(trail(`${home}/foo`)).toEqual([{ label: courseLabel }]);
	});
});
