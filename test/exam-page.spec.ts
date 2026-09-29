import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { capitalChoice } from "@/mdq/fixtures";
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
