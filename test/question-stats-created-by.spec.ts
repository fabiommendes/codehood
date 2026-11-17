import { expect, test } from "@playwright/test";
import { capitalChoice } from "@/mdq/fixtures";
import type { ExamTiming } from "@/services/exam-state";
import type { GradingAttempt, GradingFeedback } from "@/services/grading";
import {
	answerDistribution,
	measuredAttempts,
	questionStats,
} from "@/services/question-stats";

// What the instructor created (an empty attempt, a submission that holds a grade) is a decision, not a measure
// of the question: statistics leave it out. A grade changed over the student's real answer stays in.

const TEACHER = "teacher";
const MINUTE = 60_000;
const T0 = new Date("2026-03-10T10:00:00Z");

/// `T0` shifted by `minutes`, so "later" reads as a bigger number.
const at = (minutes: number) => new Date(T0.getTime() + minutes * MINUTE);

/// The clock every case reads, well after everything in the fixtures.
const NOW = at(10_000);

/// An untimed exam being answered: attempts only close when their owner closes them.
const EXAM: ExamTiming = {
	type: "EXAM",
	status: "ONGOING",
	scheduledAt: null,
	duration: null,
	extraTime: null,
};

const QUESTIONS = ["q1", "q2"];

type SubmissionRow = GradingAttempt["submissions"][number];

let nextId = 1;

/// A submission of the student's own, or of the instructor's when `createdBy` is set.
function submission(
	publicId: string,
	question: string,
	createdBy: string | null = null,
): SubmissionRow {
	return {
		id: nextId++ as SubmissionRow["id"],
		publicId,
		responseId: 1 as SubmissionRow["responseId"],
		questionId: 1 as SubmissionRow["questionId"],
		response: "response-1",
		question,
		status: createdBy ? "GRADED_MANUALLY" : "PENDING_GRADE",
		kind: "AUTOSAVE",
		automaticallyTriggered: false,
		payload: createdBy ? null : { answer: publicId },
		createdBy,
		startedAt: null,
		createdAt: at(1),
	};
}

/// A closed attempt of `author`; `createdBy` marks one the instructor made.
function attempt(
	author: string,
	submissions: SubmissionRow[],
	createdBy: string | null = null,
): GradingAttempt {
	return {
		publicId: `attempt-${author}`,
		author,
		createdAt: at(-60),
		acceptingSubmissions: false,
		submissions,
		createdBy,
	};
}

/// A pass by an instructor.
function pass(submissionId: string, score: string): GradingFeedback {
	return {
		submission: submissionId,
		score,
		feedback: null,
		grader: TEACHER,
		bot: null,
		updatedAt: at(2),
	};
}

/// An attempt of `author` answering both questions, scored `s1` and `s2`, with the passes that grade them.
function student(author: string, s1: string, s2: string) {
	const answers = [
		submission(`${author}-q1`, "q1"),
		submission(`${author}-q2`, "q2"),
	];
	return {
		attempt: attempt(author, answers),
		feedback: [pass(`${author}-q1`, s1), pass(`${author}-q2`, s2)],
	};
}

/// Six students whose scores vary on both questions, enough for a discrimination index.
const CLASS = [
	student("a", "1", "1"),
	student("b", "1", "0"),
	student("c", "0", "1"),
	student("d", "0", "0"),
	student("e", "1", "1"),
	student("f", "0", "0"),
];

const classAttempts = () => CLASS.map((s) => s.attempt);
const classFeedback = () => CLASS.flatMap((s) => s.feedback);

function statsOf(attempts: GradingAttempt[], feedback: GradingFeedback[]) {
	return questionStats(EXAM, QUESTIONS, attempts, feedback, NOW);
}

/// What the class alone yields.
const baseline = () => statsOf(classAttempts(), classFeedback());

test("the baseline has numbers worth protecting", () => {
	const [first] = baseline();

	expect(first).toMatchObject({ answered: 6, blank: 0 });
	expect(first?.discrimination).not.toBeNull();
});

//
// questionStats
//

test("questionStats: an attempt the instructor created is out of answered, blank, correct and discrimination", () => {
	const empty = attempt(
		"nobody",
		[
			submission("nobody-q1", "q1", TEACHER),
			submission("nobody-q2", "q2", TEACHER),
		],
		TEACHER,
	);
	const feedback = [pass("nobody-q1", "1"), pass("nobody-q2", "1")];

	expect(
		statsOf([...classAttempts(), empty], [...classFeedback(), ...feedback]),
	).toEqual(baseline());
});

test("questionStats: an empty attempt with no submissions at all, made by the instructor, is not a blank", () => {
	const empty = attempt("nobody", [], TEACHER);

	expect(statsOf([...classAttempts(), empty], classFeedback())).toEqual(
		baseline(),
	);
});

test("questionStats: alone, an attempt the instructor created measures nothing", () => {
	const empty = attempt(
		"nobody",
		[submission("nobody-q1", "q1", TEACHER)],
		TEACHER,
	);

	expect(statsOf([empty], [pass("nobody-q1", "1")])).toEqual(statsOf([], []));
});

test("questionStats: a submission the instructor created inside a student's attempt leaves answered, correct and the population", () => {
	const answered = [submission("g-q2", "q2")];
	const withGrade = attempt("g", [
		submission("g-q1", "q1", TEACHER),
		...answered,
	]);
	const withoutGrade = attempt("g", answered);
	const feedback = [pass("g-q2", "1")];

	const stats = statsOf(
		[...classAttempts(), withGrade],
		[...classFeedback(), ...feedback, pass("g-q1", "1")],
	);

	expect(stats).toEqual(
		statsOf(
			[...classAttempts(), withoutGrade],
			[...classFeedback(), ...feedback],
		),
	);
	expect(stats[0]).toMatchObject({ answered: 6, graded: 6, blank: 1 });
});

test("questionStats: a student's attempt with no submissions is still a blank", () => {
	const idle = attempt("idle", []);

	const [first] = statsOf([...classAttempts(), idle], classFeedback());

	expect(first).toMatchObject({ answered: 6, blank: 1 });
});

test("questionStats: a grade the instructor set over a real answer still counts in correct", () => {
	const real = attempt("r", [submission("r-q1", "q1")]);

	const [first] = statsOf([real], [pass("r-q1", "1")]);

	expect(first).toMatchObject({ answered: 1, graded: 1, correct: 1 });
});

//
// measuredAttempts
//

test("measuredAttempts: drops the attempts the instructor created and the submissions the instructor created", () => {
	const kept = submission("k-q1", "q1");
	const held = submission("k-q2", "q2", TEACHER);
	const mixed = attempt("k", [kept, held]);
	const made = attempt("m", [submission("m-q1", "q1", TEACHER)], TEACHER);
	const idle = attempt("i", []);
	const input = [mixed, made, idle];

	const measured = measuredAttempts(input);

	expect(measured.map((a) => a.author)).toEqual(["k", "i"]);
	expect(measured[0]?.submissions.map((s) => s.publicId)).toEqual(["k-q1"]);
	expect(measured[1]?.submissions).toEqual([]);
});

test("measuredAttempts: leaves its input as it was", () => {
	const mixed = attempt("k", [
		submission("k-q1", "q1"),
		submission("k-q2", "q2", TEACHER),
	]);
	const input = [mixed, attempt("m", [], TEACHER)];

	measuredAttempts(input);

	expect(input).toHaveLength(2);
	expect(mixed.submissions.map((s) => s.publicId)).toEqual(["k-q1", "k-q2"]);
});

test("measuredAttempts: keeps everything of a class with nothing the instructor created", () => {
	expect(measuredAttempts(classAttempts())).toEqual(classAttempts());
});

//
// answerDistribution
//

test("answerDistribution: an answer the instructor created is not counted, not even as empty", () => {
	const distribution = answerDistribution(capitalChoice, [
		{ payload: "brasilia" },
		{ payload: "rio", createdBy: undefined },
		{ payload: null, createdBy: TEACHER },
	]);

	expect(distribution).toMatchObject({ type: "multiple-choice", answers: 2 });
	const rows = distribution?.rows ?? [];
	expect(rows.find((row) => row.kind === "empty")).toEqual({
		kind: "empty",
		count: 0,
	});
});
