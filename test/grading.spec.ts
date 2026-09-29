import { expect, test } from "@playwright/test";
import fc from "fast-check";
import { score as scoreSchema, scoreValue } from "@/core/schemas/feedback";
import type { ExamTiming } from "@/services/exam-state";
import {
	answersTo,
	type CountingAnswer,
	countingAnswers,
	type GradingAttempt,
	type GradingFeedback,
	gradingQueue,
	parsePercentScore,
} from "@/services/grading";

const MINUTE = 60_000;

const T0 = new Date("2026-03-10T10:00:00Z");

/// `T0` shifted by `minutes`, so "later" reads as a bigger number.
function at(minutes: number): Date {
	return new Date(T0.getTime() + minutes * MINUTE);
}

/// The clock every case reads, well after everything in the fixtures.
const NOW = at(10_000);

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

/// An attempt its owner already closed.
function closedAttempt(
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
	overrides: Partial<GradingFeedback> = {},
): GradingFeedback {
	return {
		submission: submissionId,
		score,
		feedback: null,
		grader: "teacher",
		bot: null,
		updatedAt: at(minutes),
		...overrides,
	};
}

/// The counting answers of one closed attempt on an untimed, ongoing exam.
function answersOf(
	submissions: SubmissionRow[],
	feedback: GradingFeedback[] = [],
	questions = ["q1", "q2", "q3"],
): CountingAnswer[] {
	return countingAnswers(
		openExam(),
		questions,
		[closedAttempt("ana", submissions)],
		feedback,
		NOW,
	);
}

//
// countingAnswers: which attempts count
//

test("countingAnswers: the answer of a closed attempt carries its submission, question, author, payload and time", () => {
	const answers = answersOf([
		submission("s1", "q1", 5, { payload: { choice: "b" } }),
	]);

	expect(answers).toEqual([
		{
			submission: "s1",
			question: "q1",
			author: "ana",
			payload: { choice: "b" },
			createdAt: at(5),
			state: "pending",
			verdict: null,
			passes: [],
		},
	]);
});

test("countingAnswers: an attempt still accepting submissions before its deadline is left out", () => {
	const attempt = closedAttempt("ana", [submission("s1", "q1", 5)], {
		acceptingSubmissions: true,
	});

	expect(countingAnswers(openExam(), ["q1"], [attempt], [], NOW)).toEqual([]);
});

test("countingAnswers: answers of closed attempts are kept and answers of attempts in progress are dropped, side by side", () => {
	const done = closedAttempt("ana", [submission("s1", "q1", 5)]);
	const running = closedAttempt("bia", [submission("s2", "q1", 6)], {
		acceptingSubmissions: true,
	});

	const answers = countingAnswers(openExam(), ["q1"], [running, done], [], NOW);

	expect(answers.map((a) => a.submission)).toEqual(["s1"]);
});

/// A timed exam that each student starts on their own: 60 minutes from `attempt.createdAt`.
const perStudentClock = openExam({ duration: { hours: 1 } });

function startedAt0(): GradingAttempt {
	return closedAttempt("ana", [submission("s1", "q1", 5)], {
		createdAt: at(0),
		acceptingSubmissions: true,
	});
}

test("countingAnswers: an attempt whose deadline passed counts even though it still accepts submissions", () => {
	const answers = countingAnswers(
		perStudentClock,
		["q1"],
		[startedAt0()],
		[],
		at(61),
	);

	expect(answers.map((a) => a.submission)).toEqual(["s1"]);
});

test("countingAnswers: an attempt before its deadline does not count", () => {
	const answers = countingAnswers(
		perStudentClock,
		["q1"],
		[startedAt0()],
		[],
		at(30),
	);

	expect(answers).toEqual([]);
});

test("countingAnswers: an attempt at exactly its deadline is still in progress", () => {
	const answers = countingAnswers(
		perStudentClock,
		["q1"],
		[startedAt0()],
		[],
		at(60),
	);

	expect(answers).toEqual([]);
});

test("countingAnswers: every attempt counts once the exam window has closed, accepting submissions or not", () => {
	const completed = openExam({ status: "COMPLETED" });
	const running = closedAttempt("ana", [submission("s1", "q1", 5)], {
		acceptingSubmissions: true,
	});

	const answers = countingAnswers(completed, ["q1"], [running], [], NOW);

	expect(answers.map((a) => a.submission)).toEqual(["s1"]);
});

test("countingAnswers: a scheduled exam past its window closes the attempts of every student", () => {
	const scheduled = openExam({
		status: "ONGOING",
		scheduledAt: at(0),
		duration: { hours: 2 },
	});
	const running = closedAttempt("ana", [submission("s1", "q1", 5)], {
		acceptingSubmissions: true,
		createdAt: at(1),
	});

	expect(countingAnswers(scheduled, ["q1"], [running], [], at(100))).toEqual(
		[],
	);
	expect(
		countingAnswers(scheduled, ["q1"], [running], [], at(121)).map(
			(a) => a.submission,
		),
	).toEqual(["s1"]);
});

//
// countingAnswers: which submission counts
//

test("countingAnswers: a student who answered a question twice yields only the newest submission", () => {
	const answers = answersOf([
		submission("old", "q1", 5),
		submission("new", "q1", 9),
	]);

	expect(answers.map((a) => a.submission)).toEqual(["new"]);
});

test("countingAnswers: the newest submission wins whatever order the attempt lists them in", () => {
	const answers = answersOf([
		submission("new", "q1", 9),
		submission("old", "q1", 5),
	]);

	expect(answers.map((a) => a.submission)).toEqual(["new"]);
});

test("countingAnswers: the state of a question follows its newest submission, not an older graded one", () => {
	const answers = answersOf(
		[submission("old", "q1", 5), submission("new", "q1", 9)],
		[pass("old", "1", 20)],
	);

	expect(answers).toHaveLength(1);
	expect(answers[0]).toMatchObject({
		submission: "new",
		state: "pending",
		verdict: null,
		passes: [],
	});
});

test("countingAnswers: passes on an older, non-counting submission do not appear on the counting one", () => {
	const answers = answersOf(
		[submission("old", "q1", 5), submission("new", "q1", 9)],
		[pass("old", "0.25", 20), pass("new", "0.5", 21)],
	);

	expect(answers[0]?.submission).toBe("new");
	expect(answers[0]?.passes.map((p) => p.score)).toEqual([0.5]);
	expect(answers[0]?.verdict).toBe(0.5);
});

test("countingAnswers: two students answering the same question yield one answer each", () => {
	const answers = countingAnswers(
		openExam(),
		["q1"],
		[
			closedAttempt("ana", [submission("s1", "q1", 5)]),
			closedAttempt("bia", [submission("s2", "q1", 6)]),
		],
		[],
		NOW,
	);

	expect(answers.map((a) => [a.author, a.submission])).toEqual([
		["ana", "s1"],
		["bia", "s2"],
	]);
});

test("countingAnswers: one student answering different questions yields one answer per question", () => {
	const answers = answersOf([
		submission("s1", "q1", 5),
		submission("s2", "q2", 6),
	]);

	expect(answers.map((a) => a.question)).toEqual(["q1", "q2"]);
});

test("countingAnswers: a submission to a question outside the exam is ignored", () => {
	const answers = answersOf(
		[submission("s1", "gone", 5), submission("s2", "q1", 6)],
		[pass("s1", "1", 10)],
		["q1"],
	);

	expect(answers.map((a) => a.question)).toEqual(["q1"]);
});

test("countingAnswers: no attempts yields no answers", () => {
	expect(countingAnswers(openExam(), ["q1"], [], [], NOW)).toEqual([]);
});

test("countingAnswers: answers come oldest first across students, whatever order the attempts arrive in", () => {
	const answers = countingAnswers(
		openExam(),
		["q1", "q2"],
		[
			closedAttempt("bia", [
				submission("b2", "q2", 30),
				submission("b1", "q1", 10),
			]),
			closedAttempt("ana", [
				submission("a1", "q1", 20),
				submission("a2", "q2", 5),
			]),
		],
		[],
		NOW,
	);

	expect(answers.map((a) => a.submission)).toEqual(["a2", "b1", "a1", "b2"]);
});

//
// countingAnswers: state and verdict
//

test("countingAnswers: an answer with no pass is pending with a null verdict", () => {
	const answers = answersOf([submission("s1", "q1", 5)]);

	expect(answers[0]).toMatchObject({
		state: "pending",
		verdict: null,
		passes: [],
	});
});

test("countingAnswers: an answer with one pass is graded with that pass's score", () => {
	const answers = answersOf(
		[submission("s1", "q1", 5)],
		[pass("s1", "0.75", 9)],
	);

	expect(answers[0]).toMatchObject({ state: "graded", verdict: 0.75 });
});

const scoreStrings: Array<[string, number]> = [
	["0.75", 0.75],
	["1/2", 0.5],
	["1", 1],
	["0", 0],
	["-1", -1],
	["-1/4", -0.25],
];

for (const [text, value] of scoreStrings) {
	test(`countingAnswers: the verdict reads the score string "${text}" as ${value}`, () => {
		const answers = answersOf(
			[submission("s1", "q1", 5)],
			[pass("s1", text, 9)],
		);

		expect(answers[0]?.state).toBe("graded");
		expect(answers[0]?.verdict).toBeCloseTo(value, 10);
	});
}

test("countingAnswers: a zero score is graded, not pending", () => {
	const answers = answersOf([submission("s1", "q1", 5)], [pass("s1", "0", 9)]);

	expect(answers[0]).toMatchObject({ state: "graded", verdict: 0 });
});

test("countingAnswers: the verdict is the score of the pass with the newest updatedAt, not the best or the last listed", () => {
	const answers = answersOf(
		[submission("s1", "q1", 5)],
		[pass("s1", "1", 30), pass("s1", "1/2", 40), pass("s1", "0.25", 20)],
	);

	expect(answers[0]).toMatchObject({ state: "graded", verdict: 0.5 });
});

test("countingAnswers: a will-not-grade submission is not-graded with a null verdict", () => {
	const answers = answersOf([
		submission("s1", "q1", 5, { status: "WILL_NOT_GRADE" }),
	]);

	expect(answers[0]).toMatchObject({ state: "not-graded", verdict: null });
});

test("countingAnswers: a will-not-grade submission stays not-graded even with passes on it", () => {
	const answers = answersOf(
		[submission("s1", "q1", 5, { status: "WILL_NOT_GRADE" })],
		[pass("s1", "1", 9)],
	);

	expect(answers[0]).toMatchObject({ state: "not-graded", verdict: null });
	expect(answers[0]?.passes).toHaveLength(1);
});

test("countingAnswers: a submission marked graded manually is graded from its passes", () => {
	const answers = answersOf(
		[submission("s1", "q1", 5, { status: "GRADED_MANUALLY" })],
		[pass("s1", "0.5", 9)],
	);

	expect(answers[0]).toMatchObject({ state: "graded", verdict: 0.5 });
});

//
// countingAnswers: passes
//

test("countingAnswers: passes list newest first and carry grader, bot and time", () => {
	const answers = answersOf(
		[submission("s1", "q1", 5)],
		[
			pass("s1", "0.25", 10, { grader: "teacher", bot: null }),
			pass("s1", "0.5", 30, { grader: null, bot: "auto-grader" }),
			pass("s1", "1", 20, { grader: "assistant", bot: null }),
		],
	);

	expect(answers[0]?.passes).toEqual([
		{
			score: 0.5,
			comment: null,
			grader: null,
			bot: "auto-grader",
			updatedAt: at(30),
		},
		{
			score: 1,
			comment: null,
			grader: "assistant",
			bot: null,
			updatedAt: at(20),
		},
		{
			score: 0.25,
			comment: null,
			grader: "teacher",
			bot: null,
			updatedAt: at(10),
		},
	]);
});

const blankComments: Array<[string, string | null]> = [
	["null", null],
	["an empty string", ""],
	["spaces", "   "],
	["whitespace and newlines", " \n\t "],
];

for (const [label, blank] of blankComments) {
	test(`countingAnswers: a pass whose feedback is ${label} has a null comment`, () => {
		const answers = answersOf(
			[submission("s1", "q1", 5)],
			[pass("s1", "1", 9, { feedback: blank })],
		);

		expect(answers[0]?.passes[0]?.comment).toBeNull();
	});
}

test("countingAnswers: a pass with written feedback keeps it as its comment", () => {
	const answers = answersOf(
		[submission("s1", "q1", 5)],
		[pass("s1", "1", 9, { feedback: "Well argued." })],
	);

	expect(answers[0]?.passes[0]?.comment).toBe("Well argued.");
});

test("countingAnswers: passes on a submission nobody counts do not leak onto other answers", () => {
	const answers = answersOf(
		[submission("s1", "q1", 5), submission("s2", "q2", 6)],
		[pass("s1", "1", 9)],
	);

	expect(answers.find((a) => a.question === "q2")).toMatchObject({
		state: "pending",
		passes: [],
	});
});

//
// countingAnswers: independence from input order
//

test("countingAnswers: the result does not depend on the order of the attempts, submissions or passes", () => {
	const attempts = [
		closedAttempt("ana", [
			submission("a1", "q1", 10),
			submission("a1b", "q1", 12),
			submission("a2", "q2", 20),
		]),
		closedAttempt("bia", [
			submission("b1", "q1", 11),
			submission("b2", "q2", 21, { status: "WILL_NOT_GRADE" }),
		]),
		closedAttempt("cai", [submission("c1", "q1", 13)], {
			acceptingSubmissions: true,
		}),
	];
	const feedback = [
		pass("a1b", "0.5", 40),
		pass("a1b", "0.75", 41),
		pass("a2", "1", 42),
		pass("b1", "0", 43),
	];
	const expected = countingAnswers(
		openExam(),
		["q1", "q2"],
		attempts,
		feedback,
		NOW,
	);
	expect(expected.map((a) => a.submission)).toEqual(["b1", "a1b", "a2", "b2"]);

	fc.assert(
		fc.property(
			fc.shuffledSubarray(attempts, {
				minLength: attempts.length,
				maxLength: attempts.length,
			}),
			fc.shuffledSubarray(feedback, {
				minLength: feedback.length,
				maxLength: feedback.length,
			}),
			(shuffledAttempts, shuffledFeedback) => {
				const shuffled = shuffledAttempts.map((attempt) => ({
					...attempt,
					submissions: [...attempt.submissions].reverse(),
				}));
				expect(
					countingAnswers(
						openExam(),
						["q1", "q2"],
						shuffled,
						shuffledFeedback,
						NOW,
					),
				).toEqual(expected);
			},
		),
	);
});

//
// gradingQueue
//

function answer(
	question: string,
	state: CountingAnswer["state"],
	minutes: number,
	author = "ana",
): CountingAnswer {
	return {
		submission: `${author}-${question}-${minutes}`,
		question,
		author,
		payload: {},
		createdAt: at(minutes),
		state,
		verdict: state === "graded" ? 1 : null,
		passes: [],
	};
}

test("gradingQueue: one entry per question, in the order given", () => {
	const queue = gradingQueue(["c", "a", "b"], []);

	expect(queue.map((entry) => entry.question)).toEqual(["c", "a", "b"]);
});

test("gradingQueue: a question nobody answered has every count at zero", () => {
	expect(gradingQueue(["q1"], [])).toEqual([
		{ question: "q1", pending: 0, graded: 0, notGraded: 0 },
	]);
});

test("gradingQueue: counts pending, graded and not-graded answers per question", () => {
	const answers = [
		answer("q1", "pending", 1, "ana"),
		answer("q1", "pending", 2, "bia"),
		answer("q1", "pending", 3, "cai"),
		answer("q1", "graded", 4, "dan"),
		answer("q1", "not-graded", 5, "eva"),
		answer("q2", "graded", 6, "ana"),
		answer("q2", "graded", 7, "bia"),
	];

	expect(gradingQueue(["q1", "q2", "q3"], answers)).toEqual([
		{ question: "q1", pending: 3, graded: 1, notGraded: 1 },
		{ question: "q2", pending: 0, graded: 2, notGraded: 0 },
		{ question: "q3", pending: 0, graded: 0, notGraded: 0 },
	]);
});

test("gradingQueue: over any mix of states the counts of a question add up to its answers", () => {
	const states: CountingAnswer["state"][] = ["pending", "graded", "not-graded"];

	fc.assert(
		fc.property(
			fc.array(fc.constantFrom(...states), { maxLength: 30 }),
			(mix) => {
				const answers = mix.map((state, i) => answer("q1", state, i, `u${i}`));
				const [entry] = gradingQueue(["q1"], answers);

				expect(entry?.pending).toBe(mix.filter((s) => s === "pending").length);
				expect(entry?.graded).toBe(mix.filter((s) => s === "graded").length);
				expect(entry?.notGraded).toBe(
					mix.filter((s) => s === "not-graded").length,
				);
			},
		),
	);
});

//
// answersTo
//

test("answersTo: pending answers of the question go to pending, graded and not-graded ones to resolved", () => {
	const answers = [
		answer("q1", "pending", 1, "ana"),
		answer("q1", "graded", 2, "bia"),
		answer("q1", "not-graded", 3, "cai"),
		answer("q1", "pending", 4, "dan"),
	];

	const { pending, resolved } = answersTo("q1", answers);

	expect(pending.map((a) => a.author)).toEqual(["ana", "dan"]);
	expect(resolved.map((a) => a.author)).toEqual(["bia", "cai"]);
});

test("answersTo: answers to other questions are excluded", () => {
	const answers = [
		answer("q1", "pending", 1, "ana"),
		answer("q2", "pending", 2, "bia"),
		answer("q2", "graded", 3, "cai"),
		answer("q3", "not-graded", 4, "dan"),
	];

	const { pending, resolved } = answersTo("q1", answers);

	expect(pending.map((a) => a.author)).toEqual(["ana"]);
	expect(resolved).toEqual([]);
});

test("answersTo: both lists are oldest first", () => {
	const answers = [
		answer("q1", "pending", 1, "ana"),
		answer("q1", "graded", 2, "bia"),
		answer("q1", "pending", 3, "cai"),
		answer("q1", "not-graded", 4, "dan"),
		answer("q1", "graded", 5, "eva"),
	];

	const { pending, resolved } = answersTo("q1", answers);

	expect(pending.map((a) => a.createdAt)).toEqual([at(1), at(3)]);
	expect(resolved.map((a) => a.createdAt)).toEqual([at(2), at(4), at(5)]);
});

test("answersTo: a question with no answers yields two empty lists", () => {
	expect(answersTo("q1", [])).toEqual({ pending: [], resolved: [] });
});

//
// parsePercentScore
//

const percentCases: Array<[string, string]> = [
	["0", "0"],
	["75", "0.75"],
	["100", "1"],
	[" 50 ", "0.5"],
	["7", "0.07"],
	["\t25\n", "0.25"],
];

for (const [text, expected] of percentCases) {
	test(`parsePercentScore: ${JSON.stringify(text)} becomes ${JSON.stringify(expected)}`, () => {
		expect(parsePercentScore(text)).toBe(expected);
	});
}

const notPercentages = ["101", "-5", "7.5", "", "   ", "abc", "1e2", "50%"];

for (const text of notPercentages) {
	test(`parsePercentScore: ${JSON.stringify(text)} is refused with null`, () => {
		expect(parsePercentScore(text)).toBeNull();
	});
}

test("parsePercentScore: every whole percentage from 0 to 100 yields a stored score of the same value", () => {
	for (let percent = 0; percent <= 100; percent++) {
		const result = parsePercentScore(String(percent));

		expect(result, `percent ${percent}`).not.toBeNull();
		const parsed = scoreSchema.safeParse(result);
		expect(parsed.success, `"${result}" for ${percent}`).toBe(true);
		const value = scoreValue(result as string);
		expect(value, `"${result}" for ${percent}`).not.toBeNull();
		expect(Math.abs((value as number) * 100 - percent)).toBeLessThan(1e-9);
	}
});

test("parsePercentScore: surrounding whitespace never changes the result", () => {
	fc.assert(
		fc.property(
			fc.integer({ min: 0, max: 100 }),
			fc.constantFrom("", " ", "  ", "\t", "\n"),
			fc.constantFrom("", " ", "  ", "\t", "\n"),
			(percent, before, after) => {
				expect(parsePercentScore(`${before}${percent}${after}`)).toBe(
					parsePercentScore(String(percent)),
				);
			},
		),
	);
});

test("parsePercentScore: integers above 100 are refused", () => {
	fc.assert(
		fc.property(fc.integer({ min: 101, max: 100_000 }), (n) => {
			expect(parsePercentScore(String(n))).toBeNull();
		}),
	);
});
