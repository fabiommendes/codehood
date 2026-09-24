import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { courseHref } from "@/urls";
import {
	fillField,
	logInAs,
	openTab,
	resetDatabase,
	seedUser,
} from "./helpers";

test.beforeEach(resetDatabase);

test("instructor: browse the question bank", async ({ page }) => {
	const course = await persistedCourseFactory.create();
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});

	await logInAs(page, course.instructor);

	await test.step("before anything is pushed, the list says so", async () => {
		await page.goto(`${href}/questions`);
		await expect(page.getByText("No questions yet.")).toBeVisible();
	});

	await db.question.create(
		{
			course: course.id,
			slug: "recursion-basics",
			status: "PUBLISHED",
			version: "v1",
			question: {
				type: "multiple-choice",
				title: "Recursion basics",
				stem: "Which of the following is required for a recursive function to terminate?",
				tags: ["recursion"],
				choices: [
					{ id: "base-case", text: "A base case", score: 1 },
					{ id: "tail-call", text: "A tail call" },
				],
			},
		},
		FULL_ACCESS,
	);
	await db.question.create(
		{
			course: course.id,
			slug: "linked-list-invariants",
			status: "DRAFT",
			version: "v1",
			question: {
				type: "essay",
				title: "Linked list invariants",
				stem: "Describe the invariant your `insert` implementation must preserve.",
				tags: ["data-structures"],
				input: "text",
			},
		},
		FULL_ACCESS,
	);

	await test.step("the list shows every question pushed to the course", async () => {
		await page.goto(`${href}/questions`);

		await expect(page.getByText("Recursion basics")).toBeVisible();
		await expect(page.getByText("Linked list invariants")).toBeVisible();
		await expect(page.getByText("2 questions")).toBeVisible();
	});

	await test.step("opening one shows its title, type and status", async () => {
		await page.getByText("Recursion basics").click();
		await expect(page).toHaveURL(`${href}/questions/recursion-basics`);

		await expect(
			page.getByRole("heading", { name: "Recursion basics" }),
		).toBeVisible();
		await expect(page.getByText("Multiple choice").first()).toBeVisible();
		await expect(
			page.getByText("PUBLISHED", { exact: true }).first(),
		).toBeVisible();
	});
});

test("instructor: browse the exam list", async ({ page }) => {
	const course = await persistedCourseFactory.create();
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});

	await db.exam.create(
		{
			course: course.id,
			slug: "alpha-quiz",
			title: "Alpha quiz",
			type: "QUIZ",
		},
		FULL_ACCESS,
	);
	await db.exam.create(
		{
			course: course.id,
			slug: "zulu-final",
			title: "Zulu final",
			type: "EXAM",
		},
		FULL_ACCESS,
	);

	await logInAs(page, course.instructor);

	// Regression coverage for a bug where the table's hydrated island failed
	// silently: the server-rendered rows looked fine, but every header click
	// was dead because a module it imported threw during hydration.
	const consoleErrors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") consoleErrors.push(message.text());
	});

	await page.goto(`${href}/exams`);

	const titleCells = page.locator("table tbody tr td:first-child");

	await test.step("exams list title-ascending by default", async () => {
		await expect(titleCells.first()).toHaveText("Alpha quiz");
		await expect(titleCells.last()).toHaveText("Zulu final");
	});

	await test.step("clicking Title again reverses the order", async () => {
		await page.getByRole("button", { name: "Title" }).click();

		await expect(titleCells.first()).toHaveText("Zulu final");
		await expect(titleCells.last()).toHaveText("Alpha quiz");
	});

	expect(consoleErrors).toEqual([]);
});

test("instructor: Let a bot grade for me", async ({ page, request }) => {
	const instructor = await seedUser({ role: "INSTRUCTOR" });
	await logInAs(page, instructor);

	await test.step("the instructor issues a key of kind Bot", async () => {
		await page.goto("/profile");
		await openTab(page, "API keys");
		await fillField(page, "Key name", "grading bot");
		await page
			.getByRole("group", { name: "Kind", exact: true })
			.getByRole("combobox")
			.selectOption("BOT");
		await page.getByRole("button", { name: "Create key" }).click();
	});

	await expect(
		page.getByText("New key created. Copy it now — it won't be shown again."),
	).toBeVisible();
	await expect(page.getByText("bot", { exact: true })).toBeVisible();

	const token = (await page.getByRole("code").innerText()).trim();

	await test.step("and the bot acts as the instructor who issued it", async () => {
		const res = await request.get("/api/user/me", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.ok()).toBe(true);
		expect(await res.json()).toMatchObject({
			username: instructor.username,
			role: "INSTRUCTOR",
		});
	});

	await test.step("while an unissued key is refused", async () => {
		const res = await request.get("/api/user/me", {
			headers: { Authorization: "Bearer not-a-real-key" },
		});
		expect(res.ok()).toBe(false);
	});
});
