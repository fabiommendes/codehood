import { expect, type Locator, type Page, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db, type schema } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { capitalShortAnswer } from "@/mdq/fixtures";
import { courseHref } from "@/urls";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// One student's attempt as the instructor reads it, and the names switch on the grading page.

test.beforeEach(resetDatabase);

const MINUTE = 60_000;

const T0 = new Date("2026-03-10T10:00:00Z");

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
	name: string,
): Promise<Student> {
	const student = await seedUser({
		role: "STUDENT",
		username,
		name,
		email: `${username}@codehood.test`,
	});
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	return student;
}

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

/// Creates `q-one`, `q-two` and `q-three` in that order, and an exam `midterm` holding them.
async function threeQuestionExam(course: Course) {
	await shortQuestion(course, "q-one", "Title one");
	await shortQuestion(course, "q-two", "Title two");
	await shortQuestion(course, "q-three", "Title three");
	return persistedExamFactory.create({
		course: course.id,
		slug: "midterm",
		title: "Midterm exam",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "q-one" }, { slug: "q-two" }, { slug: "q-three" }],
	});
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
		{ course: course.id, exam, question, payload: text },
		{ actor: student },
	);
	const publicId =
		response.submissions.find(
			(s) => s.question === question && s.payload === text,
		)?.publicId ?? "";
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

async function grade(
	submission: string,
	score: string,
	feedback: string | null = null,
) {
	await db.feedback.create(
		{
			submission: { publicId: submission },
			ref: `pass-${Math.random().toString(36).slice(2, 8)}`,
			score,
			feedback,
			bot: "auto",
		},
		FULL_ACCESS,
	);
}

async function markNotGraded(submission: string) {
	await prisma.submission.update({
		where: { publicId: submission },
		data: { status: "WILL_NOT_GRADE" },
	});
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

function questionArticle(page: Page, n: number) {
	return page.getByRole("article", { name: `Question ${n}`, exact: true });
}

function titleHeading(page: Page, title: string, level: 2 | 3 = 2) {
	return page.getByRole("heading", { level, name: title, exact: true });
}

/// The value next to the term `term` of the attempt's description list.
function detail(page: Page, term: string) {
	return page
		.getByRole("term")
		.filter({ hasText: term })
		.locator("xpath=following-sibling::dd[1]");
}

//
// R8: one attempt
//

test("attempt page: shows the student's name, one article per question, and Not answered for a skipped one", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("at1");
	const exam = await threeQuestionExam(course);
	const ana = await enrolledStudent(course, "at1-ana", "Ana Prado");
	await answer(course, exam.slug, ana, "q-one", "First reply", 1);
	await answer(course, exam.slug, ana, "q-two", "Second reply", 2);
	await finish(course, exam.slug, ana);
	await complete(exam.id);
	await logInAs(page, teacher);

	const response = await page.goto(`${href}/exams/midterm/attempts/at1-ana`);

	expect(response?.status()).toBe(200);
	await expect(page).toHaveURL(`${href}/exams/midterm/attempts/at1-ana`);
	await expect(titleHeading(page, "Ana Prado")).toBeVisible();
	await expect(
		page.getByRole("link", { name: "← Midterm exam", exact: true }),
	).toHaveAttribute("href", `${href}/exams/midterm`);
	await expect(page.getByRole("article")).toHaveCount(3);
	for (const [n, title] of [
		[1, "Title one"],
		[2, "Title two"],
		[3, "Title three"],
	] as const) {
		await expect(titleHeading(page, title, 3)).toBeVisible();
		await expect(
			questionArticle(page, n).getByRole("heading", {
				level: 3,
				name: title,
				exact: true,
			}),
		).toBeVisible();
	}
	await expectShows(questionArticle(page, 1), "First reply");
	await expectShows(questionArticle(page, 2), "Second reply");
	await expect(questionArticle(page, 3)).toContainText("Not answered");
	await expect(questionArticle(page, 1)).not.toContainText("Not answered");
	await expect(questionArticle(page, 2)).not.toContainText("Not answered");
});

test("attempt page: each answer shows its state, and the total waits while one is pending", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("at2");
	const exam = await threeQuestionExam(course);
	const ana = await enrolledStudent(course, "at2-ana", "Ana Prado");
	const graded = await answer(
		course,
		exam.slug,
		ana,
		"q-one",
		"First reply",
		1,
	);
	const pending = await answer(
		course,
		exam.slug,
		ana,
		"q-two",
		"Second reply",
		2,
	);
	const skipped = await answer(
		course,
		exam.slug,
		ana,
		"q-three",
		"Third reply",
		3,
	);
	await finish(course, exam.slug, ana);
	await complete(exam.id);
	await grade(graded, "0.75", "Well argued");
	await markNotGraded(skipped);
	await logInAs(page, teacher);
	const url = `${href}/exams/midterm/attempts/at2-ana`;

	await page.goto(url);

	await expect(page).toHaveURL(url);
	await expect(titleHeading(page, "Ana Prado")).toBeVisible();
	await expect(questionArticle(page, 1)).toContainText("75%");
	await expect(questionArticle(page, 1)).toContainText("Well argued");
	await expect(questionArticle(page, 2)).toContainText("Waiting to be graded");
	await expect(questionArticle(page, 3)).toContainText("Not graded");
	await expect(
		page.getByRole("term").filter({ hasText: "Total" }),
	).toBeVisible();
	await expect(detail(page, "Total")).toHaveText("Pending");

	await grade(pending, "3/4");
	await page.reload();

	await expect(titleHeading(page, "Ana Prado")).toBeVisible();
	await expect(questionArticle(page, 2)).not.toContainText(
		"Waiting to be graded",
	);
	await expect(detail(page, "Total")).toHaveText("50%");
});

test("attempt page: an unknown exam or username, and a student with no attempt, get 404", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("at3");
	const exam = await threeQuestionExam(course);
	const ana = await enrolledStudent(course, "at3-ana", "Ana Prado");
	await enrolledStudent(course, "at3-idle", "Idle Student");
	await answer(course, exam.slug, ana, "q-one", "First reply", 1);
	await finish(course, exam.slug, ana);
	await complete(exam.id);
	await logInAs(page, teacher);

	const found = await page.goto(`${href}/exams/midterm/attempts/at3-ana`);
	expect(found?.status()).toBe(200);

	const idle = await page.goto(`${href}/exams/midterm/attempts/at3-idle`);
	expect(idle?.status()).toBe(404);

	const unknownUser = await page.goto(
		`${href}/exams/midterm/attempts/at3-nobody`,
	);
	expect(unknownUser?.status()).toBe(404);

	const unknownExam = await page.goto(
		`${href}/exams/no-such-exam/attempts/at3-ana`,
	);
	expect(unknownExam?.status()).toBe(404);
});

test("attempt page: a student of the course, even the author, gets 403, and an anonymous visitor goes to the login page", async ({
	page,
}) => {
	const { course, href } = await setup("at4");
	const exam = await threeQuestionExam(course);
	const ana = await enrolledStudent(course, "at4-ana", "Ana Prado");
	const bia = await enrolledStudent(course, "at4-bia", "Bia Lima");
	await answer(course, exam.slug, ana, "q-one", "First reply", 1);
	await finish(course, exam.slug, ana);
	await complete(exam.id);
	const url = `${href}/exams/midterm/attempts/at4-ana`;

	await test.step("the author", async () => {
		await logInAs(page, ana);
		const response = await page.goto(url);
		expect(response?.status()).toBe(403);
	});

	await test.step("another student", async () => {
		await page.context().clearCookies();
		await logInAs(page, bia);
		const response = await page.goto(url);
		expect(response?.status()).toBe(403);
	});

	await test.step("an anonymous visitor", async () => {
		await page.context().clearCookies();
		await page.goto(url);

		await expect(page).toHaveURL(/\/login/);
		await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
	});
});

test("attempt page: a closed attempt links each answered question to its answer on the grading page, and an open one has no such link", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("at5");
	const exam = await threeQuestionExam(course);
	const ana = await enrolledStudent(course, "at5-ana", "Ana Prado");
	const bia = await enrolledStudent(course, "at5-bia", "Bia Lima");
	const first = await answer(course, exam.slug, ana, "q-one", "First reply", 1);
	const second = await answer(
		course,
		exam.slug,
		ana,
		"q-two",
		"Second reply",
		2,
	);
	await finish(course, exam.slug, ana);
	await answer(course, exam.slug, bia, "q-one", "Saved so far", 3);
	await logInAs(page, teacher);

	await test.step("the closed attempt", async () => {
		await complete(exam.id);
		const url = `${href}/exams/midterm/attempts/at5-ana`;
		await page.goto(url);

		await expect(page).toHaveURL(url);
		await expect(titleHeading(page, "Ana Prado")).toBeVisible();
		await expect(
			questionArticle(page, 1).getByRole("link", { name: "Grade this answer" }),
		).toHaveAttribute(
			"href",
			`${href}/exams/midterm/grading/q-one?names=1#answer-${first}`,
		);
		await expect(
			questionArticle(page, 2).getByRole("link", { name: "Grade this answer" }),
		).toHaveAttribute(
			"href",
			`${href}/exams/midterm/grading/q-two?names=1#answer-${second}`,
		);
		await expect(
			questionArticle(page, 3).getByRole("link", { name: "Grade this answer" }),
		).toHaveCount(0);
	});

	await test.step("an attempt still in progress shows what is saved and no grading link", async () => {
		// Re-open the exam and leave Bia's attempt unfinished.
		await prisma.exam.update({
			where: { id: exam.id },
			data: { status: "ONGOING" },
		});
		const url = `${href}/exams/midterm/attempts/at5-bia`;
		await page.goto(url);

		await expect(page).toHaveURL(url);
		await expect(titleHeading(page, "Bia Lima")).toBeVisible();
		await expectShows(questionArticle(page, 1), "Saved so far");
		await expect(detail(page, "Submitted")).toHaveText("In progress");
		await expect(
			page.getByRole("link", { name: "Grade this answer" }),
		).toHaveCount(0);
	});
});

test("attempt page: only the newest submission to a question is shown", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("at6");
	const exam = await threeQuestionExam(course);
	const ana = await enrolledStudent(course, "at6-ana", "Ana Prado");
	await answer(course, exam.slug, ana, "q-one", "Superseded reply", 1);
	await answer(course, exam.slug, ana, "q-one", "Final reply", 2);
	await finish(course, exam.slug, ana);
	await complete(exam.id);
	await logInAs(page, teacher);

	await page.goto(`${href}/exams/midterm/attempts/at6-ana`);

	await expect(page).toHaveURL(`${href}/exams/midterm/attempts/at6-ana`);
	await expect(titleHeading(page, "Ana Prado")).toBeVisible();
	await expectShows(questionArticle(page, 1), "Final reply");
	await expect(page.locator("main")).not.toContainText("Superseded reply");
});

//
// R5: names on the grading page
//

interface Person {
	username: string;
	name: string;
	email: string;
	first: string;
	second: string;
}

const PEOPLE: Person[] = [
	{
		username: "nm-quill",
		name: "Zephyrine Quillfeather",
		email: "nm-quill@codehood.test",
		first: "Quill one",
		second: "Quill two",
	},
	{
		username: "nm-marrow",
		name: "Yorick Marrowbone",
		email: "nm-marrow@codehood.test",
		first: "Marrow one",
		second: "Marrow two",
	},
];

/// A closed exam with two answered questions, `q-one` and `q-two`, and both people's answers to each.
async function namedSitting(prefix: string) {
	const { teacher, course, href } = await setup(prefix);
	await shortQuestion(course, "q-one", "Title one");
	await shortQuestion(course, "q-two", "Title two");
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "midterm",
		title: "Midterm exam",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "q-one" }, { slug: "q-two" }],
	});
	const ids: Record<string, string> = {};
	let minutes = 1;
	for (const person of PEOPLE) {
		const student = await enrolledStudent(course, person.username, person.name);
		ids[person.first] = await answer(
			course,
			exam.slug,
			student,
			"q-one",
			person.first,
			minutes++,
		);
		ids[person.second] = await answer(
			course,
			exam.slug,
			student,
			"q-two",
			person.second,
			minutes++,
		);
		await finish(course, exam.slug, student);
	}
	await complete(exam.id);
	return { teacher, course, href, ids };
}

function namesSwitch(page: Page) {
	return page.getByRole("switch", { name: "Show names", exact: true });
}

function answerArticle(page: Page, text: string) {
	return page.getByRole("article").filter({ hasText: text });
}

async function openGrading(page: Page, url: string) {
	await page.goto(url);
	await expect(page).toHaveURL(url);
	await expect(
		page.getByRole("heading", { level: 2, name: "Title one", exact: true }),
	).toBeVisible();
}

test("names: a question page opens with names hidden, the switch off and nobody identifiable in the page", async ({
	page,
}) => {
	const { teacher, href } = await namedSitting("nm1");
	await logInAs(page, teacher);

	await openGrading(page, `${href}/exams/midterm/grading/q-one`);

	await expect(namesSwitch(page)).toHaveAttribute("aria-checked", "false");
	await expect(page.getByRole("article")).toHaveCount(2);
	const main = page.locator("main");
	for (const person of PEOPLE) {
		await expect(main).not.toContainText(person.name);
		await expect(main).not.toContainText(person.username);
		await expect(main).not.toContainText(person.email);
	}
});

test("names: the switch shows each answer's author, and the next question, the back-link and the queue keep names on", async ({
	page,
}) => {
	const { teacher, href } = await namedSitting("nm2");
	await logInAs(page, teacher);
	const grading = `${href}/exams/midterm/grading`;
	await openGrading(page, `${grading}/q-one`);

	await test.step("turning names on", async () => {
		await namesSwitch(page).click();

		await expect(page).toHaveURL(`${grading}/q-one?names=1`);
		await expect(namesSwitch(page)).toHaveAttribute("aria-checked", "true");
		for (const person of PEOPLE) {
			await expect(answerArticle(page, person.first)).toContainText(
				person.name,
			);
		}
		await expect(answerArticle(page, PEOPLE[0]?.first ?? "")).not.toContainText(
			PEOPLE[1]?.name ?? "",
		);
	});

	await test.step("the next question opens with names on", async () => {
		await page
			.getByRole("link", { name: "Next question", exact: true })
			.click();

		await expect(page).toHaveURL(`${grading}/q-two?names=1`);
		await expect(
			page.getByRole("heading", { level: 2, name: "Title two", exact: true }),
		).toBeVisible();
		await expect(namesSwitch(page)).toHaveAttribute("aria-checked", "true");
		for (const person of PEOPLE) {
			await expect(answerArticle(page, person.second)).toContainText(
				person.name,
			);
		}
	});

	await test.step("the back-link and the queue carry the parameter", async () => {
		await page.getByRole("link", { name: "← Grading", exact: true }).click();

		await expect(page).toHaveURL(`${grading}?names=1`);
		await expect(
			page.getByRole("heading", { level: 2, name: "Grading", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("link", { name: "Title one", exact: true }),
		).toHaveAttribute("href", `${grading}/q-one?names=1`);
		await expect(
			page.getByRole("link", { name: "Title two", exact: true }),
		).toHaveAttribute("href", `${grading}/q-two?names=1`);
	});
});

test("names: turning the switch off again drops the parameter and hides the names", async ({
	page,
}) => {
	const { teacher, href } = await namedSitting("nm3");
	await logInAs(page, teacher);
	const url = `${href}/exams/midterm/grading/q-one`;
	await openGrading(page, `${url}?names=1`);
	await expect(namesSwitch(page)).toHaveAttribute("aria-checked", "true");
	await expect(answerArticle(page, PEOPLE[0]?.first ?? "")).toContainText(
		PEOPLE[0]?.name ?? "",
	);

	await namesSwitch(page).click();

	await expect(page).toHaveURL(url);
	await expect(namesSwitch(page)).toHaveAttribute("aria-checked", "false");
	const main = page.locator("main");
	for (const person of PEOPLE) {
		await expect(main).not.toContainText(person.name);
	}
});

test("names: saving a grade keeps the parameter in the URL and the names on the page", async ({
	page,
}) => {
	const { teacher, href } = await namedSitting("nm4");
	await logInAs(page, teacher);
	const url = `${href}/exams/midterm/grading/q-one?names=1`;
	await openGrading(page, url);
	const article = answerArticle(page, PEOPLE[0]?.first ?? "");
	await expect(article).toContainText(PEOPLE[0]?.name ?? "");

	await article.getByLabel("Score (%)", { exact: true }).fill("70");
	await article.getByLabel("Comment", { exact: true }).fill("Solid");
	await article.getByRole("button", { name: "Save grade" }).click();

	await expect(article).toContainText("70%");
	await expect(article).toContainText(PEOPLE[0]?.name ?? "");
	await expect(page).toHaveURL(/[?&]names=1/);
	await expect(namesSwitch(page)).toHaveAttribute("aria-checked", "true");
	await expect(answerArticle(page, PEOPLE[1]?.first ?? "")).toContainText(
		PEOPLE[1]?.name ?? "",
	);
});

test("names: each answer article has the id answer-<submission id>, with or without names", async ({
	page,
}) => {
	const { teacher, href, ids } = await namedSitting("nm5");
	await logInAs(page, teacher);
	const url = `${href}/exams/midterm/grading/q-one`;

	for (const suffix of ["", "?names=1"]) {
		await openGrading(page, `${url}${suffix}`);

		for (const person of PEOPLE) {
			await expect(page.locator(`#answer-${ids[person.first]}`)).toContainText(
				person.first,
			);
		}
	}
});
