import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { capitalShortAnswer } from "@/mdq/fixtures";
import { courseHref } from "@/urls";
import { logInAs, resetDatabase, seedUser } from "./helpers";

test.beforeEach(resetDatabase);

const MINUTE = 60_000;

/// Submissions are stamped relative to this, so their order does not depend on how fast the arrange steps ran.
const T0 = new Date("2026-03-10T10:00:00Z");

test("instructor: grade submissions by hand", async ({ page }) => {
	const teacher = await seedUser({ role: "INSTRUCTOR", username: "grader" });
	const course = await persistedCourseFactory.create({
		instructor: teacher.username,
	});
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
	await db.question.create(
		{
			course: course.id,
			slug: "q-short",
			status: "PUBLISHED",
			version: "1",
			question: {
				...capitalShortAnswer,
				id: "q-short",
				title: "Typed capital",
			},
		},
		FULL_ACCESS,
	);
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "midterm",
		title: "Midterm exam",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "q-short" }],
	});

	const students: Awaited<ReturnType<typeof seedUser>>[] = [];
	for (const [i, text] of [
		"Alpha reply",
		"Bravo reply",
		"Charlie reply",
	].entries()) {
		const student = await seedUser({
			role: "STUDENT",
			username: `gs-student-${i + 1}`,
		});
		await db.enrollment.create(
			{ course: course.id, username: student.username },
			FULL_ACCESS,
		);
		const response = await db.response.submit(
			{
				course: course.id,
				exam: exam.slug,
				question: "q-short",
				payload: { text },
			},
			{ actor: student },
		);
		await prisma.submission.update({
			where: { publicId: response.submissions.at(-1)?.publicId ?? "" },
			data: { createdAt: new Date(T0.getTime() + (i + 1) * MINUTE) },
		});
		await db.response.finish(
			{ course: course.id, exam: exam.slug },
			{ actor: student },
		);
		students.push(student);
	}
	await prisma.exam.update({
		where: { id: exam.id },
		data: { status: "COMPLETED" },
	});

	const grading = `${href}/exams/midterm/grading`;
	await logInAs(page, teacher);

	await test.step("the home page points at the exam with answers to grade", async () => {
		await page.goto("/");

		await expect(page).toHaveURL("/");
		const toGrade = page.locator("section").filter({
			has: page.getByRole("heading", { name: "To grade", exact: true }),
		});
		const item = toGrade.getByRole("link").filter({ hasText: "Midterm exam" });
		await expect(item).toContainText("3 answers to grade");
		await item.click();

		await expect(page).toHaveURL(grading);
		await expect(
			page.getByRole("heading", { level: 2, name: "Grading", exact: true }),
		).toBeVisible();
	});

	await test.step("the queue shows the question with its pending answers and opens it", async () => {
		const item = page
			.getByRole("list", { name: "Questions" })
			.getByRole("listitem")
			.filter({ hasText: "Typed capital" });
		await expect(item).toContainText("3 pending");
		await item
			.getByRole("link", { name: "Typed capital", exact: true })
			.click();

		await expect(page).toHaveURL(`${grading}/q-short`);
		await expect(
			page.getByRole("heading", {
				level: 2,
				name: "Typed capital",
				exact: true,
			}),
		).toBeVisible();
		await expect(page.getByRole("article")).toHaveCount(3);
	});

	await test.step("grading the oldest answer with a comment moves it under Graded", async () => {
		const answer = page.getByRole("article", { name: "Answer 1", exact: true });
		await expect(answer).toContainText("Alpha reply");
		await answer.getByLabel("Score (%)", { exact: true }).fill("75");
		await answer
			.getByLabel("Comment", { exact: true })
			.fill("Missing the base case");
		await answer.getByRole("button", { name: "Save grade" }).click();

		await expect(
			page.getByRole("heading", { level: 3, name: "Graded", exact: true }),
		).toBeVisible();
		const graded = page.getByRole("article").filter({ hasText: "Alpha reply" });
		await expect(graded).toContainText("75%");
		await expect(graded).toContainText("Missing the base case");
		await expect(
			graded.getByRole("button", { name: "Save grade" }),
		).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Save grade" })).toHaveCount(
			2,
		);
	});

	await test.step("back in the queue, one fewer answer is pending", async () => {
		await page.getByRole("link", { name: "← Grading", exact: true }).click();

		await expect(page).toHaveURL(grading);
		const item = page
			.getByRole("list", { name: "Questions" })
			.getByRole("listitem")
			.filter({ hasText: "Typed capital" });
		await expect(item).toContainText("2 pending");
		await expect(item).toContainText("1 graded");
	});

	await test.step("the student who was graded still sees Awaiting grading and no score", async () => {
		await page.context().clearCookies();
		await logInAs(page, students[0] ?? teacher);
		await page.goto(`${href}/exams/midterm`);

		await expect(page).toHaveURL(`${href}/exams/midterm`);
		await expect(
			page.getByText("Awaiting grading", { exact: true }),
		).toBeVisible();
		await expect(page.getByText(/\d+%/)).toHaveCount(0);
		await expect(page.getByText("Missing the base case")).toHaveCount(0);
	});
});
