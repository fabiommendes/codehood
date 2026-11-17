import { expect, test } from "@playwright/test";
import fc from "fast-check";
import {
	type AdjustmentOp,
	adjustmentsByResponse,
	adjustTotal,
	examResult,
	fixesTotal,
	formatScore,
	type ResultAdjustment,
	reducesGrade,
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
// examResult: adjustments
//

/// An adjustment on `question`, or on the whole exam when `question` is `null`.
function adjustment(
	question: string | null,
	op: AdjustmentOp,
	value: string,
	reason: string | null = null,
): ResultAdjustment {
	return { question, op, value, reason };
}

/// An adjustment of the whole exam.
function onExam(
	op: AdjustmentOp,
	value: string,
	reason: string | null = null,
): ResultAdjustment {
	return adjustment(null, op, value, reason);
}

const AB = unweighted(["a", "b"]);

/// Both questions answered, `a` graded `scoreA` and `b` graded `scoreB`; `null` leaves it waiting for a grade.
function attempt(
	scoreA: string,
	scoreB: string | null,
	adjustments: readonly ResultAdjustment[],
) {
	return examResult(
		AB,
		[submission("sa", "a", 0), submission("sb", "b", 1)],
		[
			feedback("sa", scoreA, 5),
			...(scoreB === null ? [] : [feedback("sb", scoreB, 5)]),
		],
		adjustments,
	);
}

interface TotalCase {
	name: string;
	a: string;
	b: string | null;
	adjustments: ResultAdjustment[];
	/// `null` means the total is `null` (waiting for a grade).
	total: number | null;
	pending: number;
}

const totalCases: TotalCase[] = [
	{
		name: "SET alone replaces the total",
		a: "1",
		b: "0",
		adjustments: [onExam("SET", "0.8")],
		total: 0.8,
		pending: 0,
	},
	{
		name: "SET 0 replaces the total with zero",
		a: "1",
		b: "1",
		adjustments: [onExam("SET", "0")],
		total: 0,
		pending: 0,
	},
	{
		name: "SET, FACTOR and OFFSET compose in that order",
		a: "1",
		b: "0",
		adjustments: [
			onExam("SET", "0.8"),
			onExam("FACTOR", "1.1"),
			onExam("OFFSET", "0.05"),
		],
		total: 0.93,
		pending: 0,
	},
	{
		name: "a FACTOR above 1 multiplies a positive total",
		a: "1",
		b: "0",
		adjustments: [onExam("FACTOR", "1.5")],
		total: 0.75,
		pending: 0,
	},
	{
		name: "several FACTORs multiply one after the other",
		a: "1",
		b: "1",
		adjustments: [onExam("FACTOR", "0.5"), onExam("FACTOR", "0.5")],
		total: 0.25,
		pending: 0,
	},
	{
		name: "several FACTORs of half on a half total give an eighth",
		a: "1",
		b: "0",
		adjustments: [onExam("FACTOR", "0.5"), onExam("FACTOR", "0.5")],
		total: 0.125,
		pending: 0,
	},
	{
		name: "several OFFSETs add up",
		a: "1",
		b: "0",
		adjustments: [onExam("OFFSET", "0.1"), onExam("OFFSET", "-0.05")],
		total: 0.55,
		pending: 0,
	},
	{
		name: "the total is capped at 100% by an OFFSET",
		a: "1",
		b: "1",
		adjustments: [onExam("OFFSET", "0.2")],
		total: 1,
		pending: 0,
	},
	{
		name: "the total is capped at 100% by a FACTOR above 1",
		a: "1",
		b: "0.6",
		adjustments: [onExam("FACTOR", "1.5")],
		total: 1,
		pending: 0,
	},
	{
		name: "the total is capped at 100% by a SET and an OFFSET",
		a: "1",
		b: "0",
		adjustments: [onExam("SET", "0.9"), onExam("OFFSET", "0.3")],
		total: 1,
		pending: 0,
	},
	{
		name: "a bonus OFFSET lifts a negative base",
		a: "-0.5",
		b: "0",
		adjustments: [onExam("OFFSET", "0.1")],
		total: -0.15,
		pending: 0,
	},
	{
		name: "a penalty OFFSET does not push a negative base lower",
		a: "-0.5",
		b: "0",
		adjustments: [onExam("OFFSET", "-0.1")],
		total: -0.25,
		pending: 0,
	},
	{
		name: "a FACTOR above 1 does not multiply a negative base",
		a: "-0.5",
		b: "0",
		adjustments: [onExam("FACTOR", "1.5")],
		total: -0.25,
		pending: 0,
	},
	{
		name: "a FACTOR below 1 does not multiply a negative base",
		a: "-0.5",
		b: "0",
		adjustments: [onExam("FACTOR", "0.5")],
		total: -0.25,
		pending: 0,
	},
	{
		name: "FACTOR 0 is terminal and ignores SET and OFFSET",
		a: "1",
		b: "0",
		adjustments: [
			onExam("SET", "0.9"),
			onExam("FACTOR", "0"),
			onExam("OFFSET", "0.3"),
		],
		total: 0,
		pending: 0,
	},
	{
		name: "FACTOR 0 with an OFFSET over a negative base leaves the base",
		a: "-0.8",
		b: "0",
		adjustments: [onExam("FACTOR", "0"), onExam("OFFSET", "0.2")],
		total: -0.4,
		pending: 0,
	},
	{
		name: "FACTOR 0 with a SET gives 0",
		a: "1",
		b: "0",
		adjustments: [onExam("SET", "0.8"), onExam("FACTOR", "0")],
		total: 0,
		pending: 0,
	},
	{
		name: "FACTOR 0 alone over a negative base leaves the base",
		a: "-0.8",
		b: "0",
		adjustments: [onExam("FACTOR", "0")],
		total: -0.4,
		pending: 0,
	},
	{
		name: "FACTOR 0 is terminal wherever it comes in the list",
		a: "1",
		b: "1",
		adjustments: [
			onExam("OFFSET", "0.3"),
			onExam("FACTOR", "1.2"),
			onExam("FACTOR", "0"),
		],
		total: 0,
		pending: 0,
	},
	{
		name: "SET with a question waiting for a grade defines the total with nothing pending",
		a: "1",
		b: null,
		adjustments: [onExam("SET", "0.8")],
		total: 0.8,
		pending: 0,
	},
	{
		name: "SET and OFFSET with a question waiting for a grade define the total",
		a: "1",
		b: null,
		adjustments: [onExam("SET", "0.5"), onExam("OFFSET", "0.1")],
		total: 0.6,
		pending: 0,
	},
	{
		name: "FACTOR 0 with a question waiting for a grade totals 0 with nothing pending",
		a: "1",
		b: null,
		adjustments: [onExam("FACTOR", "0")],
		total: 0,
		pending: 0,
	},
	{
		name: "OFFSET with a question waiting for a grade leaves the total null and the question pending",
		a: "1",
		b: null,
		adjustments: [onExam("OFFSET", "0.1")],
		total: null,
		pending: 1,
	},
	{
		name: "FACTOR above 0 with a question waiting for a grade leaves the total null",
		a: "1",
		b: null,
		adjustments: [onExam("FACTOR", "0.5")],
		total: null,
		pending: 1,
	},
	{
		name: "a FACTOR on a question and one on the exam compose",
		a: "1",
		b: "1",
		adjustments: [adjustment("b", "FACTOR", "0"), onExam("FACTOR", "0.5")],
		total: 0.25,
		pending: 0,
	},
	{
		name: "an adjustment on a question the exam does not have is ignored",
		a: "1",
		b: "0",
		adjustments: [adjustment("gone", "FACTOR", "0")],
		total: 0.5,
		pending: 0,
	},
	{
		name: "a SET on a question is ignored: only a FACTOR is read there",
		a: "1",
		b: "0",
		adjustments: [adjustment("a", "SET", "0")],
		total: 0.5,
		pending: 0,
	},
	{
		name: "an OFFSET on a question is ignored: only a FACTOR is read there",
		a: "0",
		b: "0",
		adjustments: [adjustment("a", "OFFSET", "0.5")],
		total: 0,
		pending: 0,
	},
	{
		name: "a FACTOR on a question lowers the question and so the total",
		a: "1",
		b: "0",
		adjustments: [adjustment("a", "FACTOR", "0.5")],
		total: 0.25,
		pending: 0,
	},
];

test("examResult: without adjustments the total is the mean and nothing is reported", () => {
	const result = attempt("1", "0", []);

	expect(result.total).toBeCloseTo(0.5, 10);
	expect(result.adjustments).toBeUndefined();
	expect(result.original).toBeUndefined();
});

for (const { name, a, b, adjustments, total, pending } of totalCases) {
	test(`examResult: ${name}`, () => {
		const result = attempt(a, b, adjustments);

		if (total === null) expect(result.total).toBeNull();
		else expect(result.total).toBeCloseTo(total, 10);
		expect(result.pending).toBe(pending);
	});
}

test("examResult: SET reports the adjustment and the total it replaced", () => {
	const result = attempt("1", "0", [onExam("SET", "0.8", "reposição")]);

	expect(result.adjustments).toEqual([
		{ op: "SET", value: 0.8, reason: "reposição" },
	]);
	expect(result.original?.total).toBeCloseTo(0.5, 10);
	expect(result.sanction).toBeUndefined();
});

test("examResult: the original total is null when a SET hides a question waiting for a grade", () => {
	const result = attempt("1", null, [onExam("SET", "0.8")]);

	expect(result.original).toEqual({ total: null });
});

test("examResult: the original total comes after the question adjustments", () => {
	const result = attempt("1", "1", [
		adjustment("b", "FACTOR", "0"),
		onExam("FACTOR", "0.5"),
	]);

	expect(result.original?.total).toBeCloseTo(0.5, 10);
});

test("examResult: adjustments only on questions report no exam adjustments", () => {
	const result = attempt("1", "0", [adjustment("a", "FACTOR", "0.5")]);

	expect(result.adjustments).toBeUndefined();
	expect(result.original).toBeUndefined();
});

test("examResult: exam adjustments come out as SET, then FACTORs, then OFFSETs", () => {
	const result = attempt("1", "0", [
		onExam("OFFSET", "0.1", "o"),
		onExam("FACTOR", "1.1", "f"),
		onExam("SET", "0.8", "s"),
	]);

	expect(result.adjustments).toEqual([
		{ op: "SET", value: 0.8, reason: "s" },
		{ op: "FACTOR", value: 1.1, reason: "f" },
		{ op: "OFFSET", value: 0.1, reason: "o" },
	]);
});

test("examResult: adjustments of one operation keep the order they came in", () => {
	const result = attempt("1", "0", [
		onExam("OFFSET", "0.1", "first"),
		onExam("OFFSET", "-0.05", "second"),
		onExam("FACTOR", "0.9", "third"),
		onExam("FACTOR", "0.8", "fourth"),
	]);

	expect(result.adjustments?.map((entry) => entry.reason)).toEqual([
		"third",
		"fourth",
		"first",
		"second",
	]);
});

test("examResult: an adjustment on a question not in the exam is not reported", () => {
	const questions = unweighted(["q1"]);
	const submissions = [submission("s1", "q1", 0)];
	const grades = [feedback("s1", "1", 5)];

	const withStray = examResult(questions, submissions, grades, [
		adjustment("gone", "FACTOR", "0"),
	]);

	expect(withStray).toEqual(examResult(questions, submissions, grades, []));
	expect(withStray.pending).toBe(0);
	expect(withStray.adjustments).toBeUndefined();
});

test("examResult: a negative total is not multiplied by the exam factor", () => {
	const result = examResult(
		unweighted(["q1"]),
		[submission("s1", "q1", 0)],
		[feedback("s1", "-0.4", 5)],
		[onExam("FACTOR", "0")],
	);

	expect(result.total).toBeCloseTo(-0.4, 10);
	expect(result.adjustments).toEqual([
		{ op: "FACTOR", value: 0, reason: null },
	]);
});

//
// examResult: adjustments on a question
//

test("examResult: a FACTOR on a question scores the question times the factor and reports the original", () => {
	const result = attempt("1", "0", [adjustment("a", "FACTOR", "0.5", "cola")]);

	expect(result.questions[0]).toMatchObject({
		question: "a",
		status: "sanctioned",
		adjustment: {
			op: "FACTOR",
			value: 0.5,
			reason: "cola",
			original: { status: "graded", score: 1 },
		},
	});
	expect(result.questions[0]?.score).toBeCloseTo(0.5, 10);
});

test("examResult: a FACTOR on a question does not multiply a negative score", () => {
	const result = attempt("-0.5", "0", [adjustment("a", "FACTOR", "0.5")]);

	expect(result.questions[0]).toMatchObject({
		status: "sanctioned",
		score: -0.5,
		adjustment: { original: { status: "graded", score: -0.5 } },
	});
});

test("examResult: a FACTOR 0 on a question scores 0 and is sanctioned even without a grade", () => {
	const result = attempt("1", null, [adjustment("b", "FACTOR", "0")]);

	expect(result.questions[1]).toMatchObject({
		status: "sanctioned",
		score: 0,
		adjustment: { original: { status: "pending", score: null } },
	});
	expect(result.pending).toBe(0);
	expect(result.total).not.toBeNull();
});

test("examResult: a reduced question without a grade stays pending", () => {
	const result = attempt("1", null, [adjustment("b", "FACTOR", "0.5")]);

	expect(result.questions[1]).toMatchObject({
		status: "pending",
		score: null,
		adjustment: { op: "FACTOR", value: 0.5 },
	});
	expect(result.total).toBeNull();
	expect(result.pending).toBe(1);
});

test("examResult: a newer grading pass does not undo a zeroed question", () => {
	const result = examResult(
		unweighted(["q1"]),
		[submission("s1", "q1", 0)],
		[feedback("s1", "0.8", 5), feedback("s1", "1", 30)],
		[adjustment("q1", "FACTOR", "0")],
	);

	expect(result.questions[0]).toMatchObject({
		status: "sanctioned",
		score: 0,
		adjustment: { original: { status: "graded", score: 1 } },
	});
});

test("examResult: the adjusted outcome keeps the submission, blanks and comments", () => {
	const blanks = { plateau: { score: 0.5, comment: "Close enough." } };
	const result = examResult(
		unweighted(["q1"]),
		[submission("s1", "q1", 0)],
		[{ ...feedback("s1", "0.8", 5, "Nice try"), blanks }],
		[adjustment("q1", "FACTOR", "0", "cola")],
	);

	expect(result.questions[0]).toMatchObject({
		question: "q1",
		submission: "s1",
		status: "sanctioned",
		score: 0,
		blanks,
		comments: ["Nice try"],
		adjustment: {
			op: "FACTOR",
			value: 0,
			reason: "cola",
			original: { status: "graded", score: 0.8 },
		},
	});
});

test("examResult: with two FACTORs on one question the lowest wins", () => {
	const result = attempt("1", "0", [
		adjustment("a", "FACTOR", "0.8"),
		adjustment("a", "FACTOR", "0.5"),
	]);

	expect(result.questions[0]?.score).toBeCloseTo(0.5, 10);
	expect(result.questions[0]?.adjustment?.value).toBe(0.5);
});

//
// adjustTotal, fixesTotal and reducesGrade
//

const adjustTotalCases: Array<
	[
		string,
		number | null,
		Array<{ op: AdjustmentOp; value: string | number }>,
		number | null,
	]
> = [
	["nothing to adjust", null, [], null],
	["no adjustments keep the base", 0.5, [], 0.5],
	["a SET defines a null base", null, [{ op: "SET", value: "0.4" }], 0.4],
	["a FACTOR 0 defines a null base", null, [{ op: "FACTOR", value: "0" }], 0],
	["a FACTOR 0 zeroes a base", 0.5, [{ op: "FACTOR", value: "0" }], 0],
	[
		"a FACTOR 0 leaves a negative base",
		-0.4,
		[{ op: "FACTOR", value: "0" }],
		-0.4,
	],
	[
		"a FACTOR 0 with an OFFSET leaves a negative base",
		-0.4,
		[
			{ op: "FACTOR", value: "0" },
			{ op: "OFFSET", value: "0.2" },
		],
		-0.4,
	],
	[
		"a FACTOR 0 with a SET gives 0",
		0.5,
		[
			{ op: "SET", value: "0.8" },
			{ op: "FACTOR", value: "0" },
		],
		0,
	],
	[
		"an OFFSET leaves a null base null",
		null,
		[{ op: "OFFSET", value: "0.1" }],
		null,
	],
	[
		"a FACTOR above 0 leaves a null base null",
		null,
		[{ op: "FACTOR", value: "1.1" }],
		null,
	],
	["a numeric FACTOR multiplies", 0.5, [{ op: "FACTOR", value: 0.5 }], 0.25],
	["a numeric OFFSET adds", 0.5, [{ op: "OFFSET", value: -0.25 }], 0.25],
	["the result is capped at 1", 0.9, [{ op: "OFFSET", value: "0.3" }], 1],
	["a SET beats the base", 0.5, [{ op: "SET", value: "0.2" }], 0.2],
];

for (const [name, base, adjustments, expected] of adjustTotalCases) {
	test(`adjustTotal: ${name}`, () => {
		const result = adjustTotal(base, adjustments);

		if (expected === null) expect(result).toBeNull();
		else expect(result).toBeCloseTo(expected, 10);
	});
}

const fixesTotalCases: Array<
	[string, Array<{ op: AdjustmentOp; value: string | number }>, boolean]
> = [
	["nothing", [], false],
	["a SET", [{ op: "SET", value: "0.8" }], true],
	["a SET 0", [{ op: "SET", value: "0" }], true],
	["a FACTOR 0 as text", [{ op: "FACTOR", value: "0" }], true],
	["a FACTOR 0 as number", [{ op: "FACTOR", value: 0 }], true],
	["a FACTOR 0.5", [{ op: "FACTOR", value: "0.5" }], false],
	["a FACTOR 1.5", [{ op: "FACTOR", value: 1.5 }], false],
	["an OFFSET", [{ op: "OFFSET", value: "0.1" }], false],
	[
		"an OFFSET with a FACTOR 0",
		[
			{ op: "OFFSET", value: "0.1" },
			{ op: "FACTOR", value: "0" },
		],
		true,
	],
];

for (const [name, adjustments, expected] of fixesTotalCases) {
	test(`fixesTotal: ${name} -> ${expected}`, () => {
		expect(fixesTotal(adjustments)).toBe(expected);
	});
}

const reducesGradeCases: Array<
	[string, AdjustmentOp, string | number, boolean]
> = [
	["FACTOR 0.99", "FACTOR", "0.99", true],
	["FACTOR 0", "FACTOR", "0", true],
	["FACTOR 0.5 as number", "FACTOR", 0.5, true],
	["FACTOR 1", "FACTOR", "1", false],
	["FACTOR 1.1", "FACTOR", "1.1", false],
	["SET 0", "SET", "0", false],
	["SET 0.5", "SET", "0.5", false],
	["OFFSET -0.1", "OFFSET", "-0.1", false],
	["OFFSET 0.1", "OFFSET", "0.1", false],
];

for (const [name, op, value, expected] of reducesGradeCases) {
	test(`reducesGrade: ${name} -> ${expected}`, () => {
		expect(reducesGrade({ op, value })).toBe(expected);
	});
}

//
// adjustmentsByResponse
//

test("adjustmentsByResponse: groups the adjustments of every operation by attempt", () => {
	const grouped = adjustmentsByResponse([
		{ response: "r1", question: null, op: "SET", value: "0.8", reason: "a" },
		{
			response: "r2",
			question: "q1",
			op: "FACTOR",
			value: "0.5",
			reason: null,
		},
		{ response: "r1", question: null, op: "OFFSET", value: "0.1", reason: "b" },
		{
			response: "r1",
			question: null,
			op: "FACTOR",
			value: "1.1",
			reason: null,
		},
	]);

	expect(grouped.get("r1")).toEqual([
		{ question: null, op: "SET", value: "0.8", reason: "a" },
		{ question: null, op: "OFFSET", value: "0.1", reason: "b" },
		{ question: null, op: "FACTOR", value: "1.1", reason: null },
	]);
	expect(grouped.get("r2")).toEqual([
		{ question: "q1", op: "FACTOR", value: "0.5", reason: null },
	]);
	expect(grouped.get("r3")).toBeUndefined();
});

test("adjustmentsByResponse: drops every field but the ones the result needs, notes included", () => {
	const staffView = {
		response: "r1",
		question: null,
		op: "FACTOR" as const,
		value: "0.5",
		reason: "atraso",
		notes: "private evidence",
		publicId: "adj1",
	};

	const [entry] = adjustmentsByResponse([staffView]).get("r1") ?? [];

	expect(entry).toEqual({
		question: null,
		op: "FACTOR",
		value: "0.5",
		reason: "atraso",
	});
	expect(entry).not.toHaveProperty("notes");
});

test("adjustmentsByResponse: no views give an empty map", () => {
	expect(adjustmentsByResponse([]).size).toBe(0);
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
