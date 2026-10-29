import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { scoreValue } from "@/core/schemas/feedback";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { plateauFillIn } from "@/mdq/fixtures";
import { courseHref } from "@/urls";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// Grading a fill-in answer blank by blank, and what the student sees after release.

test.beforeEach(resetDatabase);

/// A closed exam whose fill-in answer has one blank only the instructor can grade.
async function sitting() {
	const teacher = await seedUser({
		role: "INSTRUCTOR",
		username: "fb-teacher",
	});
	const student = await seedUser({ role: "STUDENT", username: "fb-student" });
	const course = await persistedCourseFactory.create({
		instructor: teacher.username,
	});
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	await db.question.create(
		{
			course: course.id,
			slug: "plateau",
			status: "PUBLISHED",
			version: "1",
			question: plateauFillIn,
		},
		FULL_ACCESS,
	);
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "midterm",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "plateau" }],
	});
	const response = await db.response.submit(
		{
			course: course.id,
			exam: exam.slug,
			question: "plateau",
			payload: { capital: "brasilia", plateau: "Brazilian Highlands" },
		},
		{ actor: student },
	);
	await db.response.finish(
		{ course: course.id, exam: exam.slug },
		{ actor: student },
	);
	await prisma.exam.update({
		where: { id: exam.id },
		data: { status: "COMPLETED" },
	});
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
	const submission = response.submissions.at(-1)?.publicId ?? "";
	return { teacher, student, exam, href, submission };
}

test("grading the pending blank stores its grade and the combined score, and the student sees the blank's comment", async ({
	page,
}) => {
	const { teacher, student, exam, href, submission } = await sitting();
	await logInAs(page, teacher);
	await page.goto(`${href}/exams/midterm/grading/plateau`);

	const article = page.getByRole("article", { name: "Answer 1", exact: true });
	const blank = article.getByRole("group", { name: "Blank plateau" });
	await expect(blank).toBeVisible();
	// The whole-answer score is replaced by one per pending blank.
	await expect(article.getByLabel("Score (%)", { exact: true })).toHaveCount(1);

	await blank.getByLabel("Score (%)").fill("50");
	await blank.getByLabel("Comment").fill("Close enough.");
	await article.getByRole("button", { name: "Save grade" }).click();
	await expect(article).toContainText("75%");

	const [pass] = await prisma.feedback.findMany({
		where: { submission: { publicId: submission } },
	});
	expect(scoreValue(pass?.score ?? "")).toBe(0.75);
	expect(pass?.blanks).toEqual({
		plateau: { score: 0.5, comment: "Close enough." },
	});

	await prisma.exam.update({
		where: { id: exam.id },
		data: { gradesReleasedAt: new Date() },
	});
	await page.context().clearCookies();
	await logInAs(page, student);
	await page.goto(`${href}/exams/midterm`);
	await expect(page.getByText("Close enough.")).toBeVisible();
	await expect(page.getByText("75%").first()).toBeVisible();
});
