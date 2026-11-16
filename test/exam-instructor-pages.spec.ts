import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { capitalChoice } from "@/mdq/fixtures";
import { courseHref } from "@/urls";
import { expect, test } from "./fixtures";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// The instructor's pages under `exams/[slug]`, one task each.

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
	await persistedExamFactory.create({
		course: course.id,
		slug: "midterm",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "capital" }],
	});
	await persistedExamFactory.create({
		course: course.id,
		slug: "drill",
		type: "PRACTICE",
		status: "ONGOING",
		questions: [{ slug: "capital" }],
	});
	const href = `${courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	})}/exams`;
	return { student, course, href };
}

for (const page of ["questions", "exceptions", "results"]) {
	test(`${page}: a student of the course gets 403`, async ({ page: tab }) => {
		const { student, href } = await setup();
		await logInAs(tab, student);

		const response = await tab.goto(`${href}/midterm/${page}`);

		expect(response?.status()).toBe(403);
	});
}

test("a practice exam has the questions page but no exceptions nor results", async ({
	page,
}) => {
	const { course, href } = await setup();
	await logInAs(page, course.instructor);

	expect((await page.goto(`${href}/drill/questions`))?.status()).toBe(200);
	expect((await page.goto(`${href}/drill/exceptions`))?.status()).toBe(404);
	expect((await page.goto(`${href}/drill/results`))?.status()).toBe(404);
});

test("the overview says why the grades cannot be released yet", async ({
	page,
}) => {
	const { course, href } = await setup();
	await logInAs(page, course.instructor);

	await page.goto(`${href}/midterm`);

	await expect(page.getByTestId("release-status")).toContainText(
		"Results not released yet.",
	);
	await expect(
		page.getByRole("button", { name: "Release results" }),
	).toHaveCount(0);
});

test("the exam card reaches each page of the instructor", async ({ page }) => {
	const { course, href } = await setup();
	await logInAs(page, course.instructor);
	await page.goto(`${href}/midterm`);
	const card = page.locator("[data-course-card]");

	await card.getByRole("link", { name: "Questions" }).click();
	await expect(page).toHaveURL(`${href}/midterm/questions`);

	await card.getByRole("link", { name: "Exceptions" }).click();
	await expect(page).toHaveURL(`${href}/midterm/exceptions`);

	await card.getByRole("link", { name: "Results", exact: true }).click();
	await expect(page).toHaveURL(`${href}/midterm/results`);
	await card.getByRole("link", { name: "By question" }).click();
	await expect(page).toHaveURL(`${href}/midterm/results#by-question`);
});
