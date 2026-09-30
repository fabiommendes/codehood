import { expect, type Page, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db, type schema } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { capitalShortAnswer } from "@/mdq/fixtures";
import type { ExamTiming } from "@/services/exam-state";
import {
	type GradingAttempt,
	type GradingFeedback,
	questionStats,
} from "@/services/grading";
import { courseHref } from "@/urls";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// Per-question statistics: the pure computation, and the table on the instructor's exam page.

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
// questionStats: pure
//

/// An untimed exam being answered: attempts only close when their owner closes them.
const EXAM: ExamTiming = {
	type: "EXAM",
	status: "ONGOING",
	scheduledAt: null,
	duration: null,
	extraTime: null,
};

type SubmissionRow = GradingAttempt["submissions"][number];

let nextId = 1;

function submission(
	publicId: string,
	question: string,
	minutes: number,
	overrides: Partial<SubmissionRow> = {},
): SubmissionRow {
	return {
		id: nextId++ as SubmissionRow["id"],
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

const QUESTIONS = ["q1", "q2"];

function statsOf(attempts: GradingAttempt[], feedback: GradingFeedback[] = []) {
	return questionStats(EXAM, QUESTIONS, attempts, feedback, NOW);
}

test("questionStats: zero attempts yields one empty entry per question, in exam order", () => {
	expect(statsOf([])).toEqual([
		{
			question: "q1",
			answered: 0,
			graded: 0,
			pending: 0,
			notGraded: 0,
			average: null,
			correct: null,
		},
		{
			question: "q2",
			answered: 0,
			graded: 0,
			pending: 0,
			notGraded: 0,
			average: null,
			correct: null,
		},
	]);
});

test("questionStats: a right and a wrong answer average one half, with one half correct", () => {
	const stats = statsOf(
		[
			attempt("ana", [submission("a1", "q1", 5)]),
			attempt("bia", [submission("b1", "q1", 6)]),
		],
		[pass("a1", "1", 20), pass("b1", "0", 21)],
	);

	expect(stats[0]).toMatchObject({
		question: "q1",
		answered: 2,
		graded: 2,
		pending: 0,
	});
	expect(stats[0]?.average).toBeCloseTo(0.5, 10);
	expect(stats[0]?.correct).toBeCloseTo(0.5, 10);
});

test("questionStats: a partial score counts in the average but not as correct", () => {
	const stats = statsOf(
		[
			attempt("ana", [submission("a1", "q1", 5)]),
			attempt("bia", [submission("b1", "q1", 6)]),
		],
		[pass("a1", "1/2", 20), pass("b1", "1", 21)],
	);

	expect(stats[0]?.average).toBeCloseTo(0.75, 10);
	expect(stats[0]?.correct).toBeCloseTo(0.5, 10);
});

test("questionStats: a pending answer is answered and pending, but stays out of the average", () => {
	const stats = statsOf(
		[
			attempt("ana", [submission("a1", "q1", 5)]),
			attempt("bia", [submission("b1", "q1", 6)]),
		],
		[pass("a1", "1/4", 20)],
	);

	expect(stats[0]).toMatchObject({ answered: 2, graded: 1, pending: 1 });
	expect(stats[0]?.average).toBeCloseTo(0.25, 10);
	expect(stats[0]?.correct).toBe(0);
});

test("questionStats: with only pending answers the average and the correct share are null", () => {
	const stats = statsOf([attempt("ana", [submission("a1", "q1", 5)])]);

	expect(stats[0]).toMatchObject({
		answered: 1,
		pending: 1,
		average: null,
		correct: null,
	});
});

test("questionStats: a will-not-grade answer is answered, not pending, and stays out of the average even with a pass", () => {
	const stats = statsOf(
		[
			attempt("ana", [submission("a1", "q1", 5, { status: "WILL_NOT_GRADE" })]),
			attempt("bia", [submission("b1", "q1", 6)]),
		],
		[pass("a1", "0", 20), pass("b1", "1", 21)],
	);

	expect(stats[0]).toMatchObject({
		answered: 2,
		graded: 1,
		pending: 0,
		notGraded: 1,
		average: 1,
		correct: 1,
	});
});

test("questionStats: an unanswered question counts nowhere", () => {
	const stats = statsOf(
		[attempt("ana", [submission("a1", "q1", 5)])],
		[pass("a1", "1", 20)],
	);

	expect(stats[1]).toMatchObject({
		question: "q2",
		answered: 0,
		pending: 0,
		average: null,
		correct: null,
	});
});

test("questionStats: only the newest submission of an attempt to a question counts", () => {
	const stats = statsOf(
		[attempt("ana", [submission("old", "q1", 5), submission("new", "q1", 9)])],
		[pass("old", "1", 20), pass("new", "0", 21)],
	);

	expect(stats[0]).toMatchObject({
		answered: 1,
		graded: 1,
		average: 0,
		correct: 0,
	});
});

test("questionStats: the newest pass on an answer is its verdict", () => {
	const stats = statsOf(
		[attempt("ana", [submission("a1", "q1", 5)])],
		[pass("a1", "0", 20), pass("a1", "1", 30)],
	);

	expect(stats[0]).toMatchObject({ average: 1, correct: 1 });
});

test("questionStats: answers of an attempt still in progress are left out", () => {
	const stats = statsOf(
		[
			attempt("ana", [submission("a1", "q1", 5)], {
				acceptingSubmissions: true,
			}),
		],
		[pass("a1", "1", 20)],
	);

	expect(stats[0]).toMatchObject({ answered: 0, average: null });
});

test("questionStats: a negative score lowers the average", () => {
	const stats = statsOf(
		[
			attempt("ana", [submission("a1", "q1", 5)]),
			attempt("bia", [submission("b1", "q1", 6)]),
		],
		[pass("a1", "-1/2", 20), pass("b1", "1", 21)],
	);

	expect(stats[0]?.average).toBeCloseTo(0.25, 10);
	expect(stats[0]?.correct).toBeCloseTo(0.5, 10);
});

//
// The statistics section of the instructor's exam page
//

type Course = Awaited<ReturnType<typeof persistedCourseFactory.create>>;
type Student = Awaited<ReturnType<typeof seedUser>>;

function hrefOf(course: Course) {
	return courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
}

async function enrolledStudent(course: Course, username: string) {
	const student = await seedUser({ role: "STUDENT", username });
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

/// Submits `text` to `question` and returns the new submission's `publicId`.
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
		response.submissions.filter((s) => s.question === question).at(-1)
			?.publicId ?? "";
	await prisma.submission.update({
		where: { publicId },
		data: { createdAt: at(minutes) },
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

function statsHeading(page: Page) {
	return page.getByRole("heading", {
		level: 2,
		name: "Question statistics",
		exact: true,
	});
}

function statsTable(page: Page) {
	return page.getByRole("table", { name: "Question statistics", exact: true });
}

function statsRow(page: Page, title: string) {
	return statsTable(page).getByRole("row").filter({ hasText: title });
}

test("question statistics: the instructor reads each question's numbers, a student sees no table", async ({
	page,
}) => {
	const teacher = await seedUser({
		role: "INSTRUCTOR",
		username: "qs-teacher",
	});
	const course = await persistedCourseFactory.create({
		instructor: teacher.username,
	});
	const href = hrefOf(course);
	await shortQuestion(course, "q-one", "Title one");
	await shortQuestion(course, "q-two", "Title two");
	await shortQuestion(course, "q-three", "Title three");
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "midterm",
		title: "Midterm exam",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "q-one" }, { slug: "q-two" }, { slug: "q-three" }],
	});
	const ana = await enrolledStudent(course, "qs-ana");
	const bia = await enrolledStudent(course, "qs-bia");
	const cai = await enrolledStudent(course, "qs-cai");

	// Ana: right on one, a quarter on two, nothing on three.
	const anaOne = await answer(course, exam.slug, ana, "q-one", "A1", 1);
	const anaTwo = await answer(course, exam.slug, ana, "q-two", "A2", 2);
	// Bia: answered one twice, only the half-right second answer counts;
	// two waits for a grade; three will not be graded.
	const biaOld = await answer(course, exam.slug, bia, "q-one", "B1", 3);
	const biaNew = await answer(course, exam.slug, bia, "q-one", "B1b", 4);
	await answer(course, exam.slug, bia, "q-two", "B2", 5);
	const biaThree = await answer(course, exam.slug, bia, "q-three", "B3", 6);
	// Cai: one waits for a grade.
	await answer(course, exam.slug, cai, "q-one", "C1", 7);
	for (const student of [ana, bia, cai]) {
		await finish(course, exam.slug, student);
	}
	await complete(exam.id);
	await grade(anaOne, "1");
	await grade(anaTwo, "1/4");
	await grade(biaOld, "1");
	await grade(biaNew, "1/2");
	await db.submission.update(
		{ publicId: biaThree },
		{ status: "WILL_NOT_GRADE" },
		FULL_ACCESS,
	);

	await test.step("the instructor sees one row per question, in exam order", async () => {
		await logInAs(page, teacher);
		await page.goto(`${href}/exams/midterm`);

		await expect(statsHeading(page)).toBeVisible();
		for (const header of [
			"Question",
			"Answered",
			"Average",
			"Correct",
			"To grade",
		]) {
			await expect(
				statsTable(page).getByRole("columnheader", {
					name: header,
					exact: true,
				}),
			).toBeVisible();
		}
		const bodyRows = statsTable(page).locator("tbody tr");
		await expect(bodyRows).toHaveCount(3);
		await expect(bodyRows.nth(0)).toContainText("Title one");
		await expect(bodyRows.nth(1)).toContainText("Title two");
		await expect(bodyRows.nth(2)).toContainText("Title three");

		const cells = (title: string) => statsRow(page, title).locator("td");
		await expect(cells("Title one")).toHaveText([
			"Title one",
			"3",
			"75%",
			"50%",
			"1",
		]);
		await expect(cells("Title two")).toHaveText([
			"Title two",
			"2",
			"25%",
			"0%",
			"1",
		]);
		await expect(cells("Title three")).toHaveText([
			"Title three",
			"1",
			"",
			"",
			"",
		]);
		await expect(
			statsRow(page, "Title one").getByRole("link", { name: "1" }),
		).toHaveAttribute("href", `${href}/exams/midterm/grading/q-one`);
	});

	await test.step("a student sees no statistics", async () => {
		await page.context().clearCookies();
		await logInAs(page, ana);
		await page.goto(`${href}/exams/midterm`);

		await expect(
			page.getByRole("heading", { level: 2, name: "Midterm exam" }),
		).toBeVisible();
		await expect(statsHeading(page)).toHaveCount(0);
		await expect(statsTable(page)).toHaveCount(0);
	});
});

test("question statistics: with no answers the section says so, with no table", async ({
	page,
}) => {
	const teacher = await seedUser({
		role: "INSTRUCTOR",
		username: "qs2-teacher",
	});
	const course = await persistedCourseFactory.create({
		instructor: teacher.username,
	});
	await shortQuestion(course, "q-one", "Title one");
	await persistedExamFactory.create({
		course: course.id,
		slug: "midterm",
		title: "Midterm exam",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "q-one" }],
	});
	await logInAs(page, teacher);

	await page.goto(`${hrefOf(course)}/exams/midterm`);

	await expect(statsHeading(page)).toBeVisible();
	await expect(page.getByText("No answers yet.")).toBeVisible();
	await expect(statsTable(page)).toHaveCount(0);
});
