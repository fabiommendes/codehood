import { expect, test } from "@playwright/test";
import fc from "fast-check";
import {
	examResult,
	formatScore,
	type ResultSanction,
	unweighted,
} from "@/services/exam-result";

const T0 = new Date("2026-03-10T10:00:00Z");

/// `T0` shifted by `minutes`, so "later" reads as a bigger number.
function at(minutes: number): Date {
	return new Date(T0.getTime() + minutes * 60_000);
}

function submission(publicId: string, question: string, minutes: number) {
	return { publicId, question, createdAt: at(minutes) };
}

function feedback(
	submissionId: string,
	score: string,
	minutes: number,
	text: string | null = null,
) {
	return {
		submission: submissionId,
		score,
		feedback: text,
		updatedAt: at(minutes),
	};
}

//
// examResult: one outcome per question
//

test("examResult: one outcome per question slug, in the order given", () => {
	const result = examResult(unweighted(["c", "a", "b"]), [], [], []);

	expect(result.questions.map((q) => q.question)).toEqual(["c", "a", "b"]);
});

test("examResult: a question with feedback on its answer is graded with that score", () => {
	const result = examResult(
		unweighted(["q1"]),
		[submission("s1", "q1", 0)],
		[feedback("s1", "1", 5)],
		[],
	);

	expect(result.questions).toEqual([
		{
			question: "q1",
			submission: "s1",
			status: "graded",
			score: 1,
			comments: [],
		},
	]);
});

const scoreStrings: Array<[string, number]> = [
	["1", 1],
	["0", 0],
	["0.5", 0.5],
	["3/4", 0.75],
	["-1", -1],
	["-1/3", -1 / 3],
	["1/3", 1 / 3],
];

for (const [text, value] of scoreStrings) {
	test(`examResult: score string "${text}" becomes the number ${value}`, () => {
		const result = examResult(
			unweighted(["q1"]),
			[submission("s1", "q1", 0)],
			[feedback("s1", text, 5)],
			[],
		);

		expect(result.questions[0]?.status).toBe("graded");
		expect(result.questions[0]?.score).toBeCloseTo(value, 10);
	});
}

test("examResult: an answered question without feedback is pending, with a null score, never zero", () => {
	const result = examResult(
		unweighted(["q1"]),
		[submission("s1", "q1", 0)],
		[],
		[],
	);

	expect(result.questions).toEqual([
		{
			question: "q1",
			submission: "s1",
			status: "pending",
			score: null,
			comments: [],
		},
	]);
});

test("examResult: a question with no submission is unanswered with a null score", () => {
	const result = examResult(unweighted(["q1"]), [], [], []);

	expect(result.questions).toEqual([
		{ question: "q1", status: "unanswered", score: null, comments: [] },
	]);
});

test("examResult: feedback on a submission to another question does not grade this one", () => {
	const result = examResult(
		unweighted(["q1", "q2"]),
		[submission("s1", "q1", 0), submission("s2", "q2", 1)],
		[feedback("s1", "1", 5)],
		[],
	);

	expect(result.questions.map((q) => q.status)).toEqual(["graded", "pending"]);
});

//
// The submission that counts, and the verdict on it
//

test("examResult: each outcome names the counting submission, the newest of its question, and none when unanswered", () => {
	const result = examResult(
		unweighted(["q1", "q2", "q3"]),
		[
			submission("old", "q1", 0),
			submission("new", "q1", 10),
			submission("only", "q2", 5),
		],
		[feedback("old", "1", 20)],
		[],
	);

	expect(result.questions.map((q) => q.submission)).toEqual([
		"new",
		"only",
		undefined,
	]);
});

test("examResult: the newest submission of a question is the one that counts", () => {
	const result = examResult(
		unweighted(["q1"]),
		[submission("old", "q1", 0), submission("new", "q1", 10)],
		[feedback("old", "0", 20), feedback("new", "1", 15)],
		[],
	);

	expect(result.questions[0]?.score).toBe(1);
});

test("examResult: the newest submission counts whatever order submissions arrive in", () => {
	const result = examResult(
		unweighted(["q1"]),
		[submission("new", "q1", 10), submission("old", "q1", 0)],
		[feedback("old", "0", 20), feedback("new", "1", 15)],
		[],
	);

	expect(result.questions[0]?.score).toBe(1);
});

test("examResult: feedback on an older submission is ignored, leaving the newer answer pending", () => {
	const result = examResult(
		unweighted(["q1"]),
		[submission("old", "q1", 0), submission("new", "q1", 10)],
		[feedback("old", "1", 20, "Well done")],
		[],
	);

	expect(result.questions).toEqual([
		{
			question: "q1",
			submission: "new",
			status: "pending",
			score: null,
			comments: [],
		},
	]);
});

test("examResult: among several passes on the counting submission, the newest by updatedAt is the verdict", () => {
	const result = examResult(
		unweighted(["q1"]),
		[submission("s1", "q1", 0)],
		[
			feedback("s1", "0", 5),
			feedback("s1", "3/4", 30),
			feedback("s1", "1", 10),
		],
		[],
	);

	expect(result.questions[0]?.score).toBe(0.75);
});

test("examResult: the verdict does not depend on the order feedback arrives in", () => {
	const passes = [
		feedback("s1", "0", 5),
		feedback("s1", "3/4", 30),
		feedback("s1", "1", 10),
	];

	const forward = examResult(
		unweighted(["q1"]),
		[submission("s1", "q1", 0)],
		passes,
		[],
	);
	const backward = examResult(
		unweighted(["q1"]),
		[submission("s1", "q1", 0)],
		[...passes].reverse(),
		[],
	);

	expect(backward).toEqual(forward);
});

//
// Comments
//

test("examResult: comments are every non-empty feedback text on the counting submission, newest first", () => {
	const result = examResult(
		unweighted(["q1"]),
		[submission("s1", "q1", 0)],
		[
			feedback("s1", "0", 5, "First pass"),
			feedback("s1", "1", 30, "Latest pass"),
			feedback("s1", "0.5", 10, "Middle pass"),
		],
		[],
	);

	expect(result.questions[0]?.comments).toEqual([
		"Latest pass",
		"Middle pass",
		"First pass",
	]);
});

test("examResult: null and empty feedback texts are not comments", () => {
	const result = examResult(
		unweighted(["q1"]),
		[submission("s1", "q1", 0)],
		[
			feedback("s1", "0", 5, null),
			feedback("s1", "0.5", 10, ""),
			feedback("s1", "1", 15, "Kept"),
		],
		[],
	);

	expect(result.questions[0]?.comments).toEqual(["Kept"]);
});

test("examResult: comments on an older submission of the question are left out", () => {
	const result = examResult(
		unweighted(["q1"]),
		[submission("old", "q1", 0), submission("new", "q1", 10)],
		[
			feedback("old", "0", 5, "About the old answer"),
			feedback("new", "1", 15, "About the new one"),
		],
		[],
	);

	expect(result.questions[0]?.comments).toEqual(["About the new one"]);
});

//
// Total
//

test("examResult: total is the mean of the graded scores", () => {
	const result = examResult(
		unweighted(["q1", "q2"]),
		[submission("s1", "q1", 0), submission("s2", "q2", 1)],
		[feedback("s1", "1", 5), feedback("s2", "0.5", 5)],
		[],
	);

	expect(result.total).toBeCloseTo(0.75, 10);
});

test("examResult: an unanswered question counts as zero in the total but keeps a null score", () => {
	const result = examResult(
		unweighted(["q1", "q2", "q3"]),
		[submission("s1", "q1", 0), submission("s2", "q2", 1)],
		[feedback("s1", "1", 5), feedback("s2", "1", 5)],
		[],
	);

	expect(result.questions[2]?.score).toBeNull();
	expect(result.total).toBeCloseTo(2 / 3, 10);
});

test("examResult: a negative score pulls the total down", () => {
	const result = examResult(
		unweighted(["q1", "q2"]),
		[submission("s1", "q1", 0), submission("s2", "q2", 1)],
		[feedback("s1", "1", 5), feedback("s2", "-1", 5)],
		[],
	);

	expect(result.total).toBeCloseTo(0, 10);
});

test("examResult: total is null while any answered question is pending", () => {
	const result = examResult(
		unweighted(["q1", "q2"]),
		[submission("s1", "q1", 0), submission("s2", "q2", 1)],
		[feedback("s1", "1", 5)],
		[],
	);

	expect(result.total).toBeNull();
});

test("examResult: total is null with a pending question even beside an unanswered one", () => {
	const result = examResult(
		unweighted(["q1", "q2"]),
		[submission("s1", "q1", 0)],
		[],
		[],
	);

	expect(result.total).toBeNull();
});

test("examResult: an exam nobody answered totals zero, not null", () => {
	const result = examResult(unweighted(["q1", "q2"]), [], [], []);

	expect(result.total).toBe(0);
});

test("examResult: an exam with no questions has no outcomes and a null total", () => {
	const result = examResult(unweighted([]), [], [], []);

	expect(result).toEqual({ questions: [], total: null, pending: 0 });
});

test("examResult: total is the mean of every question's score over the whole exam (property)", () => {
	// Quarters from -1 to 1; `null` means the student left the question blank.
	const quarter = fc.option(fc.integer({ min: -4, max: 4 }), { nil: null });

	fc.assert(
		fc.property(fc.array(quarter, { minLength: 1, maxLength: 8 }), (marks) => {
			const slugs = marks.map((_, i) => `q${i}`);
			const submissions = marks.flatMap((mark, i) =>
				mark === null ? [] : [submission(`s${i}`, `q${i}`, i)],
			);
			const grades = marks.flatMap((mark, i) =>
				mark === null ? [] : [feedback(`s${i}`, `${mark}/4`, i)],
			);

			const result = examResult(unweighted(slugs), submissions, grades, []);

			const expected =
				marks.reduce<number>((sum, mark) => sum + (mark ?? 0) / 4, 0) /
				marks.length;
			expect(result.total).toBeCloseTo(expected, 10);
		}),
	);
});

//
// formatScore
//

const percentages: Array<[number, string]> = [
	[0.833, "83%"],
	[1, "100%"],
	[0, "0%"],
	[0.5, "50%"],
	[0.005, "1%"],
	[0.004, "0%"],
	[0.125, "13%"],
	[2 / 3, "67%"],
	[-0.5, "-50%"],
	[-1, "-100%"],
	[-1 / 3, "-33%"],
	[-0.125, "-13%"],
	[-0.005, "-1%"],
];

for (const [score, text] of percentages) {
	test(`formatScore: ${score} is "${text}"`, () => {
		expect(formatScore(score)).toBe(text);
	});
}

//
// examResult: weights
//

/// An answered, graded question per `[slug, weight, score]`, in the given order.
function weighted(rows: Array<[string, number, string | null]>) {
	return examResult(
		rows.map(([slug, weight]) => ({ slug, weight })),
		rows.flatMap(([slug, , score], i) =>
			score === null ? [] : [submission(`s${i}`, slug, i)],
		),
		rows.flatMap(([, , score], i) =>
			score === null ? [] : [feedback(`s${i}`, score, i)],
		),
		[],
	);
}

test("examResult: the total weighs each question's score by its weight", () => {
	const result = weighted([
		["q1", 3, "1"],
		["q2", 1, "0"],
	]);

	expect(result.total).toBeCloseTo(0.75, 10);
});

test("examResult: an unanswered question counts zero but keeps its weight in the denominator", () => {
	const result = weighted([
		["q1", 3, "1"],
		["q2", 1, null],
	]);

	expect(result.total).toBeCloseTo(0.75, 10);
});

test("examResult: a weight of zero leaves the question out of the total", () => {
	const result = weighted([
		["q1", 0, "0"],
		["q2", 2, "1"],
	]);

	expect(result.total).toBe(1);
});

test("examResult: weights that sum to zero total zero", () => {
	const result = weighted([
		["q1", 0, "1"],
		["q2", 0, "1"],
	]);

	expect(result.total).toBe(0);
});

test("examResult: a pending question nulls the weighted total", () => {
	const result = examResult(
		[
			{ slug: "q1", weight: 3 },
			{ slug: "q2", weight: 1 },
		],
		[submission("s1", "q1", 0)],
		[],
		[],
	);

	expect(result.total).toBeNull();
});

test("examResult: equal weights give the plain mean", () => {
	const result = weighted([
		["q1", 2, "1"],
		["q2", 2, "0"],
		["q3", 2, "1/2"],
	]);

	expect(result.total).toBeCloseTo(0.5, 10);
});

//
// examResult: sanctions
//

/// A sanction on `question`, or on the whole exam when `question` is `null`.
function sanction(
	question: string | null,
	factor: string,
	reason: string | null = null,
): ResultSanction {
	return { question, factor, reason };
}

test("examResult: a zeroed question scores 0 and is sanctioned even without a grade", () => {
	const result = examResult(
		unweighted(["q1"]),
		[submission("s1", "q1", 0)],
		[],
		[sanction("q1", "0")],
	);

	expect(result.questions[0]).toMatchObject({
		status: "sanctioned",
		score: 0,
	});
	expect(result.pending).toBe(0);
	expect(result.total).not.toBeNull();
});

test("examResult: a reduced question without a grade stays pending", () => {
	const result = examResult(
		unweighted(["q1"]),
		[submission("s1", "q1", 0)],
		[],
		[sanction("q1", "0.5")],
	);

	expect(result.questions[0]).toMatchObject({
		status: "pending",
		score: null,
		sanction: { factor: 0.5 },
	});
	expect(result.total).toBeNull();
	expect(result.pending).toBe(1);
});

test("examResult: a reduced graded question scores original times factor", () => {
	const result = examResult(
		unweighted(["q1"]),
		[submission("s1", "q1", 0)],
		[feedback("s1", "0.8", 5)],
		[sanction("q1", "0.5")],
	);

	expect(result.questions[0]?.status).toBe("sanctioned");
	expect(result.questions[0]?.score).toBeCloseTo(0.4, 10);
});

test("examResult: a newer grading pass does not undo a zeroed question", () => {
	const result = examResult(
		unweighted(["q1"]),
		[submission("s1", "q1", 0)],
		[feedback("s1", "0.8", 5), feedback("s1", "1", 30)],
		[sanction("q1", "0")],
	);

	expect(result.questions[0]).toMatchObject({
		status: "sanctioned",
		score: 0,
		sanction: { original: { status: "graded", score: 1 } },
	});
});

test("examResult: a negative score is not multiplied", () => {
	const questions = unweighted(["q1"]);
	const submissions = [submission("s1", "q1", 0)];
	const grades = [feedback("s1", "-0.5", 5)];

	const halved = examResult(questions, submissions, grades, [
		sanction("q1", "0.5"),
	]);
	const zeroed = examResult(questions, submissions, grades, [
		sanction("q1", "0"),
	]);

	expect(halved.questions[0]).toMatchObject({
		status: "sanctioned",
		score: -0.5,
	});
	expect(zeroed.questions[0]).toMatchObject({
		status: "sanctioned",
		score: -0.5,
	});
});

test("examResult: the outcome keeps the original status, score, submission, blanks and comments", () => {
	const blanks = { plateau: { score: 0.5, comment: "Close enough." } };
	const result = examResult(
		unweighted(["q1"]),
		[submission("s1", "q1", 0)],
		[{ ...feedback("s1", "0.8", 5, "Nice try"), blanks }],
		[sanction("q1", "0", "cola")],
	);

	expect(result.questions[0]).toMatchObject({
		question: "q1",
		submission: "s1",
		status: "sanctioned",
		score: 0,
		blanks,
		comments: ["Nice try"],
		sanction: {
			factor: 0,
			reason: "cola",
			original: { status: "graded", score: 0.8 },
		},
	});
});

test("examResult: an exam sanction multiplies the total", () => {
	const result = examResult(
		unweighted(["q1"]),
		[submission("s1", "q1", 0)],
		[feedback("s1", "0.8", 5)],
		[sanction(null, "0.5", "atraso")],
	);

	expect(result.total).toBeCloseTo(0.4, 10);
	expect(result.sanction).toMatchObject({
		factor: 0.5,
		reason: "atraso",
	});
	expect(result.sanction?.original.total).toBeCloseTo(0.8, 10);
});

test("examResult: an exam zeroed with pending questions totals 0 with nothing pending", () => {
	const result = examResult(
		unweighted(["q1"]),
		[submission("s1", "q1", 0)],
		[],
		[sanction(null, "0")],
	);

	expect(result.total).toBe(0);
	expect(result.pending).toBe(0);
	expect(result.questions[0]?.status).toBe("pending");
});

test("examResult: an exam reduced with a pending question has a null total", () => {
	const result = examResult(
		unweighted(["q1"]),
		[submission("s1", "q1", 0)],
		[],
		[sanction(null, "0.5")],
	);

	expect(result.total).toBeNull();
	expect(result.pending).toBe(1);
	expect(result.sanction?.original.total).toBeNull();
});

test("examResult: a negative total is not multiplied by the exam factor", () => {
	const result = examResult(
		unweighted(["q1"]),
		[submission("s1", "q1", 0)],
		[feedback("s1", "-0.4", 5)],
		[sanction(null, "0")],
	);

	expect(result.total).toBeCloseTo(-0.4, 10);
	expect(result.sanction).toMatchObject({ factor: 0 });
});

test("examResult: question and exam sanctions compose", () => {
	const result = examResult(
		unweighted(["q1", "q2"]),
		[submission("s1", "q1", 0), submission("s2", "q2", 1)],
		[feedback("s1", "1", 5), feedback("s2", "1", 5)],
		[sanction("q2", "0"), sanction(null, "0.5")],
	);

	expect(result.total).toBeCloseTo(0.25, 10);
	expect(result.sanction?.original.total).toBeCloseTo(0.5, 10);
});

test("examResult: a sanction on a question not in the exam is ignored", () => {
	const questions = unweighted(["q1"]);
	const submissions = [submission("s1", "q1", 0)];
	const grades = [feedback("s1", "1", 5)];

	const withStray = examResult(questions, submissions, grades, [
		sanction("gone", "0"),
	]);

	expect(withStray).toEqual(examResult(questions, submissions, grades, []));
	expect(withStray.pending).toBe(0);
	expect(withStray.sanction).toBeUndefined();
});

test("examResult: pending counts the pending outcomes when nothing is sanctioned", () => {
	const result = examResult(
		unweighted(["q1", "q2", "q3"]),
		[
			submission("s1", "q1", 0),
			submission("s2", "q2", 1),
			submission("s3", "q3", 2),
		],
		[feedback("s3", "1", 5)],
		[],
	);

	expect(result.pending).toBe(2);
});
