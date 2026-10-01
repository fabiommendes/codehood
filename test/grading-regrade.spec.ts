import { expect, type Locator, type Page, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db, type schema } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { capitalShortAnswer } from "@/mdq/fixtures";
import { courseHref } from "@/urls";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// Changing a grade, and marking an answer will-not-grade.

test.beforeEach(resetDatabase);

const MINUTE = 60_000;

/// Submissions are stamped relative to this, so their order does not depend on how fast the arrange steps ran.
const T0 = new Date("2026-03-10T10:00:00Z");

const INVALID_SCORE = "Score must be a whole number between 0 and 100.";

type Course = Awaited<ReturnType<typeof persistedCourseFactory.create>>;
type Student = Awaited<ReturnType<typeof seedUser>>;

async function setup(prefix: string) {
	const teacher = await seedUser({
		role: "INSTRUCTOR",
		username: `${prefix}-teacher`,
		name: "Professor Ottoline Vex",
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

/// A published short-answer question with its own title and stem.
async function shortQuestion(course: Course, slug: string, title: string) {
	await db.question.create(
		{
			course: course.id,
			slug,
			status: "PUBLISHED",
			version: "1",
			question: {
				...capitalShortAnswer,
				id: slug,
				title,
				stem: `Stem of ${slug}: what is the capital?`,
			},
		},
		FULL_ACCESS,
	);
}

async function answer(
	course: Course,
	exam: string,
	student: Student,
	question: string,
	text: string,
	minutes: number,
): Promise<string> {
	const response = await db.response.submit(
		{ course: course.id, exam, question, payload: { text } },
		{ actor: student },
	);
	const publicId =
		response.submissions.find((s) => s.question === question)?.publicId ?? "";
	await prisma.submission.update({
		where: { publicId },
		data: { createdAt: new Date(T0.getTime() + minutes * MINUTE) },
	});
	return publicId;
}

async function complete(examId: schema.ExamId) {
	await prisma.exam.update({
		where: { id: examId },
		data: { status: "COMPLETED" },
	});
}

async function release(examId: schema.ExamId) {
	await prisma.exam.update({
		where: { id: examId },
		data: { gradesReleasedAt: new Date(Date.now() - 60 * MINUTE) },
	});
}

/**
 * A closed exam `midterm` with the short-answer question `q-short`, answered
 * once by each of `texts`' students. Returns the submissions' ids.
 */
async function closedSitting(prefix: string, course: Course, texts: string[]) {
	await shortQuestion(course, "q-short", "Typed capital");
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "midterm",
		title: "Midterm exam",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "q-short" }],
	});
	const students: Student[] = [];
	const submissions: string[] = [];
	for (const [i, text] of texts.entries()) {
		const student = await enrolledStudent(course, `${prefix}-student-${i + 1}`);
		students.push(student);
		submissions.push(
			await answer(course, exam.slug, student, "q-short", text, i + 1),
		);
		await db.response.finish(
			{ course: course.id, exam: exam.slug },
			{ actor: student },
		);
	}
	await complete(exam.id);
	return { exam, students, submissions };
}

async function gradeByBot(submission: string, score: string) {
	await db.feedback.create(
		{ submission: { publicId: submission }, ref: "bot-1", score, bot: "auto" },
		FULL_ACCESS,
	);
}

async function gradeByTeacher(
	teacher: Student,
	submission: string,
	score: string,
	comment: string | null = null,
) {
	await db.feedback.create(
		{
			submission: { publicId: submission },
			ref: "pass-1",
			score,
			feedback: comment,
			grader: teacher.username,
		},
		FULL_ACCESS,
	);
}

/// Marks an answer will-not-grade, the way the grading page does.
async function markNotGraded(submission: string) {
	await prisma.submission.update({
		where: { publicId: submission },
		data: { status: "WILL_NOT_GRADE" },
	});
}

async function passesOn(submission: string) {
	return prisma.feedback.findMany({
		where: { submission: { publicId: submission } },
		orderBy: { id: "asc" },
	});
}

async function statusOf(submission: string) {
	const row = await prisma.submission.findUniqueOrThrow({
		where: { publicId: submission },
	});
	return row.status;
}

/// The article holding an answer whose text contains `text`.
function articleWith(page: Page, text: string) {
	return page.getByRole("article").filter({ hasText: text });
}

function history(article: Locator) {
	return article
		.getByRole("list", { name: "Grading history" })
		.getByRole("listitem");
}

function titleHeading(page: Page, title: string) {
	return page.getByRole("heading", { level: 2, name: title, exact: true });
}

function gradedHeading(page: Page) {
	return page.getByRole("heading", { level: 3, name: "Graded", exact: true });
}

async function openQuestion(page: Page, href: string) {
	const url = `${href}/exams/midterm/grading/q-short`;
	await page.goto(url);
	await expect(page).toHaveURL(url);
	await expect(titleHeading(page, "Typed capital")).toBeVisible();
}

async function fillForm(article: Locator, score: string, comment = "") {
	await article.getByLabel("Score (%)", { exact: true }).fill(score);
	await article.getByLabel("Comment", { exact: true }).fill(comment);
}

/// Presses Will not grade on `article`, types `comment` and confirms.
async function markWillNotGrade(page: Page, article: Locator, comment: string) {
	await article.getByRole("button", { name: "Will not grade" }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByText("Will not grade this answer?")).toBeVisible();
	if (comment) {
		await dialog.getByLabel("Comment for the student").fill(comment);
	}
	await dialog.getByRole("button", { name: "Mark as not graded" }).click();
	await expect(dialog).toBeHidden();
}

//
// R7: changing a grade
//

test("changing a bot's grade appends a manual pass: verdict, history and status all move", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("rg1");
	const { submissions } = await closedSitting("rg1", course, ["Alpha reply"]);
	await gradeByBot(submissions[0] ?? "", "0");
	await logInAs(page, teacher);
	await openQuestion(page, href);
	const article = articleWith(page, "Alpha reply");

	await test.step("the graded answer shows the bot's verdict and history", async () => {
		await expect(article).toContainText("0%");
		await expect(history(article)).toHaveCount(1);
		await expect(history(article).nth(0)).toContainText("Graded automatically");
		await expect(history(article).nth(0)).toContainText("0%");
		await expect(
			article.getByRole("button", { name: "Change grade" }),
		).toBeVisible();
	});

	await test.step("the instructor changes the grade with a comment", async () => {
		await article.getByRole("button", { name: "Change grade" }).click();
		await fillForm(article, "50", "Accepting the alternative spelling");
		await article.getByRole("button", { name: "Save grade" }).click();

		await expect(history(article)).toHaveCount(2);
		await expect(article).toContainText("50%");
		await expect(history(article).nth(0)).toContainText("50%");
		await expect(history(article).nth(0)).toContainText(
			"Professor Ottoline Vex",
		);
		await expect(history(article).nth(0)).toContainText(
			"Accepting the alternative spelling",
		);
		await expect(history(article).nth(0)).not.toContainText(
			"Graded automatically",
		);
		await expect(history(article).nth(1)).toContainText("0%");
		await expect(history(article).nth(1)).toContainText("Graded automatically");
	});

	await test.step("both passes are stored and the submission is graded manually", async () => {
		const passes = await passesOn(submissions[0] ?? "");
		expect(passes.map((p) => p.score).sort()).toEqual(["0", "0.5"]);
		expect(await statusOf(submissions[0] ?? "")).toBe("GRADED_MANUALLY");
	});
});

test("cancelling a grade change hides the form and writes nothing", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("rg2");
	const { submissions } = await closedSitting("rg2", course, ["Alpha reply"]);
	await gradeByBot(submissions[0] ?? "", "0");
	await logInAs(page, teacher);
	await openQuestion(page, href);
	const article = articleWith(page, "Alpha reply");
	await expect(article.getByRole("button", { name: "Save grade" })).toHaveCount(
		0,
	);

	await article.getByRole("button", { name: "Change grade" }).click();
	await expect(
		article.getByRole("button", { name: "Save grade" }),
	).toBeVisible();
	await fillForm(article, "90", "Second thoughts");
	await article.getByRole("button", { name: "Cancel" }).click();

	await expect(article.getByRole("button", { name: "Save grade" })).toHaveCount(
		0,
	);
	await expect(article.getByLabel("Score (%)", { exact: true })).toHaveCount(0);
	await expect(
		article.getByRole("button", { name: "Change grade" }),
	).toBeVisible();
	await expect(history(article)).toHaveCount(1);
	expect(await passesOn(submissions[0] ?? "")).toHaveLength(1);
	expect(await statusOf(submissions[0] ?? "")).toBe("GRADED_AUTOMATICALLY");
});

test("an invalid score in the change form shows the alert and writes nothing", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("rg3");
	const { submissions } = await closedSitting("rg3", course, ["Alpha reply"]);
	await gradeByBot(submissions[0] ?? "", "0");
	await logInAs(page, teacher);
	await openQuestion(page, href);
	const article = articleWith(page, "Alpha reply");

	await article.getByRole("button", { name: "Change grade" }).click();
	await fillForm(article, "101", "Too generous");
	await article.getByRole("button", { name: "Save grade" }).click();

	await expect(article.getByRole("alert")).toContainText(INVALID_SCORE);
	await expect(
		article.getByRole("button", { name: "Save grade" }),
	).toBeVisible();
	expect(await passesOn(submissions[0] ?? "")).toHaveLength(1);
	expect(await statusOf(submissions[0] ?? "")).toBe("GRADED_AUTOMATICALLY");
});

test("after grades are released, a changed grade and its comment show on the student's exam page", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("rg4");
	const { exam, students, submissions } = await closedSitting("rg4", course, [
		"Alpha reply",
	]);
	await gradeByTeacher(teacher, submissions[0] ?? "", "1");
	await release(exam.id);
	await logInAs(page, teacher);
	await openQuestion(page, href);
	const article = articleWith(page, "Alpha reply");

	await article.getByRole("button", { name: "Change grade" }).click();
	await fillForm(article, "80", "Reconsidered after review");
	await article.getByRole("button", { name: "Save grade" }).click();
	await expect(history(article)).toHaveCount(2);
	await expect(history(article).nth(0)).toContainText("80%");

	await page.context().clearCookies();
	await logInAs(page, students[0] as Student);
	await page.goto(`${href}/exams/midterm`);

	await expect(page).toHaveURL(`${href}/exams/midterm`);
	await expect(page.getByText("80%").first()).toBeVisible();
	await expect(page.getByText("Reconsidered after review")).toBeVisible();
	await expect(page.getByText("100%")).toHaveCount(0);
});

//
// R9: will not grade
//

test("marking a pending answer will-not-grade moves it under Graded as Not graded and updates the queue", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("wg1");
	const { submissions } = await closedSitting("wg1", course, [
		"Alpha reply",
		"Bravo reply",
	]);
	await logInAs(page, teacher);
	await openQuestion(page, href);
	const article = articleWith(page, "Alpha reply");

	await markWillNotGrade(page, article, "Submitted empty");

	await expect(gradedHeading(page)).toBeVisible();
	await expect(article).toContainText("Not graded");
	await expect(article).toContainText("Submitted empty");
	await expect(
		article.getByRole("button", { name: "Will not grade" }),
	).toHaveCount(0);
	expect(await statusOf(submissions[0] ?? "")).toBe("WILL_NOT_GRADE");
	expect(await statusOf(submissions[1] ?? "")).toBe("PENDING_GRADE");

	await page.getByRole("link", { name: "← Grading", exact: true }).click();
	await expect(page).toHaveURL(`${href}/exams/midterm/grading`);
	const item = page
		.getByRole("list", { name: "Questions" })
		.getByRole("listitem")
		.filter({ hasText: "Typed capital" });
	await expect(item).toContainText("1 not graded");
	await expect(item).toContainText("1 pending");
});

test("cancelling the will-not-grade dialog writes nothing", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("wg2");
	const { submissions } = await closedSitting("wg2", course, ["Alpha reply"]);
	await logInAs(page, teacher);
	await openQuestion(page, href);
	const article = articleWith(page, "Alpha reply");

	await article.getByRole("button", { name: "Will not grade" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Comment for the student").fill("Never sent");
	await dialog.getByRole("button", { name: "Cancel" }).click();

	await expect(dialog).toBeHidden();
	await expect(
		article.getByRole("button", { name: "Save grade" }),
	).toBeVisible();
	await expect(gradedHeading(page)).toHaveCount(0);
	expect(await statusOf(submissions[0] ?? "")).toBe("PENDING_GRADE");
	expect(await passesOn(submissions[0] ?? "")).toHaveLength(0);
});

test("marking will-not-grade with an empty comment works and records no pass", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("wg3");
	const { submissions } = await closedSitting("wg3", course, ["Alpha reply"]);
	await logInAs(page, teacher);
	await openQuestion(page, href);
	const article = articleWith(page, "Alpha reply");

	await markWillNotGrade(page, article, "");

	await expect(article).toContainText("Not graded");
	expect(await statusOf(submissions[0] ?? "")).toBe("WILL_NOT_GRADE");
	expect(await passesOn(submissions[0] ?? "")).toHaveLength(0);
});

test("a graded answer can be marked will-not-grade, and its earlier passes stay", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("wg4");
	const { submissions } = await closedSitting("wg4", course, ["Alpha reply"]);
	await gradeByTeacher(teacher, submissions[0] ?? "", "1", "First look");
	await logInAs(page, teacher);
	await openQuestion(page, href);
	const article = articleWith(page, "Alpha reply");

	await markWillNotGrade(page, article, "Copied from a classmate");

	await expect(article).toContainText("Not graded");
	expect(await statusOf(submissions[0] ?? "")).toBe("WILL_NOT_GRADE");
	const passes = await passesOn(submissions[0] ?? "");
	const first = passes.find((p) => p.feedback === "First look");
	expect(first?.score).toBe("1");

	// The history tells the pass that carries the comment from a grade of zero.
	const entries = history(article);
	await expect(
		entries.filter({ hasText: "Copied from a classmate" }),
	).toContainText("Not graded");
	await expect(
		entries.filter({ hasText: "Copied from a classmate" }),
	).not.toContainText("0%");
	await expect(entries.filter({ hasText: "First look" })).toContainText("100%");
});

test("a will-not-grade answer has no Will not grade button, and Change grade makes it graded again", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("wg5");
	const { submissions } = await closedSitting("wg5", course, ["Alpha reply"]);
	await markNotGraded(submissions[0] ?? "");
	await logInAs(page, teacher);
	await openQuestion(page, href);
	const article = articleWith(page, "Alpha reply");

	await expect(article).toContainText("Not graded");
	await expect(
		article.getByRole("button", { name: "Will not grade" }),
	).toHaveCount(0);

	await article.getByRole("button", { name: "Change grade" }).click();
	await fillForm(article, "40", "Late but valid");
	await article.getByRole("button", { name: "Save grade" }).click();

	await expect(article).toContainText("40%");
	await expect(history(article).nth(0)).toContainText("40%");
	expect(await statusOf(submissions[0] ?? "")).toBe("GRADED_MANUALLY");
});

test("a student reads Not graded, with the comment, where a graded question reads its percentage, and the total counts it as zero", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("wg6");
	for (const [slug, title] of [
		["q-one", "One"],
		["q-two", "Two"],
		["q-three", "Three"],
	]) {
		await shortQuestion(course, slug ?? "", title ?? "");
	}
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "midterm",
		title: "Midterm exam",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "q-one" }, { slug: "q-two" }, { slug: "q-three" }],
	});
	const student = await enrolledStudent(course, "wg6-student");
	const ids: string[] = [];
	for (const [i, slug] of ["q-one", "q-two", "q-three"].entries()) {
		ids.push(
			await answer(course, exam.slug, student, slug, `Reply ${i + 1}`, i + 1),
		);
	}
	await db.response.finish(
		{ course: course.id, exam: exam.slug },
		{ actor: student },
	);
	await complete(exam.id);
	await gradeByTeacher(teacher, ids[0] ?? "", "1");
	await db.feedback.create(
		{
			submission: { publicId: ids[1] ?? "" },
			ref: "pass-2",
			score: "1",
			grader: teacher.username,
		},
		FULL_ACCESS,
	);
	await db.feedback.create(
		{
			submission: { publicId: ids[2] ?? "" },
			ref: "pass-3",
			score: "0",
			feedback: "Submitted empty",
			grader: teacher.username,
		},
		FULL_ACCESS,
	);
	await markNotGraded(ids[2] ?? "");
	await release(exam.id);
	await logInAs(page, student);

	await page.goto(`${href}/exams/midterm`);

	await expect(page).toHaveURL(`${href}/exams/midterm`);
	await expect(page.getByText(/Your score.*67%/)).toBeVisible();
	const block = (stem: string) =>
		page
			.locator("div")
			.filter({ has: page.getByText(stem) })
			.filter({ has: page.getByText(/^(Not graded|100%)$/) })
			.last();
	await expect(block("Stem of q-one")).toContainText("100%");
	await expect(block("Stem of q-two")).toContainText("100%");
	const third = block("Stem of q-three");
	await expect(third.getByText("Not graded", { exact: true })).toBeVisible();
	await expect(third).toContainText("Submitted empty");
	await expect(third).not.toContainText("Waiting to be graded");
	await expect(third).not.toContainText(/(^|\D)0%/);
	await expect(page.getByText("Waiting to be graded")).toHaveCount(0);
});

//
// Releasing with will-not-grade answers
//

test("the instructor's exam page offers Release results once every answer is graded or will-not-grade", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("wg7");
	const { submissions } = await closedSitting("wg7", course, [
		"Alpha reply",
		"Bravo reply",
	]);
	await gradeByTeacher(teacher, submissions[0] ?? "", "1");
	await markNotGraded(submissions[1] ?? "");
	await logInAs(page, teacher);

	await page.goto(`${href}/exams/midterm`);

	await expect(page).toHaveURL(`${href}/exams/midterm`);
	await expect(
		page.getByRole("button", { name: "Release results" }),
	).toBeVisible();
});

test("the instructor's exam page does not offer Release results while an answer is pending", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("wg8");
	const { submissions } = await closedSitting("wg8", course, [
		"Alpha reply",
		"Bravo reply",
		"Charlie reply",
	]);
	await gradeByTeacher(teacher, submissions[0] ?? "", "1");
	await markNotGraded(submissions[1] ?? "");
	await logInAs(page, teacher);

	await page.goto(`${href}/exams/midterm`);

	await expect(page).toHaveURL(`${href}/exams/midterm`);
	await expect(
		page.getByRole("heading", { name: "Midterm exam" }).first(),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Release results" }),
	).toHaveCount(0);
});
