import { FULL_ACCESS } from "@/auth/actor";
import type { CourseId, QuestionSort } from "@/core/schemas";
import { db } from "@/db";
import type { QuestionPageFilter } from "@/db/services/question.service";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { courseHref } from "@/urls";
import { expect, type Page, test } from "./fixtures";
import { logInAs } from "./stories/helpers";

/**
 * The question bank of a course, read one page at a time with its filters
 * and its order in the URL. `?limit=2` makes several pages out of a handful
 * of questions. Each test makes its own course, since a sibling spec may
 * reset the seeded ones, and reads every expectation from the service.
 */

/// Slug, status, type, title and tags of the questions of the bank.
const QUESTIONS = [
	[
		"recursion-basics",
		"PUBLISHED",
		"multiple-choice",
		"Recursion basics",
		["recursion", "functions"],
	],
	["loop-invariants", "PUBLISHED", "essay", "Loop invariants", ["loops"]],
	["list-invariants", "DRAFT", "essay", "Linked list invariants", ["lists"]],
	[
		"factorial",
		"PUBLISHED",
		"multiple-choice",
		"Factorial of five",
		["recursion"],
	],
	["big-o", "DRAFT", "multiple-choice", "Big-O warm-up", ["complexity"]],
	["base-case", "HIDDEN", "essay", "Base case, in words", ["recursion"]],
	["tail-calls", "DRAFT", "multiple-choice", "Tail calls", ["recursion"]],
] as const;

/// The course of the running test and the address of its bank.
let course: CourseId;
let BANK: string;
let instructor: string;

/// The order of the page when its URL names none.
const NEWEST: QuestionSort = { field: "updated", direction: "desc" };

const pager = (page: Page) => page.getByRole("navigation", { name: "Pages" });

/// The titles of the rows on screen, in order.
const titles = (page: Page) => () =>
	page.locator("tbody tr td:first-child a").allInnerTexts();

/// The titles of each page of two questions the service lists for `filter`, and how many match it.
async function pagesOf(
	filter: Omit<QuestionPageFilter, "course" | "limit" | "after" | "before">,
): Promise<{ pages: string[][]; total: number }> {
	const bank = { ...filter, course, public: false as const };
	const pages: string[][] = [];
	let after: string | undefined;
	do {
		const { items, next } = await db.question.findPage(
			{ ...bank, limit: 2, after },
			FULL_ACCESS,
		);
		pages.push(items.map((item) => item.question.title ?? item.slug));
		after = next ?? undefined;
	} while (after !== undefined);
	const { sort: _sort, ...counted } = bank;
	return { pages, total: await db.question.count(counted, FULL_ACCESS) };
}

test.beforeEach(async ({ page }) => {
	const made = await persistedCourseFactory.create();
	course = made.id;
	instructor = made.instructor.username;
	BANK = `${courseHref({
		discipline: made.discipline.slug,
		instructor,
		edition: made.edition.slug,
	})}/questions`;
	for (const [slug, status, type, title, tags] of QUESTIONS)
		await db.question.create(
			{
				course,
				slug,
				status,
				version: "v1",
				question:
					type === "essay"
						? {
								type,
								title,
								stem: "Explain.",
								tags: [...tags],
								content: "text",
							}
						: {
								type,
								title,
								stem: "Which one?",
								tags: [...tags],
								choices: [
									{ id: "right", text: "This one", score: 1 },
									{ id: "wrong", text: "That one" },
								],
							},
			},
			FULL_ACCESS,
		);
	await logInAs(page, { username: instructor });
});

test("the question bank pages forward and back, two questions at a time", async ({
	page,
}) => {
	const { pages, total } = await pagesOf({ sort: NEWEST });
	expect(pages.length, "the bank needs three pages").toBeGreaterThan(2);
	const [first, second, third] = pages;
	const previous = pager(page).getByRole("link", { name: "Previous" });
	const next = pager(page).getByRole("link", { name: "Next" });

	await page.goto(`${BANK}?limit=2`);
	expect(await titles(page)()).toEqual(first);
	await expect(pager(page)).toContainText(`${total} in all`);
	await expect(page.getByText(`${total} of ${total} questions`)).toBeVisible();
	await expect(previous).toHaveCount(0);

	await next.click();
	await expect(page).toHaveURL(/[?&]after=/);
	await expect(page).toHaveURL(/[?&]limit=2/);
	await expect.poll(titles(page)).toEqual(second);
	await next.click();
	await expect.poll(titles(page)).toEqual(third);

	await previous.click();
	await expect(page).toHaveURL(/[?&]before=/);
	await expect.poll(titles(page)).toEqual(second);
	await previous.click();
	await expect.poll(titles(page)).toEqual(first);
	await expect(previous).toHaveCount(0);
});

test("a column header sorts the bank on the server, from its first page", async ({
	page,
}) => {
	const ascending = await pagesOf({
		sort: { field: "title", direction: "asc" },
	});
	const descending = await pagesOf({
		sort: { field: "title", direction: "desc" },
	});
	const header = page.getByRole("columnheader", { name: /^Title/ });

	await page.goto(`${BANK}?limit=2`);
	await pager(page).getByRole("link", { name: "Next" }).click();
	await expect(page).toHaveURL(/[?&]after=/);

	await header.getByRole("link").click();
	await expect(page).toHaveURL(/[?&]sort=title&dir=asc/);
	await expect(page).not.toHaveURL(/after=|before=/);
	await expect(page).toHaveURL(/[?&]limit=2/);
	await expect.poll(titles(page)).toEqual(ascending.pages[0]);
	await expect(header).toHaveAttribute("aria-sort", "ascending");

	await pager(page).getByRole("link", { name: "Next" }).click();
	await expect.poll(titles(page)).toEqual(ascending.pages[1]);
	await expect(page).toHaveURL(/[?&]sort=title/);

	await header.getByRole("link").click();
	await expect(page).toHaveURL(/[?&]sort=title&dir=desc/);
	await expect(page).not.toHaveURL(/after=|before=/);
	await expect.poll(titles(page)).toEqual(descending.pages[0]);

	await test.step("the tags column filters and no longer sorts", async () => {
		await expect(
			page.getByRole("columnheader", { name: "Tags" }).getByRole("link"),
		).toHaveCount(0);
	});

	await test.step("the cursor of another order shows the first page", async () => {
		const stale = new URL(page.url());
		await pager(page).getByRole("link", { name: "Next" }).click();
		await expect(page).toHaveURL(/[?&]after=/);
		const after = new URL(page.url()).searchParams.get("after") ?? "";
		stale.searchParams.set("dir", "asc");
		stale.searchParams.set("after", after);
		await page.goto(stale.pathname + stale.search);
		expect(await titles(page)()).toEqual(ascending.pages[0]);
	});
});

test("status, type and tag filters go to the URL and narrow every page", async ({
	page,
}) => {
	const all = await pagesOf({ sort: NEWEST });
	const drafts = await pagesOf({ sort: NEWEST, statuses: ["DRAFT"] });
	const recursion = await pagesOf({ sort: NEWEST, tags: ["recursion"] });
	const both = await pagesOf({
		sort: NEWEST,
		tags: ["recursion"],
		types: ["multiple-choice"],
	});
	expect(drafts.total).toBeGreaterThan(0);
	expect(recursion.total).toBeGreaterThan(2);
	expect(both.total).toBeGreaterThan(0);

	await page.goto(`${BANK}?limit=2`);
	await pager(page).getByRole("link", { name: "Next" }).click();
	await expect(page).toHaveURL(/[?&]after=/);

	await test.step("a status button leads to the first page of that status", async () => {
		await page.getByRole("button", { name: "Draft", exact: true }).click();
		await expect(page).toHaveURL(/[?&]status=draft/);
		await expect(page).not.toHaveURL(/after=|before=/);
		await expect(page).toHaveURL(/[?&]limit=2/);
		await expect.poll(titles(page)).toEqual(drafts.pages[0]);
		await expect(
			page.getByText(`${drafts.total} of ${all.total} questions`),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Draft", exact: true }),
		).toHaveAttribute("aria-pressed", "true");
	});

	await test.step("clearing the filters brings the whole bank back", async () => {
		await page.getByRole("button", { name: "Clear filters" }).click();
		await expect(page).not.toHaveURL(/status=/);
		await expect.poll(titles(page)).toEqual(all.pages[0]);
	});

	await test.step("the tag menu offers the tags of the whole bank, not of the page", async () => {
		await page.getByRole("button", { name: "Tags", exact: true }).click();
		const tags = await db.question.tags({ course }, FULL_ACCESS);
		expect(tags.length).toBeGreaterThan(2);
		for (const tag of tags)
			await expect(page.getByLabel(tag, { exact: true })).toBeVisible();

		await page.getByLabel("recursion", { exact: true }).click();
		await expect(page).toHaveURL(/[?&]tags=recursion/);
		await expect.poll(titles(page)).toEqual(recursion.pages[0]);
		await pager(page).getByRole("link", { name: "Next" }).click();
		await expect(page).toHaveURL(/[?&]tags=recursion/);
		await expect.poll(titles(page)).toEqual(recursion.pages[1]);
	});

	await test.step("a type narrows it further, back on the first page", async () => {
		await page.getByRole("button", { name: /^Type/ }).click();
		await page.getByLabel("Multiple choice", { exact: true }).click();
		await expect(page).toHaveURL(/[?&]type=multiple-choice/);
		await expect(page).toHaveURL(/[?&]tags=recursion/);
		await expect(page).not.toHaveURL(/after=|before=/);
		await expect.poll(titles(page)).toEqual(both.pages[0]);
		await expect(
			page.getByText(`${both.total} of ${all.total} questions`),
		).toBeVisible();
	});

	await test.step("filters that match nothing say so and offer to clear", async () => {
		await page.goto(`${BANK}?status=archived&type=ordering`);
		await expect(
			page.getByText("No questions match these filters."),
		).toBeVisible();
		await expect(page.getByText(`0 of ${all.total} questions`)).toBeVisible();
	});
});
