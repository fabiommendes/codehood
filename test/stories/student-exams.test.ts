import { expect, type Page, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { capitalChoice, capitalShortAnswer } from "@/mdq/fixtures";
import { courseHref } from "@/urls";
import { logInAs, resetDatabase, seedUser } from "./helpers";

test.beforeEach(resetDatabase);

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

test("student: take an exam", async ({ page }) => {
	const student = await seedUser({ role: "STUDENT", username: "taker" });
	const course = await persistedCourseFactory.create();
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});

	const choiceQuestion = await db.question.create(
		{
			status: "PUBLISHED",
			version: "1",
			course: course.id,
			slug: "capital-choice",
			question: capitalChoice,
		},
		FULL_ACCESS,
	);
	const typedQuestion = await db.question.create(
		{
			status: "PUBLISHED",
			version: "1",
			course: course.id,
			slug: "capital-typed",
			question: capitalShortAnswer,
		},
		FULL_ACCESS,
	);
	const questions = [{ slug: "capital-choice" }, { slug: "capital-typed" }];

	const now = Date.now();
	// Stored as SCHEDULED: the clock alone makes it open, closed or upcoming.
	const open = await persistedExamFactory.create({
		course: course.id,
		slug: "open-midterm",
		title: "Open midterm",
		type: "EXAM",
		status: "SCHEDULED",
		scheduledAt: new Date(now - 10 * MINUTE),
		duration: { hours: 2 },
		questions,
	});
	const upcoming = await persistedExamFactory.create({
		course: course.id,
		slug: "upcoming-final",
		title: "Upcoming final",
		type: "EXAM",
		status: "SCHEDULED",
		scheduledAt: new Date(now + 3 * DAY),
		duration: { hours: 2 },
		questions,
	});
	const closed = await persistedExamFactory.create({
		course: course.id,
		slug: "closed-quiz",
		title: "Closed quiz",
		type: "QUIZ",
		status: "SCHEDULED",
		scheduledAt: new Date(now - 3 * DAY),
		duration: { hours: 1 },
		questions,
	});

	await logInAs(page, student);

	await test.step("the Exams tab labels each exam by the clock, never by the stored status", async () => {
		await page.goto(`${href}/exams`);

		await expect(page.getByText(open.title)).toBeVisible();
		await expect(page.getByText(upcoming.title)).toBeVisible();
		await expect(page.getByText(closed.title)).toBeVisible();

		await expect(page.getByText("Open now", { exact: true })).toBeVisible();
		await expect(page.getByText("Closed", { exact: true })).toBeVisible();
		// Once as the section heading, once as the exam's badge.
		await expect(
			section(page, "Upcoming").getByText("Upcoming", { exact: true }),
		).toHaveCount(2);

		for (const raw of ["SCHEDULED", "ONGOING", "COMPLETED"]) {
			await expect(page.getByText(raw, { exact: true })).toHaveCount(0);
		}
	});

	await test.step("an upcoming exam says when it opens and offers no way to start", async () => {
		await page.goto(`${href}/exams/${upcoming.slug}`);

		await expect(page.getByText("Opens").first()).toBeVisible();
		await expect(page.getByText("Upcoming", { exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: "Start exam" })).toHaveCount(
			0,
		);
	});

	await test.step("a closed exam the student never started says so and offers no way to start", async () => {
		await page.goto(`${href}/exams/${closed.slug}`);

		await expect(page.getByText("You did not take this exam")).toBeVisible();
		await expect(page.getByText("Closed", { exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: "Start exam" })).toHaveCount(
			0,
		);
	});

	await test.step("an open exam offers Start exam and nothing to answer yet", async () => {
		await page.goto(`${href}/exams/${open.slug}`);

		await expect(page.getByText("Open now", { exact: true })).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Start exam" }),
		).toBeVisible();
		await expect(page.getByRole("radio", { name: "Brasília" })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Submit exam" })).toHaveCount(
			0,
		);
	});

	await test.step("starting shows the questions in answer mode, Submit exam and the time left", async () => {
		await page.getByRole("button", { name: "Start exam" }).click();

		await expect(page.getByText(capitalChoice.stem)).toBeVisible();
		await expect(page.getByText(capitalShortAnswer.stem)).toBeVisible();
		await expect(page.getByRole("radio", { name: "Brasília" })).toBeEnabled();
		await expect(page.getByRole("textbox")).toBeEnabled();
		await expect(
			page.getByRole("button", { name: "Submit exam" }),
		).toBeVisible();
		await expect(page.getByText(/\bleft\b/).first()).toBeVisible();
		await expect(page.getByRole("button", { name: "Start exam" })).toHaveCount(
			0,
		);
	});

	await test.step("answers save as they change and survive a reload", async () => {
		await page.getByRole("radio", { name: "Rio de Janeiro" }).check();
		await page.getByRole("radio", { name: "Brasília" }).check();
		await page.getByRole("textbox").fill("Brasília");

		// The latest submission per question holds the answer the student left.
		await expect
			.poll(() => latestAnswer(student.username, open.id, choiceQuestion.id))
			.toEqual({ choice: "brasilia" });
		await expect
			.poll(() => latestAnswer(student.username, open.id, typedQuestion.id))
			.toEqual({ text: "Brasília" });

		await page.reload();

		await expect(page.getByRole("radio", { name: "Brasília" })).toBeChecked();
		await expect(page.getByRole("textbox")).toHaveValue("Brasília");
		await expect(
			page.getByRole("button", { name: "Submit exam" }),
		).toBeVisible();
		await expect(page.getByRole("button", { name: "Start exam" })).toHaveCount(
			0,
		);
	});

	await test.step("cancelling the confirmation keeps the attempt open", async () => {
		await page.getByRole("button", { name: "Submit exam" }).click();

		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText(/can['’]t/);
		await dialog.getByRole("button", { name: /cancel/i }).click();

		await expect(dialog).toBeHidden();
		await expect(page.getByRole("radio", { name: "Brasília" })).toBeEnabled();
		await expect(page.getByText("Submitted")).toHaveCount(0);
		expect(await acceptingSubmissions(student.username, open.id)).toBe(true);
	});

	await test.step("confirming submits the exam and locks the answers", async () => {
		await page.getByRole("button", { name: "Submit exam" }).click();
		await page
			.getByRole("dialog")
			.getByRole("button", { name: /submit|confirm/i })
			.click();

		await expect(page.getByText("Submitted").first()).toBeVisible();
		await expect(page.getByRole("radio", { name: "Brasília" })).toBeDisabled();
		await expect(page.getByRole("radio", { name: "Brasília" })).toBeChecked();
		await expect(page.getByRole("textbox")).not.toBeEditable();
		await expect(page.getByRole("textbox")).toHaveValue("Brasília");
		await expect(page.getByRole("button", { name: "Submit exam" })).toHaveCount(
			0,
		);
		expect(await acceptingSubmissions(student.username, open.id)).toBe(false);
	});

	await test.step("reopening the submitted exam still shows the saved answers, read-only", async () => {
		await page.reload();

		await expect(page.getByText("Submitted").first()).toBeVisible();
		await expect(page.getByRole("radio", { name: "Brasília" })).toBeChecked();
		await expect(page.getByRole("textbox")).toHaveValue("Brasília");
		await expect(page.getByRole("textbox")).not.toBeEditable();
		await expect(page.getByRole("button", { name: "Start exam" })).toHaveCount(
			0,
		);
	});
});

//
// Utilities
//

/// The `<section>` wrapping the heading `title`, as on the exams list.
function section(page: Page, title: string) {
	return page.locator("section").filter({
		has: page.getByRole("heading", { name: title, exact: true }),
	});
}

/// The payload of the newest submission `username` made to `questionId` in the exam.
async function latestAnswer(
	username: string,
	examId: number,
	questionId: number,
): Promise<unknown> {
	const response = await prisma.response.findFirst({
		where: { authorId: username, examId },
	});
	if (!response) return null;
	const full = await db.response.findOne(
		{ publicId: response.publicId },
		FULL_ACCESS,
	);
	const mine = (full?.submissions ?? []).filter(
		(s) => s.questionId === questionId,
	);
	return mine.at(-1)?.payload ?? null;
}

/// Whether the student's attempt at the exam still takes answers, `undefined` when there is none.
async function acceptingSubmissions(
	username: string,
	examId: number,
): Promise<boolean | undefined> {
	const response = await prisma.response.findFirst({
		where: { authorId: username, examId },
	});
	return response?.acceptingSubmissions;
}
