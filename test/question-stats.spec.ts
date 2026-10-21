import { expect, type Page, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db, type schema } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import {
	brasiliaFillIn,
	capitalShortAnswer,
	idempotenceEssay,
	multipleChoice,
	multipleSelection,
	trueFalse,
	waterNumeric,
} from "@/mdq/fixtures";
import type { ExamTiming } from "@/services/exam-state";
import type { GradingAttempt, GradingFeedback } from "@/services/grading";
import {
	answerDistribution,
	discrimination,
	discriminationFlag,
	questionStats,
} from "@/services/question-stats";
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
			blank: 0,
			discrimination: null,
			discriminationGap: "few-attempts",
		},
		{
			question: "q2",
			answered: 0,
			graded: 0,
			pending: 0,
			notGraded: 0,
			average: null,
			correct: null,
			blank: 0,
			discrimination: null,
			discriminationGap: "few-attempts",
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

/// One cell of a cohort row: a score, `null` for no answer, or a marker for an answer that waits or is will-not-grade.
type Cell = string | null | "pending" | "wng";

/// Closed attempts, one per row of `cells`, each cell the answer to the question of that column.
function cohort(cells: Cell[][], questions: string[] = QUESTIONS) {
	const attempts: GradingAttempt[] = [];
	const feedback: GradingFeedback[] = [];
	cells.forEach((row, index) => {
		const author = `student-${index}`;
		const submissions: SubmissionRow[] = [];
		row.forEach((cell, column) => {
			if (cell === null) return;
			const id = `${author}-${column}`;
			submissions.push(
				submission(id, questions[column] ?? "", 5, {
					status: cell === "wng" ? "WILL_NOT_GRADE" : "PENDING_GRADE",
				}),
			);
			if (cell === "wng") feedback.push(pass(id, "1", 20));
			else if (cell !== "pending") feedback.push(pass(id, cell, 20));
		});
		attempts.push(attempt(author, submissions));
	});
	return { attempts, feedback };
}

function cohortStats(cells: Cell[][], questions: string[] = QUESTIONS) {
	const { attempts, feedback } = cohort(cells, questions);
	return questionStats(EXAM, questions, attempts, feedback, NOW);
}

test("questionStats: blank counts the closed attempts with no answer to the question, and ignores attempts in progress", () => {
	const { attempts, feedback } = cohort([
		["1", "1"],
		["1", null],
		[null, null],
	]);
	const inProgress = attempt("dora", [], { acceptingSubmissions: true });

	const stats = statsOf([...attempts, inProgress], feedback);

	expect(stats[0]).toMatchObject({ answered: 2, blank: 1 });
	expect(stats[1]).toMatchObject({ answered: 1, blank: 2 });
});

test("questionStats: an attempt with a pending answer leaves the discrimination population of every question, not only of the pending one", () => {
	// The five complete attempts read q1 = [1,1,1,0,0], q2 = [1,1,0,0,0]:
	// means .6 and .4, sum(dx*dy) = .8, both sums of squares 1.2, so r = 2/3.
	// The sixth, pending on q1 (zero) and 1 on q2, would change it.
	const stats = cohortStats([
		["1", "1"],
		["1", "1"],
		["1", "0"],
		["0", "0"],
		["0", "0"],
		["pending", "1"],
	]);

	expect(stats[0]).toMatchObject({ answered: 6, pending: 1 });
	expect(stats[0]?.discriminationGap).toBeNull();
	expect(stats[0]?.discrimination).toBeCloseTo(2 / 3, 10);
	expect(stats[1]?.discrimination).toBeCloseTo(2 / 3, 10);
});

test("questionStats: a pending answer that drops the population below five makes every question few-attempts", () => {
	const stats = cohortStats([
		["1", "1"],
		["1", "1"],
		["1", "0"],
		["0", "0"],
		["pending", "1"],
	]);

	for (const entry of stats) {
		expect(entry).toMatchObject({
			discrimination: null,
			discriminationGap: "few-attempts",
		});
	}
});

test("questionStats: blank and will-not-grade answers score zero in the discrimination", () => {
	// q2 reads [1, 1, 0 (will not grade, despite its pass of 1), 0 (blank), 0],
	// q1 reads [1, 1, 1, 0, 0]: the same series as the pending case, r = 2/3.
	const stats = cohortStats([
		["1", "1"],
		["1", "1"],
		["1", "wng"],
		["0", null],
		["0", "0"],
	]);

	expect(stats[0]?.discrimination).toBeCloseTo(2 / 3, 10);
	expect(stats[1]?.discrimination).toBeCloseTo(2 / 3, 10);
	expect(stats[1]).toMatchObject({ blank: 1, notGraded: 1 });
});

test("questionStats: an attempt whose author still has personal time is left out of every count until the window closes", () => {
	// The exam runs from at(0) to at(60); the slow student has 30 extra minutes,
	// so their unfinished attempt is still open until at(90).
	const timed: ExamTiming = {
		type: "EXAM",
		status: "ONGOING",
		scheduledAt: at(0),
		duration: { minutes: 60 },
		extraTime: null,
	};
	const extra = new Map([
		["student-5", { extraTime: { minutes: 30 }, scheduledAt: null }],
	]);
	const { attempts, feedback } = cohort([
		["1", "1"],
		["1", "1"],
		["1", "0"],
		["0", "0"],
		["0", "0"],
		["1", null],
	]);
	const slow = attempts[5];
	if (!slow) throw new Error("the cohort lost its sixth attempt");
	attempts[5] = { ...slow, acceptingSubmissions: true };
	const statsAt = (now: Date) =>
		questionStats(timed, QUESTIONS, attempts, feedback, now, extra);

	// The other five read q1 = [1,1,1,0,0], q2 = [1,1,0,0,0]: r = 2/3.
	const during = statsAt(at(70));
	expect(during[0]).toMatchObject({ answered: 5, blank: 0 });
	expect(during[1]).toMatchObject({ answered: 5, blank: 0 });
	expect(during[0]?.discrimination).toBeCloseTo(2 / 3, 10);

	// Counted, the slow attempt adds q1 = 1 and a blank q2 (zero): r = 1/2.
	const after = statsAt(at(100));
	expect(after[0]).toMatchObject({ answered: 6, blank: 0 });
	expect(after[1]).toMatchObject({ answered: 5, blank: 1 });
	expect(after[0]?.discrimination).toBeCloseTo(1 / 2, 10);
});

test("questionStats: an exam of one question has no discrimination", () => {
	const stats = cohortStats([["1"], ["1"], ["0"], ["0"], ["1"]], ["q1"]);

	expect(stats[0]).toMatchObject({
		discrimination: null,
		discriminationGap: "single-question",
	});
});

test("questionStats: when everyone scored the same the discrimination is no-variance", () => {
	const stats = cohortStats(Array.from({ length: 5 }, () => ["1", "1"]));

	for (const entry of stats) {
		expect(entry).toMatchObject({
			discrimination: null,
			discriminationGap: "no-variance",
		});
	}
});

//
// discrimination: pure
//

test("discrimination: the corrected item-total correlation matches a hand computation", () => {
	// Rows are attempts, columns q1..q3. For q1 (position 0):
	//   x    = [1, 1, 0, 0, 1]                  mean 0.6
	//   rest = [1, .5, .5, 0, .5]               mean 0.5 (mean of q2 and q3)
	//   dx   = [.4, .4, -.6, -.6, .4]
	//   dy   = [.5, 0, 0, -.5, 0]
	//   sum(dx*dy) = .2 + .3 = .5
	//   sum(dx^2)  = 3*.16 + 2*.36 = 1.2
	//   sum(dy^2)  = .25 + .25 = .5
	//   r = .5 / sqrt(1.2 * .5) = sqrt(5/12) = 0.6455
	// Correlating with the total that includes q1 would give 0.8807.
	const scores = [
		[1, 1, 1],
		[1, 1, 0],
		[0, 1, 0],
		[0, 0, 0],
		[1, 0, 1],
	];

	const result = discrimination(scores, 0);

	expect(result.gap).toBeNull();
	expect(result.value).toBeCloseTo(Math.sqrt(5 / 12), 10);
});

test("discrimination: a question that perfectly tracks the rest scores 1, and one that opposes it scores -1", () => {
	const together = [
		[1, 1],
		[1, 1],
		[1, 1],
		[0, 0],
		[0, 0],
	];
	const apart = [
		[1, 0],
		[1, 0],
		[1, 0],
		[0, 1],
		[0, 1],
	];

	expect(discrimination(together, 0).value).toBeCloseTo(1, 10);
	expect(discrimination(apart, 0).value).toBeCloseTo(-1, 10);
});

test("discrimination: negative scores take part in the correlation", () => {
	// q1 = [1, 0, -1, 0, 1], rest = q2: same ordering, so r = 1.
	const scores = [
		[1, 1],
		[0, 0],
		[-1, -1],
		[0, 0],
		[1, 1],
	];

	expect(discrimination(scores, 0).value).toBeCloseTo(1, 10);
});

test("discrimination: four attempts are too few and five are enough", () => {
	const rows = [
		[1, 1],
		[1, 1],
		[0, 0],
		[0, 1],
		[1, 0],
	];

	expect(discrimination(rows.slice(0, 4), 0)).toEqual({
		value: null,
		gap: "few-attempts",
	});
	expect(discrimination(rows, 0).gap).toBeNull();
});

test("discrimination: few attempts wins over a single question", () => {
	expect(discrimination([[1], [0]], 0)).toEqual({
		value: null,
		gap: "few-attempts",
	});
});

test("discrimination: rows of one score have no rest of the exam", () => {
	expect(discrimination([[1], [0], [1], [0], [1]], 0)).toEqual({
		value: null,
		gap: "single-question",
	});
});

test("discrimination: no variance in the question, or none in the rest, is a gap", () => {
	const flatQuestion = [
		[1, 1],
		[1, 0],
		[1, 1],
		[1, 0],
		[1, 1],
	];
	const flatRest = [
		[1, 1],
		[0, 1],
		[1, 1],
		[0, 1],
		[1, 1],
	];

	expect(discrimination(flatQuestion, 0)).toEqual({
		value: null,
		gap: "no-variance",
	});
	expect(discrimination(flatRest, 0)).toEqual({
		value: null,
		gap: "no-variance",
	});
});

test("discrimination: a position outside the rows throws a RangeError", () => {
	const rows = [
		[1, 1],
		[1, 0],
		[0, 1],
		[0, 0],
		[1, 1],
	];

	expect(() => discrimination(rows, 2)).toThrow(RangeError);
	expect(() => discrimination(rows, -1)).toThrow(RangeError);
});

//
// discriminationFlag
//

for (const [value, flag] of [
	[null, null],
	[-1, "error"],
	[-0.01, "error"],
	[0, "warning"],
	[0.19, "warning"],
	[0.2, null],
	[1, null],
] as const) {
	test(`discriminationFlag: ${value} earns ${flag}`, () => {
		expect(discriminationFlag(value)).toBe(flag);
	});
}

//
// answerDistribution
//

type Payload = Parameters<typeof answerDistribution>[1][number]["payload"];

function payloads(...list: Payload[]) {
	return list.map((payload) => ({ payload }));
}

/// Choices in an order that is neither alphabetical nor by frequency.
const FRUIT = multipleChoice({
	id: "fruit",
	stem: "Pick the best fruit.",
	choices: [
		{ id: "pear", text: "Pear", score: 1 },
		{ id: "apple", text: "Apple", score: 0.5 },
		{ id: "fig", text: "Fig", score: 0 },
		{ id: "kiwi", text: "Kiwi", score: -0.5 },
	],
});

test("answerDistribution: multiple choice lists each choice in statement order, then removed choices by id, then the empty row", () => {
	const answers = payloads(
		{ choice: "apple" },
		{ choice: "apple" },
		{ choice: "pear" },
		{ choice: "pear" },
		{ choice: "pear" },
		{ choice: "kiwi" },
		{ choice: "zz-old" },
		{ choice: "aa-old" },
		{ choice: "aa-old" },
		{ choice: "" },
		{ text: "wrong shape" },
	);

	expect(answerDistribution(FRUIT, answers)).toEqual({
		type: "multiple-choice",
		answers: 11,
		rows: [
			{ kind: "choice", id: "pear", text: "Pear", correct: true, count: 3 },
			{ kind: "choice", id: "apple", text: "Apple", correct: false, count: 2 },
			{ kind: "choice", id: "fig", text: "Fig", correct: false, count: 0 },
			{ kind: "choice", id: "kiwi", text: "Kiwi", correct: false, count: 1 },
			{ kind: "removed", id: "aa-old", count: 2 },
			{ kind: "removed", id: "zz-old", count: 1 },
			{ kind: "empty", count: 2 },
		],
	});
});

test("answerDistribution: multiple choice with no answers has every row at zero, the empty row included", () => {
	expect(answerDistribution(FRUIT, [])).toEqual({
		type: "multiple-choice",
		answers: 0,
		rows: [
			{ kind: "choice", id: "pear", text: "Pear", correct: true, count: 0 },
			{ kind: "choice", id: "apple", text: "Apple", correct: false, count: 0 },
			{ kind: "choice", id: "fig", text: "Fig", correct: false, count: 0 },
			{ kind: "choice", id: "kiwi", text: "Kiwi", correct: false, count: 0 },
			{ kind: "empty", count: 0 },
		],
	});
});

test("answerDistribution: multiple choice with no positive score marks no choice correct", () => {
	const nobodyScores = multipleChoice({
		id: "nobody",
		stem: "No key.",
		choices: [
			{ id: "a", text: "A", score: 0 },
			{ id: "b", text: "B", score: -1 },
		],
	});

	const result = answerDistribution(nobodyScores, payloads({ choice: "a" }));

	expect(
		result?.rows.map((row) => row.kind === "choice" && row.correct),
	).toEqual([false, false, false]);
});

test("answerDistribution: multiple selection counts each ticked choice, with removed choices and a none-selected row", () => {
	const letters = multipleSelection({
		id: "letters",
		stem: "Tick the vowels.",
		choices: [
			{ id: "x", text: "X", correct: true },
			{ id: "y", text: "Y" },
			{ id: "z", text: "Z", correct: true },
		],
	});
	const answers = payloads(
		{ choices: ["x", "z"] },
		{ choices: ["x"] },
		{ choices: ["x"] },
		{ choices: ["y", "gone"] },
		{ choices: [] },
		{ text: "wrong shape" },
	);

	expect(answerDistribution(letters, answers)).toEqual({
		type: "multiple-selection",
		answers: 6,
		rows: [
			{ kind: "choice", id: "x", text: "X", correct: true, count: 3 },
			{ kind: "choice", id: "y", text: "Y", correct: false, count: 1 },
			{ kind: "choice", id: "z", text: "Z", correct: true, count: 1 },
			{ kind: "removed", id: "gone", count: 1 },
			{ kind: "empty", count: 2 },
		],
	});
});

test("answerDistribution: true-false counts true, false and abstained per statement, and a removed statement abstains on every other answer", () => {
	const statements = trueFalse({
		id: "statements",
		stem: "Judge each one.",
		choices: [
			{ id: "s1", text: "First", correct: true },
			{ id: "s2", text: "Second", correct: false },
		],
	});
	const answers = payloads(
		{ answers: { s1: true, s2: false } },
		{ answers: { s1: true, s2: true } },
		{ answers: { s1: false } },
		{ answers: {} },
		{ text: "wrong shape" },
		{ answers: { s1: true, old: true } },
	);

	expect(answerDistribution(statements, answers)).toEqual({
		type: "true-false",
		answers: 6,
		rows: [
			{
				kind: "statement",
				id: "s1",
				text: "First",
				correct: true,
				true: 3,
				false: 1,
				abstained: 2,
			},
			{
				kind: "statement",
				id: "s2",
				text: "Second",
				correct: false,
				true: 1,
				false: 1,
				abstained: 4,
			},
			{ kind: "removed", id: "old", true: 1, false: 0, abstained: 5 },
		],
	});
});

test("answerDistribution: a true-false payload whose answers is an array abstains on every statement and adds no removed row", () => {
	const statements = trueFalse({
		id: "array-answers",
		stem: "Judge each one.",
		choices: [
			{ id: "s1", text: "First", correct: true },
			{ id: "s2", text: "Second", correct: false },
		],
	});

	const result = answerDistribution(
		statements,
		payloads({ answers: ["s1"] } as unknown as Payload),
	);

	expect(result?.rows).toEqual([
		{
			kind: "statement",
			id: "s1",
			text: "First",
			correct: true,
			true: 0,
			false: 0,
			abstained: 1,
		},
		{
			kind: "statement",
			id: "s2",
			text: "Second",
			correct: false,
			true: 0,
			false: 0,
			abstained: 1,
		},
	]);
});

for (const question of [
	idempotenceEssay,
	waterNumeric,
	capitalShortAnswer,
	brasiliaFillIn,
]) {
	test(`answerDistribution: a ${question.type} question has no distribution`, () => {
		expect(answerDistribution(question, [])).toBeNull();
	});
}

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
			"Blank",
			"Average",
			"Correct",
			"Discrimination",
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
			"0",
			"75%",
			"50%",
			/^—/,
			"1",
		]);
		await expect(cells("Title two")).toHaveText([
			"Title two",
			"2",
			"1",
			"25%",
			"0%",
			/^—/,
			"1",
		]);
		await expect(cells("Title three")).toHaveText([
			"Title three",
			"1",
			"2",
			"",
			"",
			/^—/,
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
