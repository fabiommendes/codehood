import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { capitalChoice, capitalShortAnswerManual } from "@/mdq/fixtures";
import { courseHref } from "@/urls";
import { expect, test } from "./fixtures";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// The grading page of a question the library grades by itself: one list of answers, no rubric.

test.beforeEach(resetDatabase);

/// A closed exam with an automatic `q-choice` and a manual `q-short`, answered by three students.
async function sitting() {
	const teacher = await seedUser({
		role: "INSTRUCTOR",
		username: "au-teacher",
	});
	const course = await persistedCourseFactory.create({
		instructor: teacher.username,
	});
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
	for (const [slug, title, question] of [
		["q-choice", "Chosen capital", capitalChoice],
		["q-short", "Typed capital", capitalShortAnswerManual],
	] as const) {
		await db.question.create(
			{
				course: course.id,
				slug,
				status: "PUBLISHED",
				version: "1",
				question: { ...question, id: slug, title },
			},
			FULL_ACCESS,
		);
	}
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "midterm",
		title: "Midterm exam",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "q-choice" }, { slug: "q-short" }],
	});
	const picks = ["brasilia", "rio", "rio"];
	const submissions: string[] = [];
	const names: string[] = [];
	for (const [i, pick] of picks.entries()) {
		const student = await seedUser({
			role: "STUDENT",
			username: `au-student-${i + 1}`,
		});
		names.push(student.name);
		await db.enrollment.create(
			{ course: course.id, username: student.username },
			FULL_ACCESS,
		);
		const choice = await db.response.submit(
			{
				course: course.id,
				exam: exam.slug,
				question: "q-choice",
				payload: pick,
			},
			{ actor: student },
		);
		submissions.push(choice.submissions.at(-1)?.publicId ?? "");
		await db.response.submit(
			{
				course: course.id,
				exam: exam.slug,
				question: "q-short",
				payload: "Brasília",
			},
			{ actor: student },
		);
		await db.response.finish(
			{ course: course.id, exam: exam.slug },
			{ actor: student },
		);
	}
	await prisma.exam.update({
		where: { id: exam.id },
		data: { status: "COMPLETED" },
	});
	return { teacher, names, href: `${href}/exams/midterm/grading`, submissions };
}

test("an automatic question has no rubric and no view switch, and keeps the view in its links", async ({
	page,
}) => {
	const { teacher, href } = await sitting();
	await logInAs(page, teacher);

	await page.goto(`${href}/q-choice?view=list`);

	await expect(
		page.getByRole("heading", { level: 2, name: "Chosen capital" }),
	).toBeVisible();
	await expect(page.getByRole("link", { name: "List view" })).toHaveCount(0);
	await expect(
		page.getByRole("link", { name: "One answer at a time" }),
	).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: /save and next/i }),
	).toHaveCount(0);
	await expect(page.getByTestId("summary")).toBeVisible();
	await expect(
		page.getByRole("link", { name: "Next question" }),
	).toHaveAttribute("href", /view=list/);
	await page.goto(`${href}/q-choice`);
	await expect(
		page.getByRole("button", { name: /save and next/i }),
	).toHaveCount(0);
});

test("a manual question keeps the one-at-a-time view and the switch", async ({
	page,
}) => {
	const { teacher, href } = await sitting();
	await logInAs(page, teacher);

	await page.goto(`${href}/q-short`);

	await expect(page.getByRole("link", { name: "List view" })).toBeVisible();
	await page.getByRole("link", { name: "List view" }).click();
	await expect(page).toHaveURL(/view=list/);
	await expect(page.getByRole("article")).toHaveCount(3);
});
