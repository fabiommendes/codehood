import { expect, type Locator, type Page, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { scoreValue } from "@/core/schemas/feedback";
import { db, type schema } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { capitalChoice, capitalShortAnswer } from "@/mdq/fixtures";
import { courseHref } from "@/urls";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// The page that grades one question of an exam, and what saving a grade does.

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
	overrides: Partial<Student> = {},
): Promise<Student> {
	const student = await seedUser({ role: "STUDENT", username, ...overrides });
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	return student;
}

/// A published short-answer question titled `title`.
async function shortQuestion(course: Course, slug: string, title: string) {
	await db.question.create(
		{
			course: course.id,
			slug,
			status: "PUBLISHED",
			version: "1",
			question: { ...capitalShortAnswer, id: slug, title },
		},
		FULL_ACCESS,
	);
}

/// A published multiple-choice question titled `title`.
async function choiceQuestion(course: Course, slug: string, title: string) {
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

async function openExam(
	course: Course,
	slug: string,
	title: string,
	questions: string[],
) {
	return persistedExamFactory.create({
		course: course.id,
		slug,
		title,
		type: "EXAM",
		status: "ONGOING",
		questions: questions.map((question) => ({ slug: question })),
	});
}

/// Answers `question` as `student` with a typed `text`; returns the submission's publicId.
async function answer(
	course: Course,
	exam: string,
	student: Student,
	question: string,
	text: string,
	minutes: number,
): Promise<string> {
	const response = await db.response.submit(
		{ course: course.id, exam, question, payload: text },
		{ actor: student },
	);
	const publicId = response.submissions.at(-1)?.publicId ?? "";
	await prisma.submission.update({
		where: { publicId },
		data: { createdAt: new Date(T0.getTime() + minutes * MINUTE) },
	});
	return publicId;
}

async function finish(course: Course, exam: string, student: Student) {
	await db.response.finish({ course: course.id, exam }, { actor: student });
}

async function complete(examId: schema.ExamId) {
	await prisma.exam.update({
		where: { id: examId },
		data: { status: "COMPLETED" },
	});
}

async function grade(teacher: Student, submission: string, score: string) {
	await db.feedback.create(
		{
			submission: { publicId: submission },
			ref: "pass-1",
			score,
			grader: teacher.username,
		},
		FULL_ACCESS,
	);
}

/**
 * A closed exam `midterm` whose only question is a short-answer `q-short`,
 * answered once by each of `texts`' students. Returns the submissions' ids.
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
		await finish(course, exam.slug, student);
	}
	await complete(exam.id);
	return { exam, students, submissions };
}

function answerArticle(page: Page, n: number) {
	return page.getByRole("article", { name: `Answer ${n}`, exact: true });
}

/// The article holding an answer whose text contains `text`.
function articleWith(page: Page, text: string) {
	return page.getByRole("article").filter({ hasText: text });
}

/// Everything an article shows a reader: its text and the values of its fields.
async function shownText(article: Locator): Promise<string> {
	const text = await article.innerText();
	const values = await article
		.locator("input, textarea")
		.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
	return [text, ...values].join("\n");
}

async function expectShows(article: Locator, text: string) {
	await expect.poll(() => shownText(article)).toContain(text);
}

function gradedHeading(page: Page) {
	return page.getByRole("heading", { level: 3, name: "Graded", exact: true });
}

function titleHeading(page: Page, title: string) {
	return page.getByRole("heading", { level: 2, name: title, exact: true });
}

async function passesOn(submission: string) {
	return prisma.feedback.findMany({
		where: { submission: { publicId: submission } },
		orderBy: { id: "asc" },
	});
}

/// Fills the grading form of `article` and saves it.
async function saveGrade(article: Locator, score: string, comment = "") {
	await article.getByLabel("Score (%)", { exact: true }).fill(score);
	await article.getByLabel("Comment", { exact: true }).fill(comment);
	await article.getByRole("button", { name: "Save grade" }).click();
}

//
// R4: the page
//

test("question page: pending answers come first, then Graded, each in submission order, numbered Answer 1 to 5", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("qp1");
	const { submissions } = await closedSitting("qp1", course, [
		"Delta reply",
		"Alpha reply",
		"Bravo reply",
		"Echo reply",
		"Charlie reply",
	]);
	// Submission order is Delta, Alpha, Bravo, Echo, Charlie; the first and the
	// fourth are graded, so they interleave with the pending ones.
	await grade(teacher, submissions[0] ?? "", "0.9");
	await grade(teacher, submissions[3] ?? "", "0.25");
	await logInAs(page, teacher);

	const response = await page.goto(`${href}/exams/midterm/grading/q-short`);

	expect(response?.status()).toBe(200);
	await expect(page).toHaveURL(`${href}/exams/midterm/grading/q-short`);
	await expect(titleHeading(page, "Typed capital")).toBeVisible();
	await expect(page.getByRole("article")).toHaveCount(5);

	const pendingTexts = ["Alpha reply", "Bravo reply", "Charlie reply"];
	for (const [i, text] of pendingTexts.entries()) {
		const article = answerArticle(page, i + 1);
		await expectShows(article, text);
		await expect(
			article.getByLabel("Score (%)", { exact: true }),
		).toBeVisible();
		await expect(article.getByLabel("Comment", { exact: true })).toBeVisible();
		await expect(
			article.getByRole("button", { name: "Save grade" }),
		).toBeVisible();
	}

	const resolved: Array<[string, string]> = [
		["Delta reply", "90%"],
		["Echo reply", "25%"],
	];
	for (const [i, [text, verdict]] of resolved.entries()) {
		const article = answerArticle(page, i + 4);
		await expectShows(article, text);
		await expect(article).toContainText(verdict);
		await expect(
			article.getByRole("button", { name: "Save grade" }),
		).toHaveCount(0);
	}

	await expect(gradedHeading(page)).toHaveCount(1);
	const heading = await gradedHeading(page).boundingBox();
	const lastPending = await answerArticle(page, 3).boundingBox();
	const firstGraded = await answerArticle(page, 4).boundingBox();
	expect(lastPending?.y).toBeLessThan(heading?.y ?? 0);
	expect(heading?.y).toBeLessThan(firstGraded?.y ?? 0);
});

test("question page: a student who submitted twice shows only the newest submission, in one article", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("qp2");
	await shortQuestion(course, "q-short", "Typed capital");
	const exam = await openExam(course, "midterm", "Midterm exam", ["q-short"]);
	const student = await enrolledStudent(course, "qp2-student");
	await answer(course, exam.slug, student, "q-short", "Superseded reply", 1);
	await answer(course, exam.slug, student, "q-short", "Final reply", 2);
	await finish(course, exam.slug, student);
	await complete(exam.id);
	await logInAs(page, teacher);

	await page.goto(`${href}/exams/midterm/grading/q-short`);

	await expect(page).toHaveURL(`${href}/exams/midterm/grading/q-short`);
	await expect(titleHeading(page, "Typed capital")).toBeVisible();
	await expect(page.getByRole("article")).toHaveCount(1);
	await expectShows(answerArticle(page, 1), "Final reply");
	await expect(page.locator("main")).not.toContainText("Superseded reply");
});

test("question page: a question outside the exam gets 404", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("qp3a");
	await shortQuestion(course, "q-in", "In the exam");
	await shortQuestion(course, "q-out", "Not in the exam");
	const exam = await openExam(course, "midterm", "Midterm exam", ["q-in"]);
	await complete(exam.id);
	await logInAs(page, teacher);

	const found = await page.goto(`${href}/exams/midterm/grading/q-in`);
	expect(found?.status()).toBe(200);

	const outside = await page.goto(`${href}/exams/midterm/grading/q-out`);
	expect(outside?.status()).toBe(404);

	const unknown = await page.goto(`${href}/exams/midterm/grading/q-unknown`);
	expect(unknown?.status()).toBe(404);
});

test("question page: a question of the exam nobody answered says there is nothing to grade", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("qp3b");
	await shortQuestion(course, "q-answered", "Answered one");
	await shortQuestion(course, "q-silent", "Silent one");
	const exam = await openExam(course, "midterm", "Midterm exam", [
		"q-answered",
		"q-silent",
	]);
	const student = await enrolledStudent(course, "qp3b-student");
	await answer(course, exam.slug, student, "q-answered", "Some reply", 1);
	await finish(course, exam.slug, student);
	await complete(exam.id);
	await logInAs(page, teacher);

	const response = await page.goto(`${href}/exams/midterm/grading/q-silent`);

	expect(response?.status()).toBe(200);
	await expect(page).toHaveURL(`${href}/exams/midterm/grading/q-silent`);
	await expect(titleHeading(page, "Silent one")).toBeVisible();
	await expect(page.getByText("No answers to grade.")).toBeVisible();
	await expect(page.getByRole("article")).toHaveCount(0);
});

test("question page: the middle question links to both neighbours, the ends to one, and the back-link leads to the queue", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("qp4");
	await shortQuestion(course, "q-one", "First title");
	await shortQuestion(course, "q-two", "Second title");
	await shortQuestion(course, "q-three", "Third title");
	const exam = await openExam(course, "midterm", "Midterm exam", [
		"q-one",
		"q-two",
		"q-three",
	]);
	await complete(exam.id);
	await logInAs(page, teacher);
	const grading = `${href}/exams/midterm/grading`;
	const previous = page.getByRole("link", {
		name: "Previous question",
		exact: true,
	});
	const next = page.getByRole("link", { name: "Next question", exact: true });

	await test.step("the middle question has both", async () => {
		await page.goto(`${grading}/q-two`);

		await expect(page).toHaveURL(`${grading}/q-two`);
		await expect(titleHeading(page, "Second title")).toBeVisible();
		await expect(previous).toHaveAttribute("href", `${grading}/q-one`);
		await expect(next).toHaveAttribute("href", `${grading}/q-three`);
	});

	await test.step("the first has no previous", async () => {
		await page.goto(`${grading}/q-one`);

		await expect(page).toHaveURL(`${grading}/q-one`);
		await expect(titleHeading(page, "First title")).toBeVisible();
		await expect(previous).toHaveCount(0);
		await expect(next).toHaveAttribute("href", `${grading}/q-two`);
	});

	await test.step("the last has no next", async () => {
		await page.goto(`${grading}/q-three`);

		await expect(page).toHaveURL(`${grading}/q-three`);
		await expect(titleHeading(page, "Third title")).toBeVisible();
		await expect(next).toHaveCount(0);
		await expect(previous).toHaveAttribute("href", `${grading}/q-two`);
	});

	await test.step("the back-link leads to the queue", async () => {
		const back = page.getByRole("link", { name: "← Grading", exact: true });
		await expect(back).toHaveAttribute("href", grading);
		await back.click();

		await expect(page).toHaveURL(grading);
		await expect(
			page.getByRole("heading", { level: 2, name: "Grading", exact: true }),
		).toBeVisible();
	});
});

test("question page: a correct answer is shown under a Correct answer heading, for multiple choice and short answer", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("qp5");
	await shortQuestion(course, "q-short", "Typed capital");
	await choiceQuestion(course, "q-choice", "Chosen capital");
	const exam = await openExam(course, "midterm", "Midterm exam", [
		"q-short",
		"q-choice",
	]);
	const student = await enrolledStudent(course, "qp5-student");
	await answer(course, exam.slug, student, "q-short", "Some reply", 1);
	await db.response.submit(
		{
			course: course.id,
			exam: exam.slug,
			question: "q-choice",
			payload: "rio",
		},
		{ actor: student },
	);
	await finish(course, exam.slug, student);
	await complete(exam.id);
	await logInAs(page, teacher);

	for (const [slug, title] of [
		["q-short", "Typed capital"],
		["q-choice", "Chosen capital"],
	] as const) {
		await page.goto(`${href}/exams/midterm/grading/${slug}`);

		await expect(page).toHaveURL(`${href}/exams/midterm/grading/${slug}`);
		await expect(titleHeading(page, title)).toBeVisible();
		await expect(
			page.getByRole("heading", {
				level: 3,
				name: "Correct answer",
				exact: true,
			}),
		).toBeVisible();
		// The key tab's score badge says only that the key is right.
		await expect(page.getByText(/^Score \d/)).toHaveCount(0);
	}
});

test("question page: no student name, username or email appears on the page", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("qp6");
	await shortQuestion(course, "q-short", "Typed capital");
	const exam = await openExam(course, "midterm", "Midterm exam", ["q-short"]);
	const people = [
		{
			username: "zq-quillfeather",
			name: "Zephyrine Quillfeather",
			email: "zq-quillfeather@codehood.test",
			text: "Pending reply",
		},
		{
			username: "yv-marrowbone",
			name: "Yorick Marrowbone",
			email: "yv-marrowbone@codehood.test",
			text: "Graded reply",
		},
	];
	const submissions: string[] = [];
	for (const [i, person] of people.entries()) {
		const student = await enrolledStudent(course, person.username, {
			name: person.name,
			email: person.email,
		});
		submissions.push(
			await answer(course, exam.slug, student, "q-short", person.text, i + 1),
		);
		await finish(course, exam.slug, student);
	}
	await complete(exam.id);
	await grade(teacher, submissions[1] ?? "", "1");
	await logInAs(page, teacher);

	await page.goto(`${href}/exams/midterm/grading/q-short`);

	await expect(page).toHaveURL(`${href}/exams/midterm/grading/q-short`);
	await expect(page.getByRole("article")).toHaveCount(2);
	const main = page.locator("main");
	for (const person of people) {
		await expect(main).not.toContainText(person.username);
		await expect(main).not.toContainText(person.name);
		await expect(main).not.toContainText(person.email);
	}
});

test("question page: a student of the course gets 403", async ({ page }) => {
	const { course, href } = await setup("qp7");
	await closedSitting("qp7", course, ["Some reply"]);
	const student = await enrolledStudent(course, "qp7-other");
	await logInAs(page, student);

	const response = await page.goto(`${href}/exams/midterm/grading/q-short`);

	expect(response?.status()).toBe(403);
});

//
// R6: saving a grade
//

test("saving a grade records one pass by the instructor, moves the answer under Graded and drops the queue's pending count", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("sg1");
	const { submissions } = await closedSitting("sg1", course, [
		"Alpha reply",
		"Bravo reply",
	]);
	await logInAs(page, teacher);
	await page.goto(`${href}/exams/midterm/grading/q-short`);
	await expect(page).toHaveURL(`${href}/exams/midterm/grading/q-short`);
	await expect(titleHeading(page, "Typed capital")).toBeVisible();

	const article = articleWith(page, "Alpha reply");
	await saveGrade(article, "75", "Missing the base case");

	await expect(gradedHeading(page)).toBeVisible();
	await expect(article).toContainText("75%");
	await expect(article).toContainText("Missing the base case");
	await expect(article.getByRole("button", { name: "Save grade" })).toHaveCount(
		0,
	);

	const passes = await passesOn(submissions[0] ?? "");
	expect(passes).toHaveLength(1);
	expect(scoreValue(passes[0]?.score ?? "")).toBe(0.75);
	expect(passes[0]?.feedback).toBe("Missing the base case");
	expect(passes[0]?.graderId).toBe(teacher.username);
	expect(passes[0]?.botId).toBeNull();
	const row = await prisma.submission.findUniqueOrThrow({
		where: { publicId: submissions[0] ?? "" },
	});
	expect(row.status).toBe("GRADED_MANUALLY");
	expect(await passesOn(submissions[1] ?? "")).toHaveLength(0);

	await page.goto(`${href}/exams/midterm/grading`);
	await expect(page).toHaveURL(`${href}/exams/midterm/grading`);
	const item = page
		.getByRole("list", { name: "Questions" })
		.getByRole("listitem")
		.filter({ hasText: "Typed capital" });
	await expect(item).toContainText("1 pending");
	await expect(item).toContainText("1 graded");
});

for (const [label, typed] of [
	["101", "101"],
	["-5", "-5"],
	["7.5", "7.5"],
	["an empty score", ""],
] as const) {
	test(`saving ${label} is refused with an alert, keeps the form and records nothing`, async ({
		page,
	}) => {
		const { teacher, course, href } = await setup(
			`sg2-${label.replace(/\W/g, "") || "x"}`,
		);
		const { submissions } = await closedSitting("sg2", course, ["Alpha reply"]);
		await logInAs(page, teacher);
		await page.goto(`${href}/exams/midterm/grading/q-short`);
		await expect(page).toHaveURL(`${href}/exams/midterm/grading/q-short`);
		await expect(titleHeading(page, "Typed capital")).toBeVisible();

		const article = answerArticle(page, 1);
		await saveGrade(article, typed, "A comment");

		await expect(article.getByRole("alert")).toContainText(INVALID_SCORE);
		await expect(
			article.getByLabel("Score (%)", { exact: true }),
		).toBeVisible();
		await expect(
			article.getByRole("button", { name: "Save grade" }),
		).toBeVisible();
		await expect(gradedHeading(page)).toHaveCount(0);
		expect(await passesOn(submissions[0] ?? "")).toHaveLength(0);
	});
}

test("an invalid score is refused on the client, under the score field, without calling the server", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("sg3");
	await closedSitting("sg3", course, ["Alpha reply"]);
	await logInAs(page, teacher);
	await page.goto(`${href}/exams/midterm/grading/q-short`);
	const article = answerArticle(page, 1);
	const calls: string[] = [];
	await page.route(/\/_actions\/grading\.grade/, (route) => {
		calls.push(route.request().url());
		return route.continue();
	});

	await saveGrade(article, "101");

	const score = article.getByLabel("Score (%)", { exact: true });
	await expect(score).toHaveAttribute("aria-invalid", "true");
	await expect(score).toBeFocused();
	await expect(article.getByRole("alert")).toHaveText(INVALID_SCORE);
	expect(calls).toHaveLength(0);

	await score.fill("80");
	await expect(article.getByRole("alert")).toHaveCount(0);
	await expect(score).not.toHaveAttribute("aria-invalid", "true");
});

test("a score that only the server refuses is shown under the score field", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("sg4");
	const { submissions } = await closedSitting("sg4", course, ["Alpha reply"]);
	await logInAs(page, teacher);
	await page.goto(`${href}/exams/midterm/grading/q-short`);
	const article = answerArticle(page, 1);
	await page.route(/\/_actions\/grading\.grade/, (route) => {
		const body = JSON.parse(route.request().postData() ?? "{}");
		return route.continue({
			postData: JSON.stringify({ ...body, score: "101" }),
		});
	});

	await saveGrade(article, "50");

	const score = article.getByLabel("Score (%)", { exact: true });
	await expect(score).toHaveAttribute("aria-invalid", "true");
	await expect(score).toBeFocused();
	await expect(article.getByRole("alert")).toHaveText(INVALID_SCORE);
	expect(await passesOn(submissions[0] ?? "")).toHaveLength(0);
});

test("a comment of only spaces saves a pass with no feedback", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("sg3");
	const { submissions } = await closedSitting("sg3", course, ["Alpha reply"]);
	await logInAs(page, teacher);
	await page.goto(`${href}/exams/midterm/grading/q-short`);
	await expect(page).toHaveURL(`${href}/exams/midterm/grading/q-short`);
	await expect(titleHeading(page, "Typed capital")).toBeVisible();

	await saveGrade(answerArticle(page, 1), "50", "   ");

	await expect(gradedHeading(page)).toBeVisible();
	await expect(articleWith(page, "Alpha reply")).toContainText("50%");
	const passes = await passesOn(submissions[0] ?? "");
	expect(passes).toHaveLength(1);
	expect(passes[0]?.feedback).toBeNull();
});

test("after saving, the score field of the first remaining pending answer has focus", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("sg4");
	await closedSitting("sg4", course, [
		"Alpha reply",
		"Bravo reply",
		"Charlie reply",
	]);
	await logInAs(page, teacher);
	await page.goto(`${href}/exams/midterm/grading/q-short`);
	await expect(page).toHaveURL(`${href}/exams/midterm/grading/q-short`);
	await expect(titleHeading(page, "Typed capital")).toBeVisible();

	await saveGrade(articleWith(page, "Alpha reply"), "80", "Fine");

	await expect(articleWith(page, "Alpha reply")).toContainText("80%");
	await expect(
		articleWith(page, "Bravo reply").getByLabel("Score (%)", { exact: true }),
	).toBeFocused();
});

test("two tabs grading the same answer both record a pass, and the later one is the verdict", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("sg5");
	const { submissions } = await closedSitting("sg5", course, ["Alpha reply"]);
	await logInAs(page, teacher);
	const url = `${href}/exams/midterm/grading/q-short`;
	const second = await page.context().newPage();

	await page.goto(url);
	await second.goto(url);
	await expect(page).toHaveURL(url);
	await expect(second).toHaveURL(url);
	await expect(titleHeading(page, "Typed capital")).toBeVisible();
	await expect(titleHeading(second, "Typed capital")).toBeVisible();

	await saveGrade(articleWith(page, "Alpha reply"), "40");
	await expect(articleWith(page, "Alpha reply")).toContainText("40%");

	// This tab was loaded before the first save, so the answer still has its form.
	const stale = articleWith(second, "Alpha reply");
	await expect(stale.getByRole("button", { name: "Save grade" })).toBeVisible();
	await saveGrade(stale, "60");
	await expect(articleWith(second, "Alpha reply")).toContainText("60%");

	const scores = (await passesOn(submissions[0] ?? "")).map((p) =>
		scoreValue(p.score),
	);
	expect(scores.sort()).toEqual([0.4, 0.6]);

	await second.reload();
	await expect(titleHeading(second, "Typed capital")).toBeVisible();
	await expect(articleWith(second, "Alpha reply")).toContainText("60%");
});

test("grades stay hidden from the student while the exam's grades are not released", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("sg6");
	const { exam, students } = await closedSitting("sg6", course, [
		"Alpha reply",
		"Bravo reply",
	]);
	expect(
		(await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } }))
			.gradesReleasedAt,
	).toBeNull();
	await logInAs(page, teacher);
	await page.goto(`${href}/exams/midterm/grading/q-short`);
	await expect(page).toHaveURL(`${href}/exams/midterm/grading/q-short`);
	await expect(titleHeading(page, "Typed capital")).toBeVisible();

	await saveGrade(articleWith(page, "Alpha reply"), "80", "Well argued");
	await expect(articleWith(page, "Alpha reply")).toContainText("80%");
	await saveGrade(articleWith(page, "Bravo reply"), "30", "Thin");
	await expect(articleWith(page, "Bravo reply")).toContainText("30%");

	await page.context().clearCookies();
	await logInAs(page, students[0] as Student);
	await page.goto(`${href}/exams/midterm`);

	await expect(page).toHaveURL(`${href}/exams/midterm`);
	await expect(
		page.getByText("Awaiting grading", { exact: true }),
	).toBeVisible();
	await expect(page.getByText(/\d+%/)).toHaveCount(0);
	await expect(page.getByText("Well argued")).toHaveCount(0);
});
