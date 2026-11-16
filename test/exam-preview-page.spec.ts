import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { capitalChoice, idempotenceEssay } from "@/mdq/fixtures";
import { courseHref } from "@/urls";
import { expect, test } from "./fixtures";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// The instructor's preview of an exam is the student's attempt page over their simulation.

test.beforeEach(resetDatabase);

/// A course with a student and a draft exam of a multiple-choice and an essay question.
async function setup() {
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create();
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	for (const [slug, question] of [
		["capital", capitalChoice],
		["idempotence", idempotenceEssay],
	] as const) {
		await db.question.create(
			{
				status: "PUBLISHED",
				version: "1",
				course: course.id,
				slug,
				question,
			},
			FULL_ACCESS,
		);
	}
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "midterm",
		type: "EXAM",
		status: "DRAFT",
		questions: [{ slug: "capital" }, { slug: "idempotence" }],
	});
	const href = `${courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	})}/exams/${exam.slug}`;
	return { student, course, exam, href };
}

test("the instructor starts the simulation of a draft exam, answers, submits and reads the result", async ({
	page,
}) => {
	const { course, href } = await setup();
	await logInAs(page, course.instructor);

	await page.goto(`${href}/preview`);
	const banner = page.getByTestId("preview-banner");
	await expect(banner).toContainText("does not count toward any grade");
	await page.getByRole("button", { name: "Start exam" }).click();

	const choice = page
		.getByRole("region", { name: "Question 1" })
		.getByRole("radio", { name: "Brasília" });
	await choice.check();
	await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible();
	await page
		.getByRole("region", { name: "Question 2" })
		.getByRole("textbox")
		.fill("Applying it twice changes nothing.");

	await page.getByRole("button", { name: "Submit exam" }).first().click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Submit exam" })
		.click();

	await expect(page.getByText("Score", { exact: true }).first()).toBeVisible();
	await expect(page.getByText("Manual grading")).toBeVisible();
	await expect(
		page.getByRole("link", { name: "See the answer key" }),
	).toHaveAttribute("href", /\/questions\/idempotence$/);
	await expect(banner).toBeVisible();
	expect(await prisma.response.count({ where: { preview: true } })).toBe(1);
});

test("restarting discards the simulation's answers", async ({ page }) => {
	const { course, href } = await setup();
	await logInAs(page, course.instructor);
	await page.goto(`${href}/preview`);
	await page.getByRole("button", { name: "Start exam" }).click();
	const choice = page
		.getByRole("region", { name: "Question 1" })
		.getByRole("radio", { name: "Brasília" });
	await choice.check();
	await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible();
	const before = await prisma.response.findFirstOrThrow({
		where: { preview: true },
	});

	page.once("dialog", (dialog) => dialog.accept());
	await page.getByRole("button", { name: "Restart" }).click();

	await expect(choice).not.toBeChecked();
	const after = await prisma.response.findMany({ where: { preview: true } });
	expect(after).toHaveLength(1);
	expect(after[0]?.publicId).not.toBe(before.publicId);
});

test("a student of the course gets 403 on the preview", async ({ page }) => {
	const { student, href } = await setup();
	await logInAs(page, student);

	expect((await page.goto(`${href}/preview`))?.status()).toBe(403);
});

test("the old questions page of the exam no longer exists", async ({
	page,
}) => {
	const { course, href } = await setup();
	await logInAs(page, course.instructor);

	expect((await page.goto(`${href}/questions`))?.status()).toBe(404);
});
