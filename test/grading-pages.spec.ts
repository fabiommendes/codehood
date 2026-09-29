import { expect, type Page, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db, type schema } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { capitalChoice } from "@/mdq/fixtures";
import { courseHref } from "@/urls";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// Page-level checks of the grading queue, its access rules, and the
// instructor home entry that leads to it.

test.beforeEach(resetDatabase);

type Course = Awaited<ReturnType<typeof persistedCourseFactory.create>>;
type Student = Awaited<ReturnType<typeof seedUser>>;

/// A course taught by a fresh instructor, and the URL prefix of the course.
async function setup(prefix: string) {
	const teacher = await seedUser({
		role: "INSTRUCTOR",
		username: `${prefix}-teacher`,
	});
	const course = await persistedCourseFactory.create({
		instructor: teacher.username,
	});
	return { teacher, course, href: hrefOf(course) };
}

function hrefOf(course: Course) {
	return courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
}

async function enrolledStudent(
	course: Course,
	username: string,
): Promise<Student> {
	const student = await seedUser({ role: "STUDENT", username });
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	return student;
}

/// A published multiple-choice question whose title is `title`.
async function question(course: Course, slug: string, title: string) {
	await db.question.create(
		{
			course: course.id,
			slug,
			status: "PUBLISHED",
			version: "1",
			question: { ...capitalChoice, id: slug, title },
		},
		FULL_ACCESS,
	);
}

/**
 * Answers every question in `questions` as `student`, closing the attempt when
 * `finish` is set; returns the submissions' publicIds by question slug.
 */
async function attempt(
	course: Course,
	exam: string,
	student: Student,
	questions: string[],
	finish: boolean,
): Promise<Record<string, string>> {
	const ids: Record<string, string> = {};
	for (const slug of questions) {
		const response = await db.response.submit(
			{
				course: course.id,
				exam,
				question: slug,
				payload: { choice: "brasilia" },
			},
			{ actor: student },
		);
		ids[slug] = response.submissions.at(-1)?.publicId ?? "";
	}
	if (finish) {
		await db.response.finish({ course: course.id, exam }, { actor: student });
	}
	return ids;
}

/// Closes the exam the way an instructor does once the work is in.
async function complete(examId: schema.ExamId) {
	await prisma.exam.update({
		where: { id: examId },
		data: { status: "COMPLETED" },
	});
}

async function grade(teacher: Student, submission: string) {
	await db.feedback.create(
		{
			submission: { publicId: submission },
			ref: "pass-1",
			score: "1",
			grader: teacher.username,
		},
		FULL_ACCESS,
	);
}

/// The `<section>` wrapping the heading `title`.
function section(page: Page, title: string) {
	return page.locator("section").filter({
		has: page.getByRole("heading", { name: title, exact: true }),
	});
}

//
// Access
//

test("grading queue: a student of the course gets 403", async ({ page }) => {
	const { course, href } = await setup("acc1");
	await question(course, "q1", "First question");
	await persistedExamFactory.create({
		course: course.id,
		slug: "midterm",
		status: "ONGOING",
		questions: [{ slug: "q1" }],
	});
	const student = await enrolledStudent(course, "acc1-student");
	await logInAs(page, student);

	const response = await page.goto(`${href}/exams/midterm/grading`);

	expect(response?.status()).toBe(403);
});

test("grading queue: an admin who does not teach the course gets 403", async ({
	page,
}) => {
	const { course, href } = await setup("acc2");
	await question(course, "q1", "First question");
	await persistedExamFactory.create({
		course: course.id,
		slug: "midterm",
		status: "ONGOING",
		questions: [{ slug: "q1" }],
	});
	const admin = await seedUser({ role: "ADMIN", username: "acc2-admin" });
	await logInAs(page, admin);

	const response = await page.goto(`${href}/exams/midterm/grading`);

	expect(response?.status()).toBe(403);
});

test("grading queue: a student asking for an exam that does not exist gets 403, not 404", async ({
	page,
}) => {
	const { course, href } = await setup("acc3");
	const student = await enrolledStudent(course, "acc3-student");
	await logInAs(page, student);

	const response = await page.goto(`${href}/exams/no-such-exam/grading`);

	expect(response?.status()).toBe(403);
});

test("grading queue: an anonymous visitor is redirected to the login page", async ({
	page,
}) => {
	const { course, href } = await setup("acc4");
	await question(course, "q1", "First question");
	await persistedExamFactory.create({
		course: course.id,
		slug: "midterm",
		status: "ONGOING",
		questions: [{ slug: "q1" }],
	});

	await page.goto(`${href}/exams/midterm/grading`);

	await expect(page).toHaveURL(/\/login/);
	await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
});

test("grading queue: the instructor opening an exam that does not exist gets 404, while an existing one opens", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("acc5");
	await question(course, "q1", "First question");
	await persistedExamFactory.create({
		course: course.id,
		slug: "midterm",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "q1" }],
	});
	await logInAs(page, teacher);

	const found = await page.goto(`${href}/exams/midterm/grading`);
	expect(found?.status()).toBe(200);

	const missing = await page.goto(`${href}/exams/no-such-exam/grading`);
	expect(missing?.status()).toBe(404);
});

test("grading queue: the instructor opening a practice exam gets 404, while a graded exam opens", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("acc6");
	await question(course, "q1", "First question");
	await persistedExamFactory.create({
		course: course.id,
		slug: "drill",
		type: "PRACTICE",
		status: "ONGOING",
		questions: [{ slug: "q1" }],
	});
	await persistedExamFactory.create({
		course: course.id,
		slug: "midterm",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "q1" }],
	});
	await logInAs(page, teacher);

	const found = await page.goto(`${href}/exams/midterm/grading`);
	expect(found?.status()).toBe(200);

	const practice = await page.goto(`${href}/exams/drill/grading`);
	expect(practice?.status()).toBe(404);
});

//
// Queue
//

test("grading queue: lists the questions in exam order with their counts and links", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("queue1");
	// An exam keeps its questions in the order they were created in the
	// course, so they are created in exam order, which is not the
	// alphabetical order of their slugs or titles.
	await question(course, "q-mc", "Choice prompt");
	await question(course, "q-none", "Unanswered prompt");
	await question(course, "q-essay", "Essay prompt");
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "midterm",
		title: "Midterm exam",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "q-mc" }, { slug: "q-none" }, { slug: "q-essay" }],
	});
	for (let i = 1; i <= 4; i++) {
		const student = await enrolledStudent(course, `queue1-student-${i}`);
		const ids = await attempt(
			course,
			exam.slug,
			student,
			["q-essay", "q-mc"],
			true,
		);
		await grade(teacher, ids["q-mc"] ?? "");
	}
	await complete(exam.id);
	await logInAs(page, teacher);

	const response = await page.goto(`${href}/exams/midterm/grading`);

	expect(response?.status()).toBe(200);
	await expect(page).toHaveURL(`${href}/exams/midterm/grading`);
	await expect(
		page.getByRole("heading", { level: 2, name: "Grading", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("link", { name: "← Midterm exam", exact: true }),
	).toHaveAttribute("href", `${href}/exams/midterm`);

	const items = page
		.getByRole("list", { name: "Questions" })
		.getByRole("listitem");
	await expect(items).toHaveCount(3);

	const [choice, unanswered, essay] = [
		items.nth(0),
		items.nth(1),
		items.nth(2),
	];

	await expect(
		choice.getByRole("link", { name: "Choice prompt", exact: true }),
	).toHaveAttribute("href", `${href}/exams/midterm/grading/q-mc`);
	await expect(choice).toContainText("Multiple choice");
	await expect(choice).toContainText("4 graded");
	await expect(choice).not.toContainText("pending");

	await expect(
		unanswered.getByRole("link", { name: "Unanswered prompt", exact: true }),
	).toHaveAttribute("href", `${href}/exams/midterm/grading/q-none`);
	await expect(unanswered).toContainText("No answers");
	await expect(unanswered).not.toContainText("pending");
	await expect(unanswered).not.toContainText("graded");

	await expect(
		essay.getByRole("link", { name: "Essay prompt", exact: true }),
	).toHaveAttribute("href", `${href}/exams/midterm/grading/q-essay`);
	await expect(essay).toContainText("4 pending");
	await expect(essay).not.toContainText("graded");
	await expect(essay).not.toContainText("No answers");

	await expect(page.getByText("Nothing left to grade.")).toHaveCount(0);
});

test("grading queue: with every answer graded or marked will-not-grade it says nothing is left, and the back-link leads to the exam", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("queue2");
	await question(course, "q-a", "Alpha prompt");
	await question(course, "q-b", "Beta prompt");
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "final",
		title: "Final exam",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "q-a" }, { slug: "q-b" }],
	});
	const ana = await enrolledStudent(course, "queue2-ana");
	const bia = await enrolledStudent(course, "queue2-bia");
	const anaIds = await attempt(course, exam.slug, ana, ["q-a", "q-b"], true);
	const biaIds = await attempt(course, exam.slug, bia, ["q-a", "q-b"], true);
	await grade(teacher, anaIds["q-a"] ?? "");
	await grade(teacher, biaIds["q-a"] ?? "");
	await grade(teacher, anaIds["q-b"] ?? "");
	await prisma.submission.update({
		where: { publicId: biaIds["q-b"] ?? "" },
		data: { status: "WILL_NOT_GRADE" },
	});
	await complete(exam.id);
	await logInAs(page, teacher);

	await page.goto(`${href}/exams/final/grading`);

	await expect(page).toHaveURL(`${href}/exams/final/grading`);
	await expect(
		page.getByRole("heading", { level: 2, name: "Grading", exact: true }),
	).toBeVisible();
	await expect(page.getByText("Nothing left to grade.")).toBeVisible();
	await expect(
		page.getByRole("link", { name: "← Final exam", exact: true }),
	).toHaveAttribute("href", `${href}/exams/final`);

	const items = page
		.getByRole("list", { name: "Questions" })
		.getByRole("listitem");
	await expect(items).toHaveCount(2);
	await expect(items.nth(0)).toContainText("2 graded");
	await expect(items.nth(1)).toContainText("1 graded");
	await expect(items.nth(1)).toContainText("1 not graded");
});

test("grading queue: answers of an attempt still in progress are counted nowhere", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("queue3");
	await question(course, "q-a", "Alpha prompt");
	await question(course, "q-b", "Beta prompt");
	await persistedExamFactory.create({
		course: course.id,
		slug: "midterm",
		title: "Midterm exam",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "q-a" }, { slug: "q-b" }],
	});
	const student = await enrolledStudent(course, "queue3-student");
	await attempt(course, "midterm", student, ["q-a", "q-b"], false);
	await logInAs(page, teacher);

	await page.goto(`${href}/exams/midterm/grading`);

	await expect(page).toHaveURL(`${href}/exams/midterm/grading`);
	await expect(
		page.getByRole("heading", { level: 2, name: "Grading", exact: true }),
	).toBeVisible();
	const items = page
		.getByRole("list", { name: "Questions" })
		.getByRole("listitem");
	await expect(items).toHaveCount(2);
	await expect(items.nth(0)).toContainText("No answers");
	await expect(items.nth(1)).toContainText("No answers");
	await expect(page.getByText("Nothing left to grade.")).toHaveCount(0);
});

test("grading queue: a finished attempt is counted and one still in progress is not, side by side", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("queue4");
	await question(course, "q-a", "Alpha prompt");
	await persistedExamFactory.create({
		course: course.id,
		slug: "midterm",
		title: "Midterm exam",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "q-a" }],
	});
	const done = await enrolledStudent(course, "queue4-done");
	const running = await enrolledStudent(course, "queue4-running");
	await attempt(course, "midterm", done, ["q-a"], true);
	await attempt(course, "midterm", running, ["q-a"], false);
	await logInAs(page, teacher);

	await page.goto(`${href}/exams/midterm/grading`);

	await expect(page).toHaveURL(`${href}/exams/midterm/grading`);
	const items = page
		.getByRole("list", { name: "Questions" })
		.getByRole("listitem");
	await expect(items).toHaveCount(1);
	await expect(items.nth(0)).toContainText("1 pending");
	await expect(items.nth(0)).not.toContainText("2 pending");
});

//
// Home
//

test("instructor home: a to-grade item reads the count and links to the exam's grading queue", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("home1");
	await question(course, "q-a", "Alpha prompt");
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "midterm",
		title: "Midterm exam",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "q-a" }],
	});
	for (let i = 1; i <= 3; i++) {
		const student = await enrolledStudent(course, `home1-student-${i}`);
		await attempt(course, exam.slug, student, ["q-a"], true);
	}
	await complete(exam.id);
	await logInAs(page, teacher);

	await page.goto("/");

	await expect(page).toHaveURL("/");
	await expect(
		page.getByRole("heading", { name: "To grade", exact: true }),
	).toBeVisible();
	const item = section(page, "To grade")
		.getByRole("link")
		.filter({ hasText: "Midterm exam" });
	await expect(item).toContainText("3 answers to grade");
	await expect(item).toHaveAttribute("href", `${href}/exams/midterm/grading`);
});
