import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { courseHref } from "@/urls";
import {
	fillField,
	futureDate,
	logInAs,
	openTab,
	resetDatabase,
	seedUser,
} from "./helpers";

test.beforeEach(resetDatabase);

const MINUTE = 60_000;

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

	await test.step("each question's status reads as a word, not as the stored enum", async () => {
		// The status filter buttons carry the same words as the badges.
		const rows = page.getByRole("row");
		await expect(
			rows.getByText("Published", { exact: true }).first(),
		).toBeVisible();
		await expect(
			rows.getByText("Draft", { exact: true }).first(),
		).toBeVisible();
		for (const raw of ["PUBLISHED", "DRAFT"]) {
			await expect(page.getByText(raw, { exact: true })).toHaveCount(0);
		}
	});

	await test.step("so does an archived one", async () => {
		await db.question.create(
			{
				course: course.id,
				slug: "retired-question",
				status: "ARCHIVED",
				version: "v1",
				question: {
					type: "essay",
					title: "Retired question",
					stem: "No longer used.",
					tags: ["retired"],
					input: "text",
				},
			},
			FULL_ACCESS,
		);
		await page.goto(`${href}/questions`);
		await expect(page.getByText("Retired question")).toBeVisible();
		await expect(
			page.getByRole("row").getByText("Archived", { exact: true }).first(),
		).toBeVisible();
		await expect(page.getByText("ARCHIVED", { exact: true })).toHaveCount(0);
	});

	await test.step("opening one shows its title, type and status", async () => {
		await page.goto(`${href}/questions`);
		await page.getByText("Recursion basics").click();
		await expect(page).toHaveURL(`${href}/questions/recursion-basics`);

		await expect(
			page.getByRole("heading", { name: "Recursion basics" }),
		).toBeVisible();
		await expect(page.getByText("Multiple choice").first()).toBeVisible();
		await expect(
			page.getByText("Published", { exact: true }).first(),
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
	await db.exam.create(
		{
			course: course.id,
			slug: "middle-quiz",
			title: "Middle quiz",
			type: "QUIZ",
			status: "ONGOING",
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

	await test.step("an open exam comes before the drafts by default", async () => {
		await expect(titleCells.first()).toHaveText("Middle quiz");
	});

	await test.step("clicking Title sorts the exams by title", async () => {
		await page.getByRole("button", { name: "Title" }).click();

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
		page.getByText("New key created. Copy it now. It won't be shown again."),
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

test("instructor: Give a student extra time or a makeup exam", async ({
	page,
}) => {
	const course = await persistedCourseFactory.create();
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
	const ana = await seedUser({
		role: "STUDENT",
		username: "exc-ana",
		name: "Ana Accommodated",
	});
	const bia = await seedUser({
		role: "STUDENT",
		username: "exc-bia",
		name: "Bia Absent",
	});
	for (const student of [ana, bia]) {
		await db.enrollment.create(
			{ course: course.id, username: student.username },
			FULL_ACCESS,
		);
	}

	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "exc-midterm",
		title: "Exception midterm",
		type: "EXAM",
		status: "ONGOING",
	});
	// Ana's attempt is closed with nothing to grade, so only timing can block the release.
	const attempt = await db.response.create(
		{ course: course.id, exam: exam.slug, author: ana.username },
		FULL_ACCESS,
	);
	await db.response.update(
		{ publicId: attempt.publicId },
		{ acceptingSubmissions: false },
		FULL_ACCESS,
	);
	// Closed for the class an hour ago: scheduled two hours back, 60 minutes long.
	await prisma.exam.update({
		where: { id: exam.id },
		data: {
			status: "SCHEDULED",
			scheduledAt: new Date(Date.now() - 120 * MINUTE),
			durationMs: 60 * MINUTE,
		},
	});

	await logInAs(page, course.instructor);
	const examUrl = `${href}/exams/${exam.slug}`;
	const exceptions = page.locator("section").filter({
		has: page.getByRole("heading", { name: "Exceptions", exact: true }),
	});
	const dialog = page.getByRole("dialog");
	const releaseButton = page.getByRole("button", { name: "Release results" });

	const exceptionOf = (username: string) =>
		db.examException.findOne(
			{ course: course.id, exam: exam.slug, username },
			FULL_ACCESS,
		);

	async function pickStudent(username: string) {
		await dialog
			.getByRole("group", { name: "Student", exact: true })
			.getByRole("combobox")
			.selectOption(username);
	}

	await test.step("with no exceptions, the closed exam can be released", async () => {
		await page.goto(examUrl);
		await expect(releaseButton).toBeVisible();
		await expect(
			exceptions.getByRole("button", { name: "Add exception" }),
		).toBeVisible();
	});

	await test.step("saving an exception that grants nothing is refused and stores nothing", async () => {
		await exceptions.getByRole("button", { name: "Add exception" }).click();
		await expect(dialog).toBeVisible();
		await pickStudent(ana.username);
		await dialog.getByRole("button", { name: "Save" }).click();

		await expect(dialog.getByRole("alert")).toBeVisible();
		await expect(dialog).toBeVisible();
		expect(await exceptionOf(ana.username)).toBeNull();
	});

	await test.step("extra time is added to one student and shown in the exam's exception list", async () => {
		await fillField(page, "Extra time (minutes)", "90");
		await fillField(page, "Note", "special accommodation");
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog).toBeHidden();

		const row = exceptions
			.getByRole("row")
			.filter({ hasText: "Ana Accommodated" });
		await expect(row).toContainText("+90 min");
		expect(await exceptionOf(ana.username)).toMatchObject({
			note: "special accommodation",
		});
	});

	await test.step("a makeup date is added to another student", async () => {
		await exceptions.getByRole("button", { name: "Add exception" }).click();
		await pickStudent(bia.username);
		await fillField(page, "New date and time", `${futureDate(2).date}T14:00`);
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog).toBeHidden();

		await expect(
			exceptions.getByRole("row").filter({ hasText: "Bia Absent" }),
		).toBeVisible();
		const stored = await exceptionOf(bia.username);
		expect(stored?.scheduledAt?.getTime()).toBeGreaterThan(
			Date.now() + 24 * 60 * MINUTE,
		);
	});

	await test.step("while personal windows are pending, the release is blocked and the page says why", async () => {
		await page.reload();
		await expect(
			page.getByText("A student with an exception can still answer this exam"),
		).toBeVisible();
		await expect(releaseButton).toHaveCount(0);
	});

	await test.step("the attempt page shows the exception and reopens a closed attempt inside the personal window", async () => {
		await page.goto(`${examUrl}/attempts/${ana.username}`);
		await expect(page.getByText("+90 min")).toBeVisible();
		await expect(
			page.getByRole("link", { name: "Edit exception" }),
		).toBeVisible();

		await page.getByRole("button", { name: "Reopen attempt" }).click();

		await expect(
			page.getByRole("button", { name: "Reopen attempt" }),
		).toHaveCount(0);
		await expect(page.getByText("In progress").first()).toBeVisible();
		await expect(
			prisma.response.findUniqueOrThrow({ where: { id: attempt.id } }),
		).resolves.toMatchObject({ acceptingSubmissions: true });
	});

	await test.step("removing an exception asks for confirmation and takes the student back to the exam's timing", async () => {
		await page.goto(examUrl);
		for (const name of ["Ana Accommodated", "Bia Absent"]) {
			await exceptions
				.getByRole("row")
				.filter({ hasText: name })
				.getByRole("button", { name: "Remove" })
				.click();
			await expect(
				dialog.getByRole("heading", { name: "Remove exception?" }),
			).toBeVisible();
			await dialog.getByRole("button", { name: "Remove" }).click();
			await expect(dialog).toBeHidden();
			await expect(
				exceptions.getByRole("row").filter({ hasText: name }),
			).toHaveCount(0);
		}
		expect(await exceptionOf(ana.username)).toBeNull();
		expect(await exceptionOf(bia.username)).toBeNull();

		await page.reload();
		await expect(releaseButton).toBeVisible();
	});
});
