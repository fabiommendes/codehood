import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { capitalChoice } from "@/mdq/fixtures";
import { courseHref } from "@/urls";
import { expect, test } from "./fixtures";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// The instructor's overview lists the questions of the exam.

test.beforeEach(resetDatabase);

/// A course with two questions, `heavy` (weight 3) and `light`, and the exams `weighted` and `plain`.
async function setup() {
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create();
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	for (const [slug, weight] of [
		["heavy", 3],
		["light", 1],
	] as const) {
		await db.question.create(
			{
				status: "PUBLISHED",
				version: "1",
				course: course.id,
				slug,
				question: { ...capitalChoice, id: slug, title: `T ${slug}`, weight },
			},
			FULL_ACCESS,
		);
	}
	const weighted = await persistedExamFactory.create({
		course: course.id,
		slug: "weighted",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "heavy" }, { slug: "light" }],
	});
	await persistedExamFactory.create({
		course: course.id,
		slug: "plain",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "light" }],
	});
	const href = `${courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	})}/exams`;
	return { student, course, weighted, href };
}

test("the overview lists the questions with Qn, title, type, grading and weight", async ({
	page,
}) => {
	const { course, href } = await setup();
	await logInAs(page, course.instructor);

	await page.goto(`${href}/weighted`);

	const rows = page.locator("[data-testid=exam-questions] tbody tr");
	await expect(rows).toHaveCount(2);
	await expect(rows.nth(0)).toContainText("Q1");
	await expect(rows.nth(0)).toContainText("T heavy");
	await expect(rows.nth(0).locator("td").nth(0)).toContainText(
		/^Q1\s*T heavy\s*(Automatic grading|Correção automática)$/,
	);
	await expect(rows.nth(0).locator("td").nth(1)).toHaveText(
		/^(Multiple choice|Múltipla escolha)$/,
	);
	await expect(rows.nth(0).locator("td").nth(2)).toHaveText(/^3[.,]00$/);
	await expect(rows.nth(1)).toContainText("Q2");
	await expect(rows.nth(1)).toContainText("T light");
	await expect(rows.nth(0).getByRole("link")).toHaveAttribute(
		"href",
		/\/questions\/heavy$/,
	);
	await expect(
		page.getByRole("columnheader", { name: /^(Peso|Weight)$/ }),
	).toBeVisible();
});

test("an exam whose questions all weigh 1 still shows the weight column", async ({
	page,
}) => {
	const { course, href } = await setup();
	await logInAs(page, course.instructor);

	await page.goto(`${href}/plain`);

	const rows = page.locator("[data-testid=exam-questions] tbody tr");
	await expect(rows).toHaveCount(1);
	await expect(
		page.getByRole("columnheader", { name: /^(Peso|Weight)$/ }),
	).toBeVisible();
	await expect(rows.nth(0).locator("td").nth(2)).toHaveText(/^1[.,]00$/);
});

test("the table reads title and weight from the version the exam pins, not the latest", async ({
	page,
}) => {
	const { course, href } = await setup();
	await db.question.create(
		{
			status: "PUBLISHED",
			version: "1",
			course: course.id,
			slug: "evolving",
			question: {
				...capitalChoice,
				id: "evolving",
				title: "Old title",
				weight: 2,
			},
		},
		FULL_ACCESS,
	);
	await persistedExamFactory.create({
		course: course.id,
		slug: "pinned",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "evolving", version: "1" }],
	});
	await db.question.update(
		{ course: course.id, slug: "evolving" },
		{
			version: "2",
			question: {
				...capitalChoice,
				id: "evolving",
				title: "New title",
				weight: 5,
			},
		},
		FULL_ACCESS,
	);
	await logInAs(page, course.instructor);

	await page.goto(`${href}/pinned`);

	const row = page.locator("[data-testid=exam-questions] tbody tr").nth(0);
	await expect(row).toContainText("Old title");
	await expect(row).not.toContainText("New title");
	await expect(row.locator("td").nth(2)).toHaveText(/^2[.,]00$/);
});

test("average and discrimination appear only once an attempt is closed", async ({
	page,
}) => {
	const { course, student, weighted, href } = await setup();
	await logInAs(page, course.instructor);

	await page.goto(`${href}/weighted`);
	await expect(
		page.getByRole("columnheader", { name: /^(Média|Average)$/ }),
	).toHaveCount(0);

	const response = await db.response.submit(
		{
			course: course.id,
			exam: "weighted",
			question: "heavy",
			payload: null,
		},
		{ actor: student },
	);
	const submission = response.submissions.at(-1);
	await db.feedback.create(
		{
			submission: { publicId: submission?.publicId ?? "" },
			ref: "pass-1",
			score: "1",
			feedback: "ok",
			grader: course.instructor.username,
		},
		FULL_ACCESS,
	);
	await prisma.exam.update({
		where: { id: weighted.id },
		data: { status: "COMPLETED" },
	});

	await page.goto(`${href}/weighted`);

	await expect(
		page.getByRole("columnheader", { name: /^(Média|Average)$/ }),
	).toBeVisible();
	const rows = page.locator("[data-testid=exam-questions] tbody tr");
	await expect(rows.nth(0)).toContainText("100%");
	// One attempt is too few for a discrimination index: the cell says so.
	await expect(rows.nth(0).locator("td").last()).toContainText("—");
});
