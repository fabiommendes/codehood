import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { capitalChoice, fibonacciOrdering } from "@/mdq/fixtures";
import { courseHref } from "@/urls";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// State variations of the exam page that are not stories of their own.

const MINUTE = 60_000;

test.beforeEach(resetDatabase);

async function setup() {
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create();
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	await db.question.create(
		{
			status: "PUBLISHED",
			version: "1",
			course: course.id,
			slug: "capital",
			question: capitalChoice,
		},
		FULL_ACCESS,
	);
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
	return { student, course, href };
}

test("the instructor's exam page keeps the answer key toggle and has no student actions", async ({
	page,
}) => {
	const { course, href } = await setup();
	await persistedExamFactory.create({
		course: course.id,
		slug: "midterm",
		status: "ONGOING",
		questions: [{ slug: "capital" }],
	});

	await logInAs(page, course.instructor);
	await page.goto(`${href}/exams/midterm`);

	await expect(page.getByText("Student view")).toBeVisible();
	await expect(page.getByText("Correct answer")).toBeVisible();
	await expect(page.getByRole("button", { name: "Start exam" })).toHaveCount(0);
});

test("the instructor's exam page shows a pinned ordering question", async ({
	page,
}) => {
	const { course, href } = await setup();
	await db.question.create(
		{
			status: "PUBLISHED",
			version: "1",
			course: course.id,
			slug: "fibonacci",
			question: fibonacciOrdering,
		},
		FULL_ACCESS,
	);
	await persistedExamFactory.create({
		course: course.id,
		slug: "midterm",
		status: "ONGOING",
		questions: [{ slug: "fibonacci" }],
	});

	await logInAs(page, course.instructor);
	const response = await page.goto(`${href}/exams/midterm`);

	expect(response?.status()).toBe(200);
	await expect(page.getByText("x, y = y, x + y")).toBeVisible();
});

test("an attempt past its own deadline shows as submitted, with nothing left to do", async ({
	page,
}) => {
	const { student, course, href } = await setup();
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "thirty-minutes",
		status: "ONGOING",
		duration: { minutes: 30 },
		questions: [{ slug: "capital" }],
	});
	const attempt = await db.response.create(
		{ course: course.id, exam: exam.slug, author: student.username },
		FULL_ACCESS,
	);
	await prisma.response.update({
		where: { id: attempt.id },
		data: { createdAt: new Date(Date.now() - 31 * MINUTE) },
	});

	await logInAs(page, student);
	await page.goto(`${href}/exams/${exam.slug}`);

	await expect(page.getByText("Submitted").first()).toBeVisible();
	await expect(page.getByRole("button", { name: "Submit exam" })).toHaveCount(
		0,
	);
	await expect(page.getByRole("button", { name: "Start exam" })).toHaveCount(0);
});

test("an attempt left open when the exam window ends shows as submitted", async ({
	page,
}) => {
	const { student, course, href } = await setup();
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "ended-window",
		status: "SCHEDULED",
		scheduledAt: new Date(Date.now() - 10 * MINUTE),
		duration: { hours: 1 },
		questions: [{ slug: "capital" }],
	});
	await db.response.create(
		{ course: course.id, exam: exam.slug, author: student.username },
		FULL_ACCESS,
	);
	// The window closes while the student is away.
	await prisma.exam.update({
		where: { id: exam.id },
		data: { scheduledAt: new Date(Date.now() - 3 * 60 * MINUTE) },
	});

	await logInAs(page, student);
	await page.goto(`${href}/exams/${exam.slug}`);

	await expect(page.getByText("Submitted").first()).toBeVisible();
	await expect(page.getByRole("button", { name: "Submit exam" })).toHaveCount(
		0,
	);
	await expect(page.getByText("You did not take this exam")).toHaveCount(0);
});

test("an answer lost to a network failure says so, and later answers still save", async ({
	page,
}) => {
	const { student, course, href } = await setup();
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "live",
		status: "ONGOING",
		questions: [{ slug: "capital" }],
	});
	await db.response.create(
		{ course: course.id, exam: exam.slug, author: student.username },
		FULL_ACCESS,
	);

	await logInAs(page, student);
	await page.goto(`${href}/exams/${exam.slug}`);

	const answerAction = "**/_actions/exam.answer**";
	await page.route(answerAction, (route) => route.abort());
	await page.getByRole("radio", { name: "Rio de Janeiro" }).check();
	await expect(page.getByText("Not saved", { exact: true })).toBeVisible();
	await expect(page.getByText("1 answer not saved").first()).toBeVisible();

	await page.unroute(answerAction);
	await page.getByRole("radio", { name: "Brasília" }).check();
	await expect(page.getByText("Saved", { exact: true })).toBeVisible();
	await expect
		.poll(async () => {
			const response = await prisma.response.findFirst({
				where: { authorId: student.username, examId: exam.id },
				include: { submissions: { orderBy: { id: "desc" }, take: 1 } },
			});
			return response?.submissions[0]?.payload ?? null;
		})
		.toEqual("brasilia");
});

test("an ordering question left untouched is named in the submit dialog until its order is kept", async ({
	page,
}) => {
	const { student, course, href } = await setup();
	await db.question.create(
		{
			status: "PUBLISHED",
			version: "1",
			course: course.id,
			slug: "fibonacci",
			question: fibonacciOrdering,
		},
		FULL_ACCESS,
	);
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "live",
		status: "ONGOING",
		questions: [{ slug: "capital" }, { slug: "fibonacci" }],
	});
	await db.response.create(
		{ course: course.id, exam: exam.slug, author: student.username },
		FULL_ACCESS,
	);

	await logInAs(page, student);
	await page.goto(`${href}/exams/${exam.slug}`);
	const dialog = page.getByRole("dialog");
	const warning = dialog.getByText(
		"Ordering question 2 has no answer yet and will be skipped.",
		{ exact: false },
	);

	await page.getByRole("button", { name: "Submit exam" }).first().click();
	await expect(warning).toBeVisible();
	await dialog.getByRole("button", { name: "Cancel" }).click();

	await page.getByRole("button", { name: "Keep this order" }).click();
	await expect(page.getByText("Saved", { exact: true })).toBeVisible();
	const saved = await prisma.response.findFirst({
		where: { authorId: student.username, examId: exam.id },
		include: { submissions: { orderBy: { id: "desc" }, take: 1 } },
	});
	const lines = saved?.submissions[0]?.payload as [number, string][];
	expect(lines.map(([, text]) => text).sort()).toEqual(
		[...fibonacciOrdering.lines, ...(fibonacciOrdering.extra ?? [])]
			.map(([, text]) => text)
			.sort(),
	);

	await page.getByRole("button", { name: "Submit exam" }).first().click();
	await expect(dialog.getByText("Your answers can't be changed")).toBeVisible();
	await expect(warning).toHaveCount(0);
});
