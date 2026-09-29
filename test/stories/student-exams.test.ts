import { expect, type Page, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db, type schema } from "@/db";
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
		await expect(
			page.getByText("Awaiting grading", { exact: true }),
		).toBeVisible();
		await expect(page.getByText("Open now", { exact: true })).toHaveCount(0);
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
		await expect(
			page.getByText("Awaiting grading", { exact: true }),
		).toBeVisible();
		await expect(page.getByRole("radio", { name: "Brasília" })).toBeChecked();
		await expect(page.getByRole("textbox")).toHaveValue("Brasília");
		await expect(page.getByRole("textbox")).not.toBeEditable();
		await expect(page.getByRole("button", { name: "Start exam" })).toHaveCount(
			0,
		);
	});
});

test("student: see my grades and feedback", async ({ page }) => {
	const student = await seedUser({ role: "STUDENT", username: "graded" });
	const other = await seedUser({ role: "STUDENT", username: "bystander" });
	const course = await persistedCourseFactory.create();
	for (const who of [student, other]) {
		await db.enrollment.create(
			{ course: course.id, username: who.username },
			FULL_ACCESS,
		);
	}
	const grader = course.instructor.username;
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: grader,
		edition: course.edition.slug,
	});

	for (const [slug, question] of [
		["q-capital", capitalChoice],
		["q-planet", planetChoice],
		["q-typed", capitalShortAnswer],
	] as const) {
		await db.question.create(
			{ course: course.id, slug, status: "PUBLISHED", version: "1", question },
			FULL_ACCESS,
		);
	}

	/// Opens an exam, has the student answer and finish it, then closes the exam.
	async function sitExam(
		slug: string,
		title: string,
		answers: [string, unknown][],
	) {
		const exam = await persistedExamFactory.create({
			course: course.id,
			slug,
			title,
			type: "EXAM",
			status: "ONGOING",
			questions: answers.map(([question]) => ({ slug: question })),
		});
		const submissions: Record<string, string> = {};
		for (const [question, payload] of answers) {
			const response = await db.response.submit(
				// biome-ignore lint/suspicious/noExplicitAny: payloads of several question types
				{ course: course.id, exam: slug, question, payload: payload as any },
				{ actor: student },
			);
			submissions[question] = response.submissions.at(-1)?.publicId ?? "";
		}
		await db.response.finish(
			{ course: course.id, exam: slug },
			{ actor: student },
		);
		await prisma.exam.update({
			where: { id: exam.id },
			data: { status: "COMPLETED" },
		});
		return { exam, submissions };
	}

	/// One grading pass; `minutesAgo` fixes the order passes were written in.
	async function grade(
		submission: string,
		ref: string,
		score: string,
		feedback: string,
		by: { grader: string } | { bot: string },
		minutesAgo: number,
	) {
		const pass = await db.feedback.create(
			{ submission: { publicId: submission }, ref, score, feedback, ...by },
			FULL_ACCESS,
		);
		await prisma.feedback.update({
			where: { id: pass.id },
			data: { updatedAt: new Date(Date.now() - minutesAgo * MINUTE) },
		});
	}

	const release = (examId: schema.ExamId) =>
		prisma.exam.update({
			where: { id: examId },
			data: { gradesReleasedAt: new Date(Date.now() - 60 * MINUTE) },
		});

	// The midterm: one answer the instructor graded, one a bot graded and the
	// instructor revised, one nobody has graded yet.
	const midterm = await sitExam("midterm", "Midterm", [
		["q-capital", { choice: "brasilia" }],
		["q-planet", { choice: "mercury" }],
		["q-typed", { text: "Brasilia" }],
	]);
	await grade(
		midterm.submissions["q-capital"] ?? "",
		"pass-1",
		"1",
		"Well argued",
		{ grader },
		30,
	);
	await grade(
		midterm.submissions["q-planet"] ?? "",
		"bot-1",
		"0",
		"Bot: output mismatch",
		{ bot: "autograder" },
		50,
	);
	await grade(
		midterm.submissions["q-planet"] ?? "",
		"pass-2",
		"1/2",
		"Partial credit: mention the orbit",
		{ grader },
		20,
	);

	// A recap that is fully graded and released, and a final whose grades exist
	// but are not released.
	const recap = await sitExam("recap", "Recap", [
		["q-capital", { choice: "brasilia" }],
	]);
	await grade(
		recap.submissions["q-capital"] ?? "",
		"pass-1",
		"1",
		"Spot on",
		{ grader },
		10,
	);
	await release(recap.exam.id);

	const final = await sitExam("final", "Final", [
		["q-capital", { choice: "rio" }],
	]);
	await grade(
		final.submissions["q-capital"] ?? "",
		"pass-1",
		"3/4",
		"Hidden until release",
		{ grader },
		10,
	);

	await logInAs(page, student);

	await test.step("before grades are released the attempt says so and shows no score", async () => {
		await page.goto(`${href}/exams/${midterm.exam.slug}`);

		await expect(page.getByText("Submitted").first()).toBeVisible();
		await expect(
			page.getByText("Awaiting grading", { exact: true }),
		).toBeVisible();
		await expect(page.getByText(/not released/i)).toBeVisible();
		await expect(page.getByText(/\d+%/)).toHaveCount(0);
		await expect(page.getByText("Well argued")).toHaveCount(0);
		await expect(page.getByText("Your score")).toHaveCount(0);
	});

	await test.step("with one question still pending there is no total and no zero", async () => {
		await release(midterm.exam.id);
		await page.reload();

		await expect(page.getByText("Your score")).toHaveCount(0);
		await expect(page.getByText("Waiting to be graded")).toHaveCount(1);
		await expect(page.getByText(/\b0%/)).toHaveCount(0);
		await expect(page.getByText("Graded", { exact: true })).toBeVisible();
		await expect(
			page.getByText("Awaiting grading", { exact: true }),
		).toHaveCount(0);
	});

	await test.step("each graded question shows its score and its comments, newest first", async () => {
		await expect(page.getByText("100%")).toBeVisible();
		await expect(page.getByText("Well argued")).toBeVisible();
		await expect(page.getByText("50%")).toBeVisible();
		await expect(page.getByText(/Partial credit|output mismatch/)).toHaveText([
			/Partial credit: mention the orbit/,
			/Bot: output mismatch/,
		]);
	});

	await test.step("the student's answers stay visible, read-only", async () => {
		await expect(page.getByRole("radio", { name: "Brasília" })).toBeChecked();
		await expect(page.getByRole("radio", { name: "Brasília" })).toBeDisabled();
		await expect(page.getByRole("radio", { name: "Mercury" })).toBeChecked();
		await expect(page.getByRole("radio", { name: "Mercury" })).toBeDisabled();
		await expect(page.getByRole("textbox")).toHaveValue("Brasilia");
		await expect(page.getByRole("textbox")).not.toBeEditable();
	});

	await test.step("once the last question is graded the total appears", async () => {
		await grade(
			midterm.submissions["q-typed"] ?? "",
			"pass-1",
			"1/2",
			"Mind the accent",
			{ grader },
			5,
		);
		await page.reload();

		await expect(page.getByText(/Your score.*67%/)).toBeVisible();
		await expect(page.getByText("Waiting to be graded")).toHaveCount(0);
		await expect(page.getByText("Mind the accent")).toBeVisible();
	});

	await test.step("the Exams tab shows the total of each released exam and nothing for an unreleased one", async () => {
		await page.goto(`${href}/exams`);

		const past = section(page, "Past exams and grades");
		await expect(past.getByText("Midterm")).toBeVisible();
		await expect(past.getByText("Recap")).toBeVisible();
		await expect(past.getByText("Final")).toBeVisible();
		await expect(past.getByText("67%")).toBeVisible();
		await expect(past.getByText("100%")).toBeVisible();
		// Only the two released exams show a percentage; the final shows none.
		await expect(past.getByText(/\d+%/)).toHaveCount(2);
		await expect(page.getByText("75%")).toHaveCount(0);
		// Each row carries the student's own state: graded or still awaiting it.
		await expect(
			past.getByRole("link").filter({ hasText: "Midterm" }),
		).toContainText("Graded");
		await expect(
			past.getByRole("link").filter({ hasText: "Final" }),
		).toContainText("Awaiting grading");
	});

	await test.step("another student sees none of these grades", async () => {
		await page.context().clearCookies();
		await logInAs(page, other);
		await page.goto(`${href}/exams/${midterm.exam.slug}`);

		await expect(page.getByText("You did not take this exam")).toBeVisible();
		await expect(page.getByText(/\d+%/)).toHaveCount(0);
		await expect(page.getByText("Well argued")).toHaveCount(0);
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

/// A second multiple-choice question, so the midterm has two radio groups.
const planetChoice = {
	type: "multiple-choice" as const,
	id: "closest-planet",
	stem: "Which planet is closest to the Sun?",
	choices: [
		{ id: "mercury", text: "Mercury", score: 1 },
		{ id: "venus", text: "Venus", score: 0 },
	],
};
