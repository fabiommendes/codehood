import { expect, type Page, test } from "@playwright/test";
import fc from "fast-check";
import { FULL_ACCESS } from "@/auth/actor";
import { db, type schema } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { capitalShortAnswer } from "@/mdq/fixtures";
import type { ExamTiming, ExceptionTiming } from "@/services/exam-state";
import {
	attemptRows,
	countingAnswers,
	type GradedStudent,
	type GradingAttempt,
	type GradingFeedback,
} from "@/services/grading";
import { courseHref } from "@/urls";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// The exam's results: the pure rows, and the section of the instructor's exam page that shows them.

test.beforeEach(resetDatabase);

const MINUTE = 60_000;

const T0 = new Date("2026-03-10T10:00:00Z");

/// `T0` shifted by `minutes`, so "later" reads as a bigger number.
function at(minutes: number): Date {
	return new Date(T0.getTime() + minutes * MINUTE);
}

/// The clock every pure case reads, well after everything in the fixtures.
const NOW = at(10_000);

//
// attemptRows: pure
//

/// An untimed exam being answered: attempts only close when their owner closes them.
function openExam(overrides: Partial<ExamTiming> = {}): ExamTiming {
	return {
		type: "EXAM",
		status: "ONGOING",
		scheduledAt: null,
		duration: null,
		extraTime: null,
		...overrides,
	};
}

type SubmissionRow = GradingAttempt["submissions"][number];

function submission(
	publicId: string,
	question: string,
	minutes: number,
	overrides: Partial<SubmissionRow> = {},
): SubmissionRow {
	return {
		id: 1 as SubmissionRow["id"],
		publicId,
		responseId: 1 as SubmissionRow["responseId"],
		questionId: 1 as SubmissionRow["questionId"],
		response: "response-1",
		question,
		status: "PENDING_GRADE",
		automaticallyTriggered: false,
		payload: { answer: publicId },
		startedAt: null,
		createdAt: at(minutes),
		...overrides,
	};
}

function attempt(
	author: string,
	submissions: SubmissionRow[],
	overrides: Partial<GradingAttempt> = {},
): GradingAttempt {
	return {
		author,
		createdAt: at(-60),
		acceptingSubmissions: false,
		submissions,
		...overrides,
	};
}

function pass(
	submissionId: string,
	score: string,
	minutes: number,
): GradingFeedback {
	return {
		submission: submissionId,
		score,
		feedback: null,
		grader: "teacher",
		bot: null,
		updatedAt: at(minutes),
	};
}

function student(
	username: string,
	name: string,
	dropped = false,
): GradedStudent {
	return { username, name, dropped };
}

const QUESTIONS = ["q1", "q2", "q3"];

function rowsOf(
	attempts: GradingAttempt[],
	feedback: GradingFeedback[] = [],
	students: GradedStudent[] = [student("ana", "Ana")],
	exam: ExamTiming = openExam(),
) {
	return attemptRows(exam, QUESTIONS, attempts, feedback, students, NOW);
}

test("attemptRows: one row per attempt, with the student and when they started", () => {
	const rows = rowsOf(
		[attempt("ana", [submission("a1", "q1", 5)], { createdAt: at(-7) })],
		[],
		[student("ana", "Ana")],
	);

	expect(rows).toHaveLength(1);
	expect(rows[0]).toMatchObject({
		author: "ana",
		name: "Ana",
		startedAt: at(-7),
	});
});

test("attemptRows: no attempts yields no rows", () => {
	expect(rowsOf([])).toEqual([]);
});

test("attemptRows: an attempt closed by its owner is submitted, one still accepting submissions is in progress", () => {
	const rows = rowsOf(
		[
			attempt("ana", [submission("a1", "q1", 5)]),
			attempt("bia", [submission("b1", "q1", 6)], {
				acceptingSubmissions: true,
			}),
		],
		[],
		[student("ana", "Ana"), student("bia", "Bia")],
	);

	expect(rows.map((r) => [r.author, r.state])).toEqual([
		["ana", "submitted"],
		["bia", "in-progress"],
	]);
});

test("attemptRows: every attempt of a completed exam is submitted", () => {
	const rows = rowsOf(
		[
			attempt("ana", [submission("a1", "q1", 5)], {
				acceptingSubmissions: true,
			}),
		],
		[],
		[student("ana", "Ana")],
		openExam({ status: "COMPLETED" }),
	);

	expect(rows[0]?.state).toBe("submitted");
});

test("attemptRows: an attempt past its own deadline is submitted", () => {
	const timed = openExam({ duration: { hours: 1 } });
	const running = attempt("ana", [submission("a1", "q1", 5)], {
		createdAt: at(0),
		acceptingSubmissions: true,
	});

	const late = attemptRows(timed, QUESTIONS, [running], [], [], at(61));
	const early = attemptRows(timed, QUESTIONS, [running], [], [], at(30));

	expect(late[0]?.state).toBe("submitted");
	expect(early[0]?.state).toBe("in-progress");
});

test("attemptRows: answered counts questions with a counting answer, out of the exam's length, ignoring other questions", () => {
	const rows = rowsOf([
		attempt("ana", [
			submission("a1", "q1", 5),
			submission("a1b", "q1", 6),
			submission("a2", "q2", 7),
			submission("stray", "gone", 8),
		]),
	]);

	expect(rows[0]).toMatchObject({ answered: 2, questions: 3 });
});

test("attemptRows: an attempt with no answers has zero answered and zero pending", () => {
	const rows = rowsOf([attempt("ana", [])]);

	expect(rows[0]).toMatchObject({ answered: 0, questions: 3, pending: 0 });
});

test("attemptRows: pending counts answers without a verdict, not the will-not-grade ones", () => {
	const rows = rowsOf(
		[
			attempt("ana", [
				submission("a1", "q1", 5),
				submission("a2", "q2", 6),
				submission("a3", "q3", 7, { status: "WILL_NOT_GRADE" }),
			]),
		],
		[pass("a2", "1", 20)],
	);

	expect(rows[0]).toMatchObject({ answered: 3, pending: 1 });
});

test("attemptRows: only the newest submission to a question can be pending", () => {
	const rows = rowsOf(
		[attempt("ana", [submission("old", "q1", 5), submission("new", "q1", 9)])],
		[pass("new", "1", 20)],
	);

	expect(rows[0]?.pending).toBe(0);
});

test("attemptRows: an attempt in progress has zero pending and a null total", () => {
	const rows = rowsOf(
		[
			attempt("ana", [submission("a1", "q1", 5), submission("a2", "q2", 6)], {
				acceptingSubmissions: true,
			}),
		],
		[pass("a1", "1", 20)],
	);

	expect(rows[0]).toMatchObject({
		state: "in-progress",
		answered: 2,
		pending: 0,
		total: null,
	});
});

test("attemptRows: the total is null while an answer waits for a grade", () => {
	const rows = rowsOf(
		[attempt("ana", [submission("a1", "q1", 5), submission("a2", "q2", 6)])],
		[pass("a1", "1", 20)],
	);

	expect(rows[0]?.total).toBeNull();
});

test("attemptRows: once every answer is graded the total is the mean over all the exam's questions, unanswered ones counting zero", () => {
	const rows = rowsOf(
		[attempt("ana", [submission("a1", "q1", 5), submission("a2", "q2", 6)])],
		[pass("a1", "1/2", 20), pass("a2", "1", 21)],
	);

	expect(rows[0]?.total).toBeCloseTo(0.5, 10);
	expect(rows[0]?.pending).toBe(0);
});

test("attemptRows: a will-not-grade answer counts zero in a total that is not null", () => {
	const rows = rowsOf(
		[
			attempt("ana", [
				submission("a1", "q1", 5),
				submission("a2", "q2", 6),
				submission("a3", "q3", 7, { status: "WILL_NOT_GRADE" }),
			]),
		],
		[pass("a1", "1", 20), pass("a2", "1", 21)],
	);

	expect(rows[0]?.total).toBeCloseTo(2 / 3, 10);
});

test("attemptRows: the name and dropped flag come from the students, and an unlisted student is their username, not dropped", () => {
	const rows = rowsOf(
		[
			attempt("ana", [submission("a1", "q1", 5)]),
			attempt("bia", [submission("b1", "q1", 6)]),
			attempt("cai", [submission("c1", "q1", 7)]),
		],
		[],
		[student("ana", "Ana Prado", true), student("bia", "Bia Lima")],
	);

	expect(rows.map((r) => [r.author, r.name, r.dropped])).toEqual([
		["ana", "Ana Prado", true],
		["bia", "Bia Lima", false],
		["cai", "cai", false],
	]);
});

test("attemptRows: rows are sorted by name without regard to case, ties by username", () => {
	const people = [
		student("u1", "carla"),
		student("u2", "Bruno"),
		student("u3", "adam"),
		student("u5", "Sam"),
		student("u4", "sam"),
	];
	const attempts = people.map((p) =>
		attempt(p.username, [submission(`${p.username}-1`, "q1", 5)]),
	);

	const rows = rowsOf(attempts, [], people);

	expect(rows.map((r) => r.author)).toEqual(["u3", "u2", "u1", "u4", "u5"]);
});

test("attemptRows: the order of the rows does not depend on the order of the attempts", () => {
	const people = [
		student("u1", "carla"),
		student("u2", "Bruno"),
		student("u3", "adam"),
		student("u4", "sam"),
		student("u5", "Sam"),
	];
	const attempts = people.map((p) =>
		attempt(p.username, [submission(`${p.username}-1`, "q1", 5)]),
	);
	const expected = rowsOf(attempts, [], people);

	fc.assert(
		fc.property(
			fc.shuffledSubarray(attempts, {
				minLength: attempts.length,
				maxLength: attempts.length,
			}),
			(shuffled) => {
				expect(rowsOf(shuffled, [], people)).toEqual(expected);
			},
		),
	);
});

//
// The results section of the instructor's exam page
//

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
	name?: string,
): Promise<Student> {
	const student = await seedUser({
		role: "STUDENT",
		username,
		...(name ? { name } : {}),
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
		response.submissions.find((s) => s.question === question)?.publicId ?? "";
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

async function grade(submission: string, score: string) {
	await db.feedback.create(
		{
			submission: { publicId: submission },
			ref: `pass-${Math.random().toString(36).slice(2, 8)}`,
			score,
			bot: "auto",
		},
		FULL_ACCESS,
	);
}

/// Three published questions, `q-one` to `q-three`, created in that order.
async function threeQuestions(course: Course) {
	await shortQuestion(course, "q-one", "Title one");
	await shortQuestion(course, "q-two", "Title two");
	await shortQuestion(course, "q-three", "Title three");
}

async function threeQuestionExam(
	course: Course,
	overrides: { status?: "ONGOING"; type?: "EXAM" | "PRACTICE" } = {},
) {
	return persistedExamFactory.create({
		course: course.id,
		slug: "midterm",
		title: "Midterm exam",
		type: overrides.type ?? "EXAM",
		status: overrides.status ?? "ONGOING",
		questions: [{ slug: "q-one" }, { slug: "q-two" }, { slug: "q-three" }],
	});
}

function resultsHeading(page: Page) {
	return page.getByRole("heading", {
		level: 2,
		name: "Results",
		exact: true,
	});
}

function resultsTable(page: Page) {
	return page.getByRole("table", { name: "Results", exact: true });
}

function rowOf(page: Page, name: string) {
	return resultsTable(page)
		.getByRole("row")
		.filter({ has: page.getByRole("link", { name, exact: true }) });
}

test("results: a submitted attempt with one pending answer reads its progress, and its total once graded", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("rs1");
	await threeQuestions(course);
	const exam = await threeQuestionExam(course);
	const ana = await enrolledStudent(course, "rs1-ana", "Ana Prado");
	const first = await answer(course, exam.slug, ana, "q-one", "Reply one", 1);
	const second = await answer(course, exam.slug, ana, "q-two", "Reply two", 2);
	await finish(course, exam.slug, ana);
	await complete(exam.id);
	await grade(first, "1");
	await logInAs(page, teacher);

	await page.goto(`${href}/exams/midterm`);

	await expect(page).toHaveURL(`${href}/exams/midterm`);
	await expect(resultsHeading(page)).toBeVisible();
	for (const header of [
		"Student",
		"Attempt",
		"Answered",
		"To grade",
		"Total",
	]) {
		await expect(
			resultsTable(page).getByRole("columnheader", {
				name: header,
				exact: true,
			}),
		).toBeVisible();
	}
	const row = rowOf(page, "Ana Prado");
	await expect(row).toHaveCount(1);
	await expect(row).toContainText("Submitted");
	await expect(row).toContainText("2 of 3 answered");
	await expect(row).toContainText("1 pending");
	await expect(row).toContainText("Pending");
	await expect(
		row.getByRole("link", { name: "Ana Prado", exact: true }),
	).toHaveAttribute("href", `${href}/exams/midterm/attempts/rs1-ana`);

	await grade(second, "1/2");
	await page.reload();

	await expect(resultsHeading(page)).toBeVisible();
	await expect(rowOf(page, "Ana Prado")).toContainText("50%");
	await expect(rowOf(page, "Ana Prado")).not.toContainText("pending");
	await expect(rowOf(page, "Ana Prado")).not.toContainText("Pending");
	await expect(rowOf(page, "Ana Prado").locator("td, th").nth(3)).toHaveText(
		"",
	);
});

test("results: with no attempt the section says so, with no table and no grading link", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("rs2");
	await threeQuestions(course);
	const exam = await threeQuestionExam(course);
	await complete(exam.id);
	await logInAs(page, teacher);

	await page.goto(`${href}/exams/midterm`);

	await expect(page).toHaveURL(`${href}/exams/midterm`);
	await expect(resultsHeading(page)).toBeVisible();
	await expect(page.getByText("No attempts yet.")).toBeVisible();
	await expect(page.getByRole("table")).toHaveCount(0);
	await expect(
		page.getByRole("link", { name: /Grade answers|Review grades/ }),
	).toHaveCount(0);
});

test("results: the grading link counts the pending answers across students, and reads Review grades once none is left", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("rs3");
	await threeQuestions(course);
	const exam = await threeQuestionExam(course);
	const ana = await enrolledStudent(course, "rs3-ana", "Ana Prado");
	const bia = await enrolledStudent(course, "rs3-bia", "Bia Lima");
	const ids = [
		await answer(course, exam.slug, ana, "q-one", "A one", 1),
		await answer(course, exam.slug, ana, "q-two", "A two", 2),
		await answer(course, exam.slug, bia, "q-one", "B one", 3),
	];
	await finish(course, exam.slug, ana);
	await finish(course, exam.slug, bia);
	await complete(exam.id);
	await logInAs(page, teacher);

	await test.step("with pending answers", async () => {
		await page.goto(`${href}/exams/midterm`);

		await expect(page).toHaveURL(`${href}/exams/midterm`);
		await expect(resultsHeading(page)).toBeVisible();
		await expect(page.getByText("3 answers wait for a grade")).toBeVisible();
		const link = page.getByRole("link", { name: "Grade answers" });
		await expect(link).toHaveAttribute("href", `${href}/exams/midterm/grading`);
		await expect(page.getByRole("link", { name: "Review grades" })).toHaveCount(
			0,
		);
	});

	await test.step("with none pending", async () => {
		for (const id of ids) await grade(id, "1");
		await page.reload();

		await expect(resultsHeading(page)).toBeVisible();
		await expect(
			page.getByRole("link", { name: "Review grades" }),
		).toHaveAttribute("href", `${href}/exams/midterm/grading`);
		await expect(page.getByRole("link", { name: /Grade answers/ })).toHaveCount(
			0,
		);
	});
});

test("results: a dropped student who attempted the exam is still listed, and rows are sorted by name", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("rs4");
	await threeQuestions(course);
	const exam = await threeQuestionExam(course);
	// Created as Carla, Alice, bruno; by username they sort bruno, Carla, Alice;
	// by name, ignoring case, Alice, bruno, Carla.
	const people = [
		await enrolledStudent(course, "rs4-b", "Carla Mendes"),
		await enrolledStudent(course, "rs4-c", "Alice Souza"),
		await enrolledStudent(course, "rs4-a", "bruno Lima"),
	];
	for (const [i, student] of people.entries()) {
		await answer(course, exam.slug, student, "q-one", `Reply ${i}`, i + 1);
		await finish(course, exam.slug, student);
	}
	await complete(exam.id);
	await prisma.enrollment.updateMany({
		where: { username: "rs4-c" },
		data: { status: "DROPPED" },
	});
	await logInAs(page, teacher);

	await page.goto(`${href}/exams/midterm`);

	await expect(page).toHaveURL(`${href}/exams/midterm`);
	await expect(resultsHeading(page)).toBeVisible();
	await expect(resultsTable(page).getByRole("link")).toHaveText([
		"Alice Souza",
		"bruno Lima",
		"Carla Mendes",
	]);
	await expect(rowOf(page, "Alice Souza")).toContainText("dropped");
	await expect(rowOf(page, "bruno Lima")).not.toContainText("dropped");
	await expect(rowOf(page, "Carla Mendes")).not.toContainText("dropped");
});

test("results: an attempt still in progress reads In progress with a dash for a total", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("rs5");
	await threeQuestions(course);
	const exam = await threeQuestionExam(course);
	const ana = await enrolledStudent(course, "rs5-ana", "Ana Prado");
	const graded = await answer(course, exam.slug, ana, "q-one", "Reply one", 1);
	await grade(graded, "1");
	await logInAs(page, teacher);

	await page.goto(`${href}/exams/${exam.slug}`);

	await expect(page).toHaveURL(`${href}/exams/midterm`);
	await expect(resultsHeading(page)).toBeVisible();
	const row = rowOf(page, "Ana Prado");
	await expect(row).toContainText("In progress");
	await expect(row).toContainText("1 of 3 answered");
	await expect(row).toContainText("—");
	await expect(row).not.toContainText("Submitted");
	await expect(row).not.toContainText("%");
});

test("results: a student never sees the section, and a practice exam has none for the instructor", async ({
	page,
}) => {
	const { teacher, course, href } = await setup("rs6");
	await threeQuestions(course);
	const exam = await threeQuestionExam(course);
	await persistedExamFactory.create({
		course: course.id,
		slug: "drill",
		title: "Practice drill",
		type: "PRACTICE",
		status: "ONGOING",
		questions: [{ slug: "q-one" }],
	});
	const ana = await enrolledStudent(course, "rs6-ana", "Ana Prado");
	await answer(course, exam.slug, ana, "q-one", "Reply one", 1);
	await finish(course, exam.slug, ana);
	await complete(exam.id);

	await test.step("the instructor sees it on a graded exam but not on a practice exam", async () => {
		await logInAs(page, teacher);
		await page.goto(`${href}/exams/midterm`);
		await expect(page).toHaveURL(`${href}/exams/midterm`);
		await expect(resultsHeading(page)).toBeVisible();

		await page.goto(`${href}/exams/drill`);

		await expect(page).toHaveURL(`${href}/exams/drill`);
		await expect(
			page.getByRole("heading", { name: "Practice drill" }).first(),
		).toBeVisible();
		await expect(resultsHeading(page)).toHaveCount(0);
		await expect(page.getByRole("table")).toHaveCount(0);
	});

	await test.step("a student of the course sees neither heading nor table", async () => {
		await page.context().clearCookies();
		await logInAs(page, ana);
		await page.goto(`${href}/exams/midterm`);

		await expect(page).toHaveURL(`${href}/exams/midterm`);
		await expect(
			page.getByRole("heading", { name: "Midterm exam" }).first(),
		).toBeVisible();
		await expect(resultsHeading(page)).toHaveCount(0);
		await expect(page.getByRole("table")).toHaveCount(0);
	});
});

//
// Personal timing
//

/// Closed 40 minutes before `NOW` by the clock: scheduled 100 minutes before it, 60 minutes long.
function justClosedExam(overrides: Partial<ExamTiming> = {}): ExamTiming {
	return openExam({
		status: "SCHEDULED",
		scheduledAt: at(10_000 - 100),
		duration: { minutes: 60 },
		...overrides,
	});
}

const extraMinutes = (minutes: number): ExceptionTiming => ({
	extraTime: { minutes },
	scheduledAt: null,
});

/// An attempt its owner never closed, so only the clock can close it.
const unclosed = (author: string) =>
	attempt(author, [submission(`${author}-1`, "q1", 5)], {
		acceptingSubmissions: true,
	});

test("attemptRows: a student whose extra time is still running is in progress while a classmate is submitted", () => {
	// The exam's window ended 40 minutes ago; ana has 45 more minutes.
	const rows = attemptRows(
		justClosedExam(),
		QUESTIONS,
		[unclosed("ana"), unclosed("bob")],
		[],
		[student("ana", "Ana"), student("bob", "Bob")],
		NOW,
		new Map([["ana", extraMinutes(45)]]),
	);

	expect(rows.map((r) => [r.author, r.state, r.pending, r.total])).toEqual([
		["ana", "in-progress", 0, null],
		["bob", "submitted", 1, null],
	]);
});

test("attemptRows: extra time that has run out leaves the attempt submitted", () => {
	const rows = attemptRows(
		justClosedExam(),
		QUESTIONS,
		[unclosed("ana")],
		[],
		[student("ana", "Ana")],
		NOW,
		new Map([["ana", extraMinutes(30)]]),
	);

	expect(rows[0]?.state).toBe("submitted");
});

test("attemptRows: a makeup in progress keeps the attempt open on an exam completed by hand", () => {
	const completed = justClosedExam({ status: "COMPLETED" });
	const makeup: ExceptionTiming = {
		extraTime: null,
		scheduledAt: at(10_000 - 10),
	};
	const [row] = attemptRows(
		completed,
		QUESTIONS,
		[unclosed("ana")],
		[],
		[student("ana", "Ana")],
		NOW,
		new Map([["ana", makeup]]),
	);

	expect(row?.state).toBe("in-progress");
});

test("countingAnswers: an answer waits until its author's extra time is over", () => {
	const attempts = [unclosed("ana"), unclosed("bob")];
	const counted = (extra: number) =>
		countingAnswers(
			justClosedExam(),
			QUESTIONS,
			attempts,
			[],
			NOW,
			new Map([["ana", extraMinutes(extra)]]),
		).map((a) => a.author);

	expect(counted(45)).toEqual(["bob"]);
	expect(counted(30).sort()).toEqual(["ana", "bob"]);
});
