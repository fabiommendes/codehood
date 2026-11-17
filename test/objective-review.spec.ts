import {
	brasiliaFillIn,
	fibonacciOrdering,
	idempotenceEssay,
	multipleChoice,
	multipleSelection,
	numeric,
	primesSelection,
	protocolsTrueFalse,
	shortAnswer,
} from "@/mdq/fixtures";
import { unweighted } from "@/services/exam-result";
import type {
	GradingAttempt,
	GradingFeedback,
	GradingPass,
} from "@/services/grading";
import {
	type AnswerGroup,
	answerSections,
	GROUP_MEAN_MIN,
	needsReview,
	objectiveReview,
	type ReviewAnswer,
	type ReviewSection,
	restMeans,
} from "@/services/objective-review";
import { expect, test } from "./fixtures";

// The model of the objective grading page: answers grouped per question type, with the
// shares, means, verdicts and review flags the page shows.

const MINUTE = 60_000;

const T0 = new Date("2026-03-10T10:00:00Z");

/// `T0` shifted by `minutes`, so "later" reads as a bigger number.
function at(minutes: number): Date {
	return new Date(T0.getTime() + minutes * MINUTE);
}

function pass(
	score: number | null,
	overrides: Partial<GradingPass> = {},
): GradingPass {
	return {
		score,
		comment: null,
		grader: null,
		bot: null,
		willNotGrade: false,
		updatedAt: at(0),
		...overrides,
	};
}

/// An answer graded by the automatic pass alone; pending (no passes) when `verdict` is `null`.
function answer(
	author: string,
	payload: unknown,
	verdict: number | null,
	overrides: Partial<ReviewAnswer> = {},
): ReviewAnswer {
	return {
		author,
		submission: `s-${author}`,
		payload,
		state: verdict === null ? "pending" : "graded",
		verdict,
		passes: verdict === null ? [] : [pass(verdict)],
		restMean: null,
		...overrides,
	};
}

/// `count` answers with the same payload, authored `<prefix>1`, `<prefix>2`...
function many(
	prefix: string,
	count: number,
	payload: unknown,
	verdict: number | null,
	overrides: Partial<ReviewAnswer> = {},
): ReviewAnswer[] {
	return Array.from({ length: count }, (_, index) =>
		answer(`${prefix}${index + 1}`, payload, verdict, overrides),
	);
}

type GroupsSection = Extract<ReviewSection, { kind: "groups" }>;

function groupsOf(
	sections: ReviewSection[],
	block: GroupsSection["block"],
	label?: string,
): GroupsSection {
	const found = sections.find(
		(section): section is GroupsSection =>
			section.kind === "groups" &&
			section.block === block &&
			(label === undefined || section.label === label),
	);
	if (!found) throw new Error(`no "${block}" section`);
	return found;
}

function authorsOf(row: AnswerGroup): string[] {
	return row.members.map((member) => member.author).sort();
}

function rowWithText(rows: AnswerGroup[], text: string): AnswerGroup {
	const found = rows.find((row) => row.cell.text === text);
	if (!found) throw new Error(`no row with text "${text}"`);
	return found;
}

/// Four choices; `a` is the key.
const FOUR = multipleChoice({
	id: "four",
	stem: "Pick one.",
	choices: [
		{ id: "a", text: "Alpha", score: 1 },
		{ id: "b", text: "Bravo", score: 0 },
		{ id: "c", text: "Charlie", score: 0 },
		{ id: "d", text: "Delta", score: 0 },
	],
});

//
// multiple-choice
//

test("multiple choice gives one row per choice in document order with its count and share", () => {
	const answers = [
		...many("b", 4, "b", 0),
		...many("a", 3, "a", 1),
		...many("d", 3, "d", 0),
	];
	const sections = answerSections(FOUR, answers);
	expect(sections).toHaveLength(1);
	const section = groupsOf(sections, "choices");
	expect(section.column).toBe("score");
	expect(section.rows.map((row) => row.count)).toEqual([3, 4, 0, 3]);
	expect(section.rows.map((row) => row.share)).toEqual([0.3, 0.4, 0, 0.3]);
	expect(
		section.rows.map((row) =>
			row.cell.kind === "choice" ? row.cell.key : null,
		),
	).toEqual([true, false, false, false]);
	expect(
		section.rows.map((row) =>
			row.cell.kind === "choice" ? row.cell.marker : null,
		),
	).toEqual(["radio", "radio", "radio", "radio"]);
	expect(section.rows[0]?.cell.text).toContain("Alpha");
	expect(authorsOf(section.rows[0] as AnswerGroup)).toEqual(["a1", "a2", "a3"]);
	expect(section.rows[2]?.members).toEqual([]);
});

test("multiple choice adds a row per removed id, then one for blank answers, only when they exist", () => {
	const answers = [
		...many("a", 3, "a", 1),
		...many("b", 5, "b", 0),
		...many("d", 2, "d", 0),
		...many("g", 1, "gone", 0),
		...many("n", 2, null, 0),
	];
	const rows = groupsOf(answerSections(FOUR, answers), "choices").rows;
	expect(rows.map((row) => row.count)).toEqual([3, 5, 0, 2, 1, 2]);
	expect(rows[4]?.share).toBeCloseTo(1 / 13, 10);
	expect(rows[5]?.share).toBeCloseTo(2 / 13, 10);
	expect(authorsOf(rows[4] as AnswerGroup)).toEqual(["g1"]);
	expect(authorsOf(rows[5] as AnswerGroup)).toEqual(["n1", "n2"]);
});

test("the mean of a group needs GROUP_MEAN_MIN students with a rest mean", () => {
	expect(GROUP_MEAN_MIN).toBe(3);
	const answers = [
		...[0.25, 0.5, 0.75].map((mean, i) =>
			answer(`a${i}`, "a", 1, { restMean: mean }),
		),
		...[0.4, 0.6].map((mean, i) => answer(`b${i}`, "b", 0, { restMean: mean })),
		answer("c0", "c", 0, { restMean: 0.9 }),
		answer("c1", "c", 0, { restMean: 0.9 }),
		answer("c2", "c", 0, { restMean: null }),
	];
	const rows = groupsOf(answerSections(FOUR, answers), "choices").rows;
	expect(rows[0]?.mean).toBeCloseTo(0.5, 10);
	expect(rows[1]?.mean).toBeNull();
	expect(rows[2]?.mean).toBeNull();
	expect(rows[3]?.mean).toBeNull();
	expect(rows[0]?.members.map((member) => member.restMean)).toEqual([
		0.25, 0.5, 0.75,
	]);
});

test("the score of a row is the common verdict of its graded members", () => {
	const answers = [
		...many("a", 2, "a", 1),
		answer("b1", "b", 0),
		answer("b2", "b", 0, {
			verdict: 1,
			passes: [
				pass(1, { grader: "teacher", updatedAt: at(2) }),
				pass(0, { updatedAt: at(1) }),
			],
		}),
		...many("c", 2, "c", null),
		answer("d1", "d", 0.5),
		answer("d2", "d", null),
	];
	const rows = groupsOf(answerSections(FOUR, answers), "choices").rows;
	expect(rows[0]).toMatchObject({ score: 1, changed: 0 });
	expect(rows[1]).toMatchObject({ score: "varies", changed: 1 });
	expect(rows[2]).toMatchObject({ score: null, changed: 0 });
	expect(rows[3]).toMatchObject({ score: 0.5, changed: 0 });
});

test("a member carries the automatic score, the verdict and whether it was changed by hand", () => {
	const answers = [
		answer("auto", "a", 1),
		answer("hand", "b", 1, {
			passes: [
				pass(1, { grader: "teacher", updatedAt: at(2) }),
				pass(0, { updatedAt: at(1) }),
			],
			restMean: 0.3,
		}),
	];
	const rows = groupsOf(answerSections(FOUR, answers), "choices").rows;
	expect(rows[0]?.members).toEqual([
		{
			author: "auto",
			submission: "s-auto",
			autoScore: 1,
			score: 1,
			changed: false,
			restMean: null,
		},
	]);
	expect(rows[1]?.members).toEqual([
		{
			author: "hand",
			submission: "s-hand",
			autoScore: 0,
			score: 1,
			changed: true,
			restMean: 0.3,
		},
	]);
});

test("a human pass in the same millisecond as the automatic one counts as a change by hand", () => {
	const tied = at(5);
	const answers = [
		answer("human-newer", "a", 1, {
			passes: [
				pass(1, { grader: "teacher", updatedAt: tied }),
				pass(0, { updatedAt: tied }),
			],
		}),
		answer("auto-newer", "b", 0, {
			passes: [
				pass(0, { updatedAt: tied }),
				pass(1, { grader: "teacher", updatedAt: tied }),
			],
		}),
	];
	const rows = groupsOf(answerSections(FOUR, answers), "choices").rows;
	expect(rows[0]?.members[0]).toMatchObject({
		autoScore: 0,
		score: 1,
		changed: true,
	});
	expect(rows[0]?.changed).toBe(1);
	expect(rows[1]?.members[0]).toMatchObject({
		autoScore: 0,
		score: 0,
		changed: false,
	});
	expect(rows[1]?.changed).toBe(0);
});

test("a revert pass does not count as a change by hand", () => {
	const answers = [
		answer("undone", "a", 1, {
			passes: [
				pass(1, { grader: "teacher", ref: "revert-1", updatedAt: at(3) }),
				pass(0, { grader: "teacher", updatedAt: at(2) }),
				pass(1, { updatedAt: at(1) }),
			],
		}),
	];
	const row = groupsOf(answerSections(FOUR, answers), "choices").rows[0];
	expect(row?.members[0]).toMatchObject({ autoScore: 1, changed: false });
	expect(row?.changed).toBe(0);
});

//
// needsReview
//

test("needsReview flags a wrong row whose mean reaches the reference", () => {
	expect(needsReview({ mean: 0.8, right: false }, 0.6)).toBe(true);
	expect(needsReview({ mean: 0.6, right: false }, 0.6)).toBe(true);
	expect(needsReview({ mean: 0.5, right: false }, 0.6)).toBe(false);
});

test("needsReview never flags a right row, nor a row or reference without a mean", () => {
	expect(needsReview({ mean: 0.9, right: true }, 0.6)).toBe(false);
	expect(needsReview({ mean: null, right: false }, 0.6)).toBe(false);
	expect(needsReview({ mean: 0.9, right: false }, null)).toBe(false);
});

test("a multiple choice distractor is checked against the mean of those who got the key right", () => {
	const answers = [
		...many("a", 3, "a", 1, { restMean: 0.6 }),
		...many("b", 3, "b", 0, { restMean: 0.8 }),
		...many("c", 3, "c", 0, { restMean: 0.5 }),
	];
	const rows = groupsOf(answerSections(FOUR, answers), "choices").rows;
	expect(rows.map((row) => row.review)).toEqual([false, true, false, false]);
});

//
// multiple-selection
//

test("multiple selection lists who ticked each alternative and the five largest combinations", () => {
	const sets: [string, string[], number][] = [
		["A", ["two", "three", "five"], 6],
		["B", ["two", "three"], 5],
		["C", ["two"], 4],
		["D", ["two", "five"], 3],
		["E", ["three", "five"], 2],
		["F", ["four"], 1],
		["G", ["two", "four"], 1],
	];
	const answers = sets.flatMap(([id, ticked, count]) =>
		many(id, count, ticked, id === "A" ? 1 : 0),
	);
	const sections = answerSections(primesSelection, answers);
	expect(
		sections.map((section) =>
			section.kind === "groups" ? section.block : section.kind,
		),
	).toEqual(["alternatives", "combinations"]);

	const alternatives = groupsOf(sections, "alternatives");
	expect(alternatives.column).toBe("none");
	expect(alternatives.rows.map((row) => row.count)).toEqual([19, 13, 2, 11]);
	expect(alternatives.rows[1]?.share).toBeCloseTo(13 / 22, 10);
	expect(
		alternatives.rows.map((row) =>
			row.cell.kind === "choice" ? [row.cell.marker, row.cell.key] : null,
		),
	).toEqual([
		["checkbox", true],
		["checkbox", true],
		["checkbox", false],
		["checkbox", true],
	]);
	expect(authorsOf(alternatives.rows[2] as AnswerGroup)).toEqual(["F1", "G1"]);

	const combinations = groupsOf(sections, "combinations");
	expect(combinations.rows.map((row) => row.count)).toEqual([6, 5, 4, 3, 2, 2]);
	expect(combinations.rows[0]?.share).toBeCloseTo(6 / 22, 10);
	expect(combinations.rows[0]?.cell).toMatchObject({
		kind: "choices",
		boxes: [
			{ letter: "A", on: true, key: true },
			{ letter: "B", on: true, key: true },
			{ letter: "C", on: false, key: false },
			{ letter: "D", on: true, key: true },
		],
	});
	expect(authorsOf(combinations.rows[5] as AnswerGroup)).toEqual(["F1", "G1"]);
	expect(combinations.rows[0]?.score).toBe(1);
	expect(combinations.rows[1]?.score).toBe(0);
});

test("multiple selection with five combinations or fewer has no others row", () => {
	const answers = [
		...many("A", 2, ["two", "three", "five"], 1),
		...many("B", 1, ["two"], 0),
	];
	const combinations = groupsOf(
		answerSections(primesSelection, answers),
		"combinations",
	);
	expect(combinations.rows.map((row) => row.count)).toEqual([2, 1]);
});

test("a multiple selection alternative outside the key asks for review when its ticks have a high mean", () => {
	const key = multipleSelection({
		id: "ms",
		stem: "Tick the vowels.",
		choices: [
			{ id: "a", text: "A", correct: true },
			{ id: "b", text: "B", correct: false },
		],
	});
	const answers = [
		...many("tb", 3, ["a", "b"], 0, { restMean: 0.9 }),
		...many("ta", 3, ["a"], 1, { restMean: 0.5 }),
	];
	const rows = groupsOf(answerSections(key, answers), "alternatives").rows;
	expect(rows.map((row) => row.review)).toEqual([false, true]);
});

//
// true-false
//

test("true-false counts who judged a statement wrong or left it unjudged, and how many marked each way", () => {
	const both = { "tcp-order": true, "udp-guarantee": false };
	const answers = [
		...many("r", 5, both, 1, { restMean: 0.5 }),
		answer("r6", { "tcp-order": false, "udp-guarantee": false }, 0.5, {
			restMean: 0.9,
		}),
		answer("r7", { "tcp-order": true, "udp-guarantee": true }, 0.5, {
			restMean: 0.5,
		}),
		answer("r8", { "udp-guarantee": false }, 0.5, { restMean: 0.9 }),
		answer("r9", { "tcp-order": false, "udp-guarantee": true }, 0, {
			restMean: 0.2,
		}),
		answer("r10", {}, 0, { restMean: 0.1 }),
	];
	const section = groupsOf(
		answerSections(protocolsTrueFalse, answers),
		"statements",
	);
	expect(section.column).toBe("none");
	const [tcp, udp] = section.rows;
	expect(tcp?.count).toBe(4);
	expect(tcp?.share).toBeCloseTo(0.4, 10);
	expect(authorsOf(tcp as AnswerGroup)).toEqual(["r10", "r6", "r8", "r9"]);
	expect(tcp?.cell).toMatchObject({
		kind: "statement",
		text: "TCP guarantees ordered delivery.",
		truth: true,
		marked: { true: 6, false: 2 },
	});
	expect(udp?.count).toBe(3);
	expect(authorsOf(udp as AnswerGroup)).toEqual(["r10", "r7", "r9"]);
	expect(udp?.cell).toMatchObject({
		kind: "statement",
		truth: false,
		marked: { true: 2, false: 7 },
	});
	// Reference: mean of who judged the statement right. tcp: 0.5, wrong ones 0.525.
	// udp: 4.3 / 7, wrong ones 0.2667.
	expect(tcp?.mean).toBeCloseTo(0.525, 10);
	expect(tcp?.review).toBe(true);
	expect(udp?.mean).toBeCloseTo(0.8 / 3, 10);
	expect(udp?.review).toBe(false);
});

//
// short-answer
//

const FRANCE = shortAnswer({
	id: "france",
	stem: "What is the capital of France?",
	accept: ["Paris"],
});

test("short answer groups texts ignoring case, accents and spacing, showing the most common spelling", () => {
	const answers = [
		answer("p1", "Paris", 1),
		answer("p2", "Paris", 1),
		answer("p3", " paris ", 1),
		answer("p4", "París", 1),
		answer("r1", "Roma", 0),
		answer("r2", "Roma", 0),
	];
	const section = groupsOf(answerSections(FRANCE, answers), "texts");
	expect(section.column).toBe("accepted");
	expect(section.rows).toHaveLength(2);
	const paris = rowWithText(section.rows, "Paris");
	expect(paris.cell.kind).toBe("text");
	expect(paris.count).toBe(4);
	expect(paris.share).toBeCloseTo(4 / 6, 10);
	expect(paris.sub).toContain("3");
	expect(authorsOf(paris)).toEqual(["p1", "p2", "p3", "p4"]);
	expect(rowWithText(section.rows, "Roma").count).toBe(2);
});

//
// fill-in
//

test("fill-in gives a section per blank, then who missed any blank, most misses first", () => {
	const right = { capital: "brasilia", size: 2800000, river: "Central" };
	const answers = [
		answer("a1", right, 1),
		answer("a2", { ...right, capital: "rio" }, 2 / 3),
		answer("a3", { capital: "rio", size: 1000, river: "Central" }, 1 / 3),
		answer("a4", { capital: "rio", size: 1000, river: "Amazonas" }, 0),
		answer("a5", right, 1),
	];
	const sections = answerSections(brasiliaFillIn, answers);
	expect(sections.map((section) => section.kind)).toEqual([
		"groups",
		"groups",
		"groups",
		"missed",
	]);
	const blanks = sections.filter(
		(section): section is GroupsSection => section.kind === "groups",
	);
	expect(blanks.map((section) => section.block)).toEqual([
		"blank",
		"blank",
		"blank",
	]);
	expect(blanks.map((section) => section.column)).toEqual([
		"accepted",
		"accepted",
		"accepted",
	]);
	expect(blanks[0]?.label).toContain("1");
	expect(blanks[1]?.label).toContain("2");
	expect(blanks[2]?.label).toContain("3");

	const capital = blanks[0]?.rows ?? [];
	expect(rowWithText(capital, "Brasília").count).toBe(2);
	expect(rowWithText(capital, "Rio de Janeiro").count).toBe(3);
	expect(rowWithText(capital, "Rio de Janeiro").share).toBeCloseTo(0.6, 10);
	const size = blanks[1]?.rows ?? [];
	expect(rowWithText(size, "2800000").count).toBe(3);
	expect(rowWithText(size, "1000").count).toBe(2);
	const river = blanks[2]?.rows ?? [];
	expect(rowWithText(river, "Central").count).toBe(4);
	expect(rowWithText(river, "Amazonas").count).toBe(1);

	const missed = sections[3];
	expect(
		missed?.kind === "missed"
			? missed.members.map((member) => member.author)
			: null,
	).toEqual(["a4", "a3", "a2"]);
});

//
// numeric
//

const BAND = numeric({
	id: "band",
	stem: "Measure it.",
	answer: 2.02,
	tolerance: { absolute: 0.02 },
});

function histogramOf(sections: ReviewSection[]) {
	const found = sections.find((section) => section.kind === "histogram");
	if (found?.kind !== "histogram") throw new Error("no histogram");
	return found.histogram;
}

test("numeric shows the accepted band, a window around it and the values inside the window", () => {
	const answers = [
		...many("k", 3, 2.02, 1),
		answer("e1", 2.0, 1),
		answer("l1", 1.95, 0),
		answer("h1", 2.1, 0),
		...many("o", 2, 4.08, 0),
	];
	const sections = answerSections(BAND, answers);
	expect(sections.map((section) => section.kind)).toEqual([
		"histogram",
		"groups",
	]);
	const histogram = histogramOf(sections);
	expect(histogram.band.low).toBeCloseTo(2.0, 10);
	expect(histogram.band.high).toBeCloseTo(2.04, 10);
	expect(histogram.window.low).toBeCloseTo(1.92, 10);
	expect(histogram.window.high).toBeCloseTo(2.12, 10);
	expect(histogram.bins).toEqual([
		{ value: 1.95, count: 1, correct: 0 },
		{ value: 2.0, count: 1, correct: 1 },
		{ value: 2.02, count: 3, correct: 3 },
		{ value: 2.1, count: 1, correct: 0 },
	]);
	expect(histogram.outside).toEqual([{ value: 4.08, count: 2 }]);

	const values = groupsOf(sections, "values");
	expect(values.column).toBe("score");
	expect(
		values.rows.slice(0, 2).map((row) => [row.cell.text, row.count]),
	).toEqual([
		["2.02", 3],
		["4.08", 2],
	]);
	expect(values.rows).toHaveLength(5);
	expect(values.rows[0]?.share).toBeCloseTo(3 / 8, 10);
});

test("numeric keeps the four largest outside values and lumps the rest in one bar", () => {
	const answers = [
		...many("a", 5, 10, 0),
		...many("b", 4, 11, 0),
		...many("c", 3, 12, 0),
		...many("d", 2, 13, 0),
		answer("e", 14, 0),
		answer("f", 15, 0),
		answer("ok", 2.02, 1),
	];
	const histogram = histogramOf(answerSections(BAND, answers));
	expect(histogram.bins).toEqual([{ value: 2.02, count: 1, correct: 1 }]);
	expect(histogram.outside).toEqual([
		{ value: 10, count: 5 },
		{ value: 11, count: 4 },
		{ value: 12, count: 3 },
		{ value: 13, count: 2 },
		{ value: null, count: 2 },
	]);
});

test("numeric without tolerance has a band of one point widened by five percent of the answer, at least 1", () => {
	const exact = (value: number) =>
		numeric({ id: "exact", stem: "Exact.", answer: value });
	const small = histogramOf(answerSections(exact(10), [answer("x", 10, 1)]));
	expect(small.band).toEqual({ low: 10, high: 10 });
	expect(small.window).toEqual({ low: 9, high: 11 });
	const large = histogramOf(answerSections(exact(100), [answer("x", 100, 1)]));
	expect(large.band).toEqual({ low: 100, high: 100 });
	expect(large.window).toEqual({ low: 95, high: 105 });
});

test("numeric with a relative tolerance widens the band by the answer's share", () => {
	const relative = numeric({
		id: "relative",
		stem: "Relative.",
		answer: 100,
		tolerance: { relative: 0.1 },
	});
	const histogram = histogramOf(
		answerSections(relative, [answer("x", 100, 1)]),
	);
	expect(histogram.band.low).toBeCloseTo(90, 10);
	expect(histogram.band.high).toBeCloseTo(110, 10);
	expect(histogram.window.low).toBeCloseTo(50, 10);
	expect(histogram.window.high).toBeCloseTo(150, 10);
});

//
// ordering
//

test("ordering counts where each key line landed and groups the whole orders", () => {
	const [a, b, c, d] = fibonacciOrdering.lines;
	const answers = [
		...many("k", 3, [a, b, c, d], 1),
		...many("s", 2, [a, b, d, c], 0),
	];
	const sections = answerSections(fibonacciOrdering, answers);
	expect(sections.map((section) => section.kind)).toEqual(["matrix", "groups"]);
	const matrix = sections[0];
	if (matrix?.kind !== "matrix") throw new Error("no matrix");
	expect(matrix.matrix.answers).toBe(5);
	expect(matrix.matrix.steps).toHaveLength(4);
	expect(matrix.matrix.steps[2]).toContain("print(x)");
	expect(matrix.matrix.steps[3]).toContain("x, y = y, x + y");
	expect(matrix.matrix.cells).toEqual([
		[5, 0, 0, 0],
		[0, 5, 0, 0],
		[0, 0, 3, 2],
		[0, 0, 2, 3],
	]);

	const orders = groupsOf(sections, "orders");
	expect(orders.rows.map((row) => row.count)).toEqual([3, 2]);
	expect(orders.rows[0]?.share).toBeCloseTo(0.6, 10);
	const chips = (row: AnswerGroup | undefined) =>
		row?.cell.kind === "chips" ? row.cell.chips.map((chip) => chip.ok) : null;
	expect(chips(orders.rows[0])).toEqual([true, true, true, true]);
	expect(chips(orders.rows[1])).toEqual([true, true, false, false]);
	const second = orders.rows[1]?.cell;
	expect(second?.kind === "chips" ? second.chips[2]?.text : null).toContain(
		"x, y = y, x + y",
	);
});

test("a question type the page does not review has no section", () => {
	expect(answerSections(idempotenceEssay, [answer("a", "text", null)])).toEqual(
		[],
	);
});

//
// instructor-created answers
//

test("an answer the instructor created is left out of every section and of the summary, but listed as an override", () => {
	const created = answer("zero", null, 0, {
		createdBy: "teacher",
		passes: [
			pass(0, { grader: "teacher", comment: "no answer", updatedAt: at(4) }),
		],
	});
	const answers = [...many("a", 3, "a", 1), ...many("b", 1, "b", 0), created];
	const rows = groupsOf(answerSections(FOUR, answers), "choices").rows;
	expect(rows.map((row) => row.count)).toEqual([3, 1, 0, 0]);
	expect(rows[0]?.share).toBeCloseTo(0.75, 10);

	const model = objectiveReview({
		question: FOUR,
		slug: "four",
		answers,
		stats: { correct: 0.75, discrimination: 0.9 },
		regrades: new Map(),
		sanctions: new Map(),
	});
	expect(model.summary.answers).toBe(4);
	expect(
		groupsOf(model.sections, "choices").rows.map((row) => row.count),
	).toEqual([3, 1, 0, 0]);
	expect(model.overrides).toEqual([
		{
			author: "zero",
			submission: "s-zero",
			kind: "grade",
			auto: null,
			final: 0,
			comment: "no answer",
			when: at(4),
		},
	]);
});

//
// objectiveReview
//

const NO_RESTRICTIONS = {
	regrades: new Map<string, string>(),
	sanctions: new Map<
		string,
		{ publicId: string; value: number; reason: string | null; updatedAt: Date }
	>(),
};

test("the summary reports the answers, the correct share, pending answers and a flagged discrimination", () => {
	const answers = [
		...many("a", 2, "a", 1),
		answer("p1", "b", null),
		answer("p2", "c", null),
	];
	const flagged = objectiveReview({
		question: FOUR,
		slug: "four",
		answers,
		stats: { correct: 0.5, discrimination: -0.5 },
		...NO_RESTRICTIONS,
	});
	expect(flagged.summary).toEqual({
		answers: 4,
		correct: 0.5,
		lowDiscrimination: -0.5,
		pending: 2,
	});
	const healthy = objectiveReview({
		question: FOUR,
		slug: "four",
		answers,
		stats: { correct: null, discrimination: 0.9 },
		...NO_RESTRICTIONS,
	});
	expect(healthy.summary).toEqual({
		answers: 4,
		correct: null,
		lowDiscrimination: null,
		pending: 2,
	});
});

test("attention lists the pending answers first, in submission order, then the open regrade requests", () => {
	const answers = [
		answer("ana", "a", null),
		answer("bia", "b", 0),
		answer("caio", "c", null),
		answer("dani", "d", 0),
	];
	const model = objectiveReview({
		question: FOUR,
		slug: "four",
		answers,
		stats: { correct: 0, discrimination: null },
		regrades: new Map([
			["s-dani", "rr-2"],
			["s-bia", "rr-1"],
		]),
		sanctions: new Map(),
	});
	expect(model.attention).toEqual([
		{ kind: "pending", author: "ana", submission: "s-ana" },
		{ kind: "pending", author: "caio", submission: "s-caio" },
		{ kind: "regrade", author: "dani", submission: "s-dani", request: "rr-2" },
		{ kind: "regrade", author: "bia", submission: "s-bia", request: "rr-1" },
	]);
});

test("attention is empty when nothing is pending and no regrade is open", () => {
	const model = objectiveReview({
		question: FOUR,
		slug: "four",
		answers: many("a", 2, "a", 1),
		stats: { correct: 1, discrimination: null },
		...NO_RESTRICTIONS,
	});
	expect(model.attention).toEqual([]);
	expect(model.overrides).toEqual([]);
});

test("overrides list changes by hand and question sanctions, newest first", () => {
	const answers = [
		answer("ana", "a", 1, {
			passes: [
				pass(1, { grader: "teacher", comment: "fair", updatedAt: at(2) }),
				pass(0, { updatedAt: at(1) }),
			],
		}),
		answer("bia", "a", 1),
		answer("caio", "b", -0.5),
		answer("dani", "a", 1),
	];
	const model = objectiveReview({
		question: FOUR,
		slug: "four",
		answers,
		stats: { correct: 0.75, discrimination: null },
		regrades: new Map(),
		sanctions: new Map([
			[
				"bia",
				{ publicId: "adj-1", value: 0.5, reason: "copied", updatedAt: at(5) },
			],
			[
				"caio",
				{ publicId: "adj-2", value: 0.5, reason: null, updatedAt: at(4) },
			],
		]),
	});
	expect(model.overrides).toEqual([
		{
			author: "bia",
			submission: "s-bia",
			kind: "sanction",
			auto: 1,
			final: 0.5,
			comment: "copied",
			when: at(5),
			adjustment: { publicId: "adj-1", updatedAt: at(5) },
		},
		{
			author: "caio",
			submission: "s-caio",
			kind: "sanction",
			auto: -0.5,
			final: -0.5,
			comment: null,
			when: at(4),
			adjustment: { publicId: "adj-2", updatedAt: at(4) },
		},
		{
			author: "ana",
			submission: "s-ana",
			kind: "grade",
			auto: 0,
			final: 1,
			comment: "fair",
			when: at(2),
		},
	]);
});

//
// restMeans
//

type SubmissionRow = GradingAttempt["submissions"][number];

let nextId = 1;

function submission(
	publicId: string,
	question: string,
	minutes: number,
): SubmissionRow {
	return {
		id: nextId++ as SubmissionRow["id"],
		publicId,
		responseId: 1 as SubmissionRow["responseId"],
		questionId: 1 as SubmissionRow["questionId"],
		response: "response-1",
		question,
		status: "PENDING_GRADE",
		kind: "AUTOSAVE",
		automaticallyTriggered: false,
		payload: { answer: publicId },
		createdBy: null,
		startedAt: null,
		createdAt: at(minutes),
	};
}

function attempt(author: string, submissions: SubmissionRow[]): GradingAttempt {
	return {
		publicId: `attempt-${author}`,
		author,
		createdAt: at(-60),
		acceptingSubmissions: false,
		submissions,
	};
}

function feedbackOf(submissionId: string, score: string): GradingFeedback {
	return {
		submission: submissionId,
		score,
		feedback: null,
		grader: "teacher",
		bot: null,
		updatedAt: at(20),
	};
}

test("restMeans weighs the other questions, leaves pending ones out and counts unanswered as zero", () => {
	const questions = [
		{ slug: "q1", weight: 1 },
		{ slug: "q2", weight: 2 },
		{ slug: "q3", weight: 1 },
	];
	const attempts = [
		attempt("ana", [
			submission("ana1", "q1", 1),
			submission("ana2", "q2", 2),
			submission("ana3", "q3", 3),
		]),
		attempt("bia", [submission("bia2", "q2", 2), submission("bia3", "q3", 3)]),
		attempt("caio", [submission("caio1", "q1", 1)]),
		attempt("dani", [
			submission("dani2", "q2", 2),
			submission("dani3", "q3", 3),
		]),
	];
	const feedback = [
		feedbackOf("ana1", "-1"),
		feedbackOf("ana2", "1"),
		feedbackOf("ana3", "0"),
		feedbackOf("bia3", "1/2"),
		feedbackOf("caio1", "1"),
	];
	const means = restMeans(questions, "q1", attempts, feedback);
	expect(means.size).toBe(4);
	expect(means.get("ana")).toBeCloseTo(2 / 3, 10);
	expect(means.get("bia")).toBeCloseTo(0.5, 10);
	expect(means.get("caio")).toBe(0);
	expect(means.get("dani")).toBeNull();
});

test("restMeans is null for everyone when the exam has no other question", () => {
	const attempts = [attempt("ana", [submission("ana1", "q1", 1)])];
	const means = restMeans(unweighted(["q1"]), "q1", attempts, [
		feedbackOf("ana1", "1"),
	]);
	expect(means.get("ana")).toBeNull();
});
