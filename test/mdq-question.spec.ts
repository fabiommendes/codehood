import { expect, test } from "@playwright/test";
import { parseNumericInput } from "@/mdq/numeric";
import { Question } from "@/mdq/question";
import { parseFillInStem } from "@/mdq/fill-in";
import type {
	Essay,
	FillIn,
	FillInBlank,
	MultipleChoice,
	MultipleSelection,
	Numeric,
	ShortAnswer,
	TrueFalse,
} from "@/mdq/schemas-generated";
import type { GradingStrategy } from "@/mdq/scoring";
import {
	matchesPattern,
	parsePattern,
	validateShortAnswer,
} from "@/mdq/short-answer";

function mc(
	choices: MultipleChoice["choices"],
	extra: Partial<MultipleChoice> = {},
): Question<MultipleChoice> {
	return new Question({
		type: "multiple-choice",
		stem: "Pick one.",
		choices,
		...extra,
	} as MultipleChoice);
}

/** The question used across the id and privacy tests. */
const capital = mc([
	{ id: "brasilia", text: "Brasília", score: 1, feedback: "Correct." },
	{ id: "rio", text: "Rio de Janeiro", score: 0 },
	{
		id: "berlin",
		text: "Berlin",
		score: -0.5,
		feedback: "Wrong country.",
		comment: "Trap for the inattentive.",
	},
]);

test.describe("choice ids", () => {
	test("a choice with no id gets a stable slug of its text, in both halves", () => {
		const question = mc([
			{ text: "Amazon", score: 1 },
			{ text: "Nile" },
			{ text: "Yellow River" },
		]);

		expect(question.toPublic().choices.map((c) => c.id)).toEqual([
			"amazon",
			"nile",
			"yellow-river",
		]);
		expect(question.score({ choice: "amazon" }).score).toBe(1);
	});

	test("text that slugifies to nothing falls back to its 1-based position", () => {
		const question = mc([{ text: "!", score: 1 }, { text: "?" }]);

		expect(question.toPublic().choices.map((c) => c.id)).toEqual(["1", "2"]);
		expect(question.score({ choice: "1" }).score).toBe(1);
	});

	test("a declared id is never overwritten by a derived one", () => {
		expect(capital.toPublic().choices.map((c) => c.id)).toEqual([
			"brasilia",
			"rio",
			"berlin",
		]);
	});
});

test.describe("score", () => {
	test("returns the declared score and the choice's own feedback", () => {
		expect(capital.score({ choice: "brasilia" })).toEqual({
			score: 1,
			feedback: "Correct.",
		});
	});

	test("a negative score survives unclamped — penalties are the exam's call", () => {
		expect(capital.score({ choice: "berlin" })).toEqual({
			score: -0.5,
			feedback: "Wrong country.",
		});
	});

	test("an unknown choice id is worth nothing, and does not throw", () => {
		expect(capital.score({ choice: "atlantis" })).toEqual({ score: 0 });
	});

	test("an unimplemented question type names the missing function", () => {
		const fillIn = new Question({
			type: "fill-in",
			stem: "The capital of Brazil is [^capital].",
		} as never);

		expect(() => fillIn.score({ blanks: {} } as never)).toThrow(/fill-in/);
	});
});

test.describe("symmetric grading", () => {
	// mdq.spec, docs/question-types/multiple-choice.md § Grading: an unspecified
	// choice is worth whatever makes picking at random average to zero, clamped
	// to [-1, 0].
	const cases: [string, (number | undefined)[], number][] = [
		["[1, _, _, _]", [1, undefined, undefined, undefined], -1 / 3],
		["[1, 0, _, _]", [1, 0, undefined, undefined], -0.5],
		["[1, 0.5, _, _]", [1, 0.5, undefined, undefined], -0.75],
		["[1, 1, _, _]", [1, 1, undefined, undefined], -1],
		["[1, 1, 1, _]", [1, 1, 1, undefined], -1],
		["[1, -1, _, _]", [1, -1, undefined, undefined], 0],
		["[1, -1, -1, _]", [1, -1, -1, undefined], 0],
	];

	for (const [label, scores, expected] of cases) {
		test(`${label} makes an unmarked choice worth ${expected.toFixed(2)}`, () => {
			const question = mc(
				scores.map((score, i) => ({ id: `c${i}`, text: `Choice ${i}`, score })),
			);
			const unmarked = scores.indexOf(undefined);

			expect(question.score({ choice: `c${unmarked}` }).score).toBeCloseTo(
				expected,
				10,
			);
		});
	}

	test("a fully specified question is unaffected by the strategy", () => {
		const question = mc([
			{ id: "a", text: "A", score: 1 },
			{ id: "b", text: "B", score: 0 },
		]);

		expect(question.score({ choice: "b" }).score).toBe(0);
	});
});

test.describe("answerKey", () => {
	test("returns the best choice even when the best is worth less than 1", () => {
		const question = mc([
			{ id: "a", text: "A", score: 0.8 },
			{ id: "b", text: "B", score: 0.2 },
		]);

		expect(question.answerKey()).toEqual(["a"]);
	});

	test("returns every choice tied for the best", () => {
		const question = mc([
			{ id: "a", text: "A", score: 1 },
			{ id: "b", text: "B", score: 1 },
			{ id: "c", text: "C", score: 0 },
		]);

		expect(question.answerKey()).toEqual(["a", "b"]);
	});

	test("returns nothing when no choice is worth anything", () => {
		const question = mc([
			{ id: "a", text: "A", score: 0 },
			{ id: "b", text: "B", score: -1 },
		]);

		expect(question.answerKey()).toEqual([]);
	});
});

test.describe("toPublic", () => {
	test("keeps what a student needs and nothing else", () => {
		const question = mc(capital.data.choices, {
			id: "capital-of-brazil",
			title: "Capital of Brazil",
			preamble: "Some geography.",
			epilogue: "Think about it.",
			tags: ["geography"],
			comment: "Instructor-only rationale.",
			author: "grace",
		});

		expect(question.toPublic()).toEqual({
			type: "multiple-choice",
			id: "capital-of-brazil",
			title: "Capital of Brazil",
			stem: "Pick one.",
			preamble: "Some geography.",
			epilogue: "Think about it.",
			tags: ["geography"],
			choices: [
				{ id: "brasilia", text: "Brasília" },
				{ id: "rio", text: "Rio de Janeiro" },
				{ id: "berlin", text: "Berlin" },
			],
		});
	});

	test("no private string survives serialization", () => {
		const serialized = JSON.stringify(
			mc(capital.data.choices, {
				comment: "Instructor-only rationale.",
			}).toPublic(),
		);

		for (const secret of [
			"Instructor-only rationale.",
			"Wrong country.",
			"Trap for the inattentive.",
			"score",
		]) {
			expect(serialized).not.toContain(secret);
		}
	});
});

//
// Multiple selection. mdq.spec, docs/question-types/multiple-selection.md.
//

function ms(
	choices: MultipleSelection["choices"],
	extra: Partial<MultipleSelection> = {},
): Question<MultipleSelection> {
	return new Question({
		type: "multiple-selection",
		stem: "Select every correct choice.",
		choices,
		...extra,
	} as MultipleSelection);
}

/** The spec's worked example: the answer key `[T, F, T, F]`. */
function keyTFTF(strategy: GradingStrategy): Question<MultipleSelection> {
	return ms(
		[true, false, true, false].map((correct, i) => ({
			id: `c${i}`,
			text: `Choice ${i}`,
			correct,
		})),
		{ grading: strategy } as Partial<MultipleSelection>,
	);
}

/** Turn `[T, F, _, _]` from the spec's table into the ids the student ticked. */
function ticked(markings: (boolean | null)[]): { choices: Set<string> } {
	const ids = markings.flatMap((mark, i) => (mark === true ? [`c${i}`] : []));
	return { choices: new Set(ids) };
}

test.describe("multiple selection grading", () => {
	const T = true;
	const F = false;
	const _ = null;

	// Markings, then the score under partial / all-or-nothing / symmetric.
	const cases: [string, (boolean | null)[], number, number, number][] = [
		["[T, F, T, F]", [T, F, T, F], 1, 1, 1],
		["[F, T, F, T]", [F, T, F, T], 0, 0, -1],
		["[T, T, F, F]", [T, T, F, F], 0.5, 0, 0],
		["[T, F, _, _]", [T, F, _, _], 0.75, 0, 0.5],
		["[F, T, _, _]", [F, T, _, _], 0.25, 0, -0.5],
		["[_, _, _, _]", [_, _, _, _], 0.5, 0, 0],
	];

	for (const [label, markings, partial, allOrNothing, symmetric] of cases) {
		test(`${label} scores ${partial} / ${allOrNothing} / ${symmetric}`, () => {
			const answer = ticked(markings);

			expect(keyTFTF("partial").score(answer).score).toBeCloseTo(partial, 10);
			expect(keyTFTF("all-or-nothing").score(answer).score).toBeCloseTo(
				allOrNothing,
				10,
			);
			expect(keyTFTF("symmetric").score(answer).score).toBeCloseTo(
				symmetric,
				10,
			);
		});
	}

	test("defaults to symmetric, like multiple choice", () => {
		const question = ms([
			{ id: "a", text: "A", correct: true },
			{ id: "b", text: "B" },
		]);

		expect(question.score({ choices: new Set(["a", "b"]) }).score).toBe(0);
	});

	test("an omitted `correct` means the choice should be left unticked", () => {
		const question = ms([
			{ id: "a", text: "A", correct: true },
			{ id: "b", text: "B" },
		]);

		expect(question.score({ choices: new Set(["a"]) }).score).toBe(1);
	});

	test("an id no choice claims is ignored, not counted as a judgement", () => {
		const question = ms([
			{ id: "a", text: "A", correct: true },
			{ id: "b", text: "B" },
		]);

		expect(question.score({ choices: new Set(["a", "atlantis"]) }).score).toBe(
			1,
		);
	});
});

test.describe("multiple selection feedback", () => {
	const question = ms([
		{ id: "a", text: "A", correct: true, feedback: "A belongs." },
		{ id: "b", text: "B", feedback: "B does not belong." },
		{ id: "c", text: "C", correct: true, feedback: "C belongs." },
		{ id: "d", text: "D" },
	]);

	test("appears only for wrongly judged choices, in document order", () => {
		// Ticked B (wrong), missed A and C (wrong), left D alone (right).
		expect(question.score({ choices: new Set(["b"]) }).choices).toEqual([
			{ id: "a", feedback: "A belongs." },
			{ id: "b", feedback: "B does not belong." },
			{ id: "c", feedback: "C belongs." },
		]);
	});

	test("includes a correct choice the student left unticked", () => {
		expect(question.score({ choices: new Set(["a"]) }).choices).toEqual([
			{ id: "c", feedback: "C belongs." },
		]);
	});

	test("a perfect answer gets an empty list, not an absent one", () => {
		const result = question.score({ choices: new Set(["a", "c"]) });

		expect(result.choices).toEqual([]);
		expect(result.score).toBe(1);
	});
});

test.describe("multiple selection answerKey and toPublic", () => {
	test("answerKey is the set of ids marked correct", () => {
		const question = ms([
			{ id: "a", text: "A", correct: true },
			{ id: "b", text: "B" },
			{ id: "c", text: "C", correct: true },
		]);

		expect(question.answerKey()).toEqual(new Set(["a", "c"]));
	});

	test("answerKey is empty when no choice is correct", () => {
		expect(
			ms([
				{ id: "a", text: "A" },
				{ id: "b", text: "B" },
			]).answerKey(),
		).toEqual(new Set());
	});

	test("toPublic drops correct, feedback and comment from every choice", () => {
		const question = ms(
			[
				{
					id: "a",
					text: "A",
					correct: true,
					feedback: "A belongs.",
					comment: "Instructor note.",
				},
				{ id: "b", text: "B" },
			],
			{ comment: "Question rationale." },
		);

		expect(question.toPublic().choices).toEqual([
			{ id: "a", text: "A" },
			{ id: "b", text: "B" },
		]);
		expect(JSON.stringify(question.toPublic())).not.toContain("belongs");
		expect(JSON.stringify(question.toPublic())).not.toContain("Instructor");
		expect(JSON.stringify(question.toPublic())).not.toContain("rationale");
	});
});

//
// True/false. mdq.spec, docs/question-types/true-false.md.
//

function tf(
	choices: TrueFalse["choices"],
	extra: Partial<TrueFalse> = {},
): Question<TrueFalse> {
	return new Question({
		type: "true-false",
		stem: "Judge each statement.",
		choices,
		...extra,
	} as TrueFalse);
}

/** The spec's worked example: the answer key `[T, F, T, F]`. */
function statements(strategy: GradingStrategy): Question<TrueFalse> {
	return tf(
		[true, false, true, false].map((correct, i) => ({
			id: `s${i}`,
			text: `Statement ${i}`,
			correct,
		})),
		{ grading: strategy } as Partial<TrueFalse>,
	);
}

/** Turn `[T, F, _, _]` from the spec's table into the answer map. */
function marked(markings: (boolean | null)[]): {
	answers: Map<string, boolean>;
} {
	const entries = markings.flatMap((mark, i) =>
		mark === null ? [] : [[`s${i}`, mark] as [string, boolean]],
	);
	return { answers: new Map(entries) };
}

test.describe("true/false grading", () => {
	const T = true;
	const F = false;
	const _ = null;

	// Markings, then the score under partial / all-or-nothing / symmetric.
	const cases: [string, (boolean | null)[], number, number, number][] = [
		["[T, F, T, F]", [T, F, T, F], 1, 1, 1],
		["[F, T, F, T]", [F, T, F, T], 0, 0, -1],
		["[T, T, F, F]", [T, T, F, F], 0.5, 0, 0],
		["[T, F, _, _]", [T, F, _, _], 0.5, 0.5, 0.5],
		["[F, T, _, _]", [F, T, _, _], 0, 0, -0.5],
		["[_, _, _, _]", [_, _, _, _], 0, 0, 0],
	];

	for (const [label, markings, partial, allOrNothing, symmetric] of cases) {
		test(`${label} scores ${partial} / ${allOrNothing} / ${symmetric}`, () => {
			const answer = marked(markings);

			expect(statements("partial").score(answer).score).toBeCloseTo(
				partial,
				10,
			);
			expect(statements("all-or-nothing").score(answer).score).toBeCloseTo(
				allOrNothing,
				10,
			);
			expect(statements("symmetric").score(answer).score).toBeCloseTo(
				symmetric,
				10,
			);
		});
	}

	test("all-or-nothing pays for a partly-answered but flawless paper", () => {
		// The rule that differs from multiple selection's strategy of the same
		// name: abstaining is not a mistake, so credit survives it.
		expect(statements("all-or-nothing").score(marked([T, _, _, _])).score).toBe(
			0.25,
		);
	});

	test("all-or-nothing zeroes the moment one mark is wrong", () => {
		expect(statements("all-or-nothing").score(marked([T, F, T, T])).score).toBe(
			0,
		);
	});

	test("an abstained statement neither adds nor subtracts under symmetric", () => {
		const three = statements("symmetric").score(marked([T, F, T, _])).score;
		const wrongLast = statements("symmetric").score(marked([T, F, T, T])).score;

		expect(three).toBeCloseTo(0.75, 10);
		expect(wrongLast).toBeCloseTo(0.5, 10);
	});

	test("a statement with `correct` omitted is false", () => {
		const question = tf([
			{ id: "a", text: "A", correct: true },
			{ id: "b", text: "B" },
		]);

		expect(question.score(marked2({ a: true, b: false })).score).toBe(1);
	});
});

/** Build an answer map from a plain object, for fixtures with named ids. */
function marked2(judgements: Record<string, boolean>): {
	answers: Map<string, boolean>;
} {
	return { answers: new Map(Object.entries(judgements)) };
}

test.describe("true/false feedback", () => {
	const question = tf([
		{ id: "a", text: "A", correct: true, feedback: "A is true." },
		{ id: "b", text: "B", correct: false, feedback: "B is false." },
		{ id: "c", text: "C", correct: true, feedback: "C is true." },
	]);

	test("covers wrongly judged and abstained statements, in document order", () => {
		// Got A right, got B wrong, abstained on C.
		expect(question.score(marked2({ a: true, b: true })).choices).toEqual([
			{ id: "b", feedback: "B is false." },
			{ id: "c", feedback: "C is true." },
		]);
	});

	test("a fully correct paper gets an empty list", () => {
		const result = question.score(marked2({ a: true, b: false, c: true }));

		expect(result.choices).toEqual([]);
		expect(result.score).toBe(1);
	});
});

test.describe("true/false answerKey and toPublic", () => {
	const question = tf([
		{
			id: "a",
			text: "A",
			correct: true,
			marker: "V",
			feedback: "A is true.",
			comment: "Instructor note.",
		},
		{ id: "b", text: "B", marker: "F" },
	]);

	test("answerKey maps each statement id to how it should be judged", () => {
		expect(question.answerKey()).toEqual(
			new Map([
				["a", true],
				["b", false],
			]),
		);
	});

	test("toPublic drops the marker along with the rest of the key", () => {
		const serialized = JSON.stringify(question.toPublic());

		expect(question.toPublic().choices).toEqual([
			{ id: "a", text: "A" },
			{ id: "b", text: "B" },
		]);
		for (const secret of ["marker", '"V"', "correct", "Instructor"]) {
			expect(serialized).not.toContain(secret);
		}
	});
});

//
// Essay
//

function essay(extra: Partial<Essay> = {}): Question<Essay> {
	return new Question({
		type: "essay",
		stem: "Explain the greenhouse effect.",
		...extra,
	} as Essay);
}

test.describe("essay grading", () => {
	test("scoring is deferred to a human, whatever the student wrote", () => {
		const question = essay({ answerKey: "A model answer." });

		for (const text of ["", "   ", "A thorough and correct essay."]) {
			expect(question.score({ essay: text })).toEqual({
				score: 0,
				pending: true,
			});
		}
	});
});

test.describe("essay answerKey and toPublic", () => {
	test("answerKey is the model answer, verbatim", () => {
		expect(essay({ answerKey: "Sunlight in, infrared out." }).answerKey()).toBe(
			"Sunlight in, infrared out.",
		);
	});

	test("a question with no model answer has an empty key", () => {
		expect(essay().answerKey()).toBe("");
	});

	test("toPublic drops the model answer and the comment, and keeps the editor", () => {
		const question = essay({
			input: "code",
			highlight: "python",
			answerKey: "def area(r): return 3.14159 * r * r",
			comment: "Accept any pi to two decimals.",
		});
		const serialized = JSON.stringify(question.toPublic());

		expect(question.toPublic()).toEqual({
			type: "essay",
			id: undefined,
			title: undefined,
			stem: "Explain the greenhouse effect.",
			preamble: undefined,
			epilogue: undefined,
			tags: undefined,
			input: "code",
			highlight: "python",
		});
		for (const secret of ["answerKey", "3.14159", "comment", "Accept any"]) {
			expect(serialized).not.toContain(secret);
		}
	});
});

//
// Numeric
//

function num(extra: Partial<Numeric> = {}): Question<Numeric> {
	return new Question({
		type: "numeric",
		stem: "How many?",
		answer: 3.14,
		...extra,
	} as Numeric);
}

/** Whether a numeric question accepts a response, as a plain boolean. */
function accepts(question: Question<Numeric>, value: number | null): boolean {
	return question.score({ value }).score === 1;
}

test.describe("numeric grading", () => {
	test("with no tolerance declared the match is exact", () => {
		const question = num({ answer: 3.14 });

		expect(accepts(question, 3.14)).toBe(true);
		expect(accepts(question, 3.1401)).toBe(false);
		expect(accepts(question, 3.1399)).toBe(false);
	});

	test("an absolute tolerance accepts up to and including its boundary", () => {
		// Chosen so the boundary is exactly representable: `3.14 +- 0.1` would
		// reject 3.04, since 3.14 - 3.04 is 0.100000000000000089 in binary
		// floating point. Widening the tolerance is the author's fix, per
		// mdq.spec — see "Known gaps" in the spec.
		const question = num({ answer: 10, tolerance: { absolute: 0.5 } });

		expect(accepts(question, 9.5)).toBe(true);
		expect(accepts(question, 10.5)).toBe(true);
		expect(accepts(question, 10.75)).toBe(false);
		expect(accepts(question, 9.25)).toBe(false);
	});

	test("a relative tolerance is a fraction, not a percentage", () => {
		// mdq.spec writes `+- 5%`; the schema stores 0.05, and 5% of 200 is 10.
		const question = num({ answer: 200, tolerance: { relative: 0.05 } });

		expect(accepts(question, 210)).toBe(true);
		expect(accepts(question, 190)).toBe(true);
		expect(accepts(question, 211)).toBe(false);
	});

	test("either tolerance can admit a response on its own", () => {
		const question = num({
			answer: 200,
			tolerance: { absolute: 1, relative: 0.05 },
		});

		// Outside the absolute tolerance, inside the relative one.
		expect(accepts(question, 208)).toBe(true);
		// And the other way around, on a question where the relative one is tiny.
		const tight = num({
			answer: 200,
			tolerance: { absolute: 8, relative: 0.001 },
		});
		expect(accepts(tight, 208)).toBe(true);
		expect(accepts(tight, 209)).toBe(false);
	});

	test("a relative tolerance on an answer of zero neither divides by zero nor accepts everything", () => {
		const question = num({ answer: 0, tolerance: { relative: 0.5 } });

		expect(question.score({ value: 1 }).score).toBe(0);
		expect(accepts(question, 0)).toBe(true);
	});

	test("an empty box scores 0 rather than throwing", () => {
		expect(num().score({ value: null })).toEqual({ score: 0 });
	});

	test("scoring consults no grading strategy", () => {
		// mdq.spec gives numeric questions no `grading` field; one smuggled in
		// must not change the binary outcome.
		const question = num({
			answer: 10,
			tolerance: { absolute: 1 },
			grading: "partial",
		} as Partial<Numeric>);

		expect(accepts(question, 10.5)).toBe(true);
		expect(accepts(question, 12)).toBe(false);
	});
});

test.describe("numeric answerKey and toPublic", () => {
	test("answerKey is the declared answer", () => {
		expect(num({ answer: -1.5 }).answerKey()).toBe(-1.5);
	});

	test("toPublic drops the answer, the tolerance and the comment", () => {
		const question = num({
			answer: 1000,
			unit: "g",
			decimalPlaces: 2,
			tolerance: { absolute: 5, relative: 0.01 },
			comment: "Accept a kilogram written as 1000.",
		});
		const serialized = JSON.stringify(question.toPublic());

		expect(question.toPublic()).toEqual({
			type: "numeric",
			id: undefined,
			title: undefined,
			stem: "How many?",
			preamble: undefined,
			epilogue: undefined,
			tags: undefined,
			unit: "g",
			decimalPlaces: 2,
			domain: "integer",
		});
		for (const secret of ["answer", "1000", "tolerance", "comment"]) {
			expect(serialized).not.toContain(secret);
		}
	});
});

test.describe("numeric domain inference", () => {
	const domainOf = (extra: Partial<Numeric>) => num(extra).toPublic().domain;

	test("a declared domain always wins, including one that cannot be inferred", () => {
		expect(domainOf({ answer: 3.14, domain: "integer" })).toBe("integer");
		expect(domainOf({ answer: -0.3333333333, domain: "fraction" })).toBe(
			"fraction",
		);
	});

	test("an integral answer and tolerance infer integer", () => {
		expect(domainOf({ answer: 42 })).toBe("integer");
		expect(domainOf({ answer: 42, tolerance: { absolute: 2 } })).toBe(
			"integer",
		);
	});

	test("a non-integral answer or absolute tolerance infers decimal", () => {
		expect(domainOf({ answer: 3.14 })).toBe("decimal");
		expect(domainOf({ answer: 42, tolerance: { absolute: 0.5 } })).toBe(
			"decimal",
		);
	});

	test("a relative tolerance never moves the domain", () => {
		// mdq.spec: `[numeric]: 42 +- 5%` is an integer question, even though 5%
		// of 42 is not a whole number.
		expect(domainOf({ answer: 42, tolerance: { relative: 0.05 } })).toBe(
			"integer",
		);
	});
});

test.describe("numeric input parsing", () => {
	test("reads the decimal spellings a number input produces", () => {
		expect(parseNumericInput("42")).toBe(42);
		expect(parseNumericInput("-3.14")).toBe(-3.14);
		expect(parseNumericInput("  1e3 ")).toBe(1000);
	});

	test("reads a fraction, which is why the fraction domain needs a text box", () => {
		expect(parseNumericInput("-1/3")).toBeCloseTo(-1 / 3, 12);
		expect(parseNumericInput("3 / 4")).toBe(0.75);
	});

	test("anything unparseable is no answer rather than a wrong one", () => {
		for (const text of ["", "   ", "about ten", "1/0", "3/", "NaN", "1/2/3"]) {
			expect(parseNumericInput(text)).toBeNull();
		}
	});
});

//
// Short answer
//

function sa(extra: Partial<ShortAnswer> = {}): Question<ShortAnswer> {
	return new Question({
		type: "short-answer",
		stem: "What is the capital of Brazil?",
		...extra,
	} as ShortAnswer);
}

/** Whether a pattern string accepts a response, straight through the engine. */
function matches(pattern: string, response: string): boolean {
	return matchesPattern(response, parsePattern(pattern));
}

test.describe("short answer pattern parsing", () => {
	test("the delimiters choose the kind", () => {
		expect(parsePattern("/[Bb]ras/i")).toEqual({
			kind: "regex",
			source: "[Bb]ras",
			flags: "i",
		});
		expect(parsePattern("`math.isnan`")).toEqual({
			kind: "exact",
			text: "math.isnan",
		});
		expect(parsePattern("*")).toEqual({ kind: "wildcard" });
		expect(parsePattern("Brasília")).toEqual({
			kind: "plain",
			text: "Brasília",
		});
	});

	test("a slash that closes nothing is a literal, not a regex", () => {
		expect(parsePattern("/")).toEqual({ kind: "plain", text: "/" });
	});
});

test.describe("short answer matching", () => {
	test("plain matching folds case, whitespace and unicode form", () => {
		expect(matches("Brasília", "  brasília  ")).toBe(true);
		expect(matches("William Shakespeare", "william   shakespeare")).toBe(true);
		// The same string in NFD: "i" plus a combining acute.
		expect(matches("Brasília", "Brasi\u0301lia")).toBe(true);
	});

	test("plain matching does NOT fold diacritics", () => {
		// mdq.spec is explicit: dropping an accent changes how a word is spelled,
		// not how it is encoded, so an inexact `Brasília` rejects `Brasilia`.
		expect(matches("Brasília", "Brasilia")).toBe(false);
	});

	test("exact matching trims the ends and nothing else", () => {
		expect(matches("`math.isnan`", "  math.isnan  ")).toBe(true);
		expect(matches("`math.isnan`", "Math.isnan")).toBe(false);
		expect(matches("`math.isnan`", "math . isnan")).toBe(false);
	});

	test("a regex is anchored at both ends, alternation included", () => {
		expect(matches("/a|b/", "a")).toBe(true);
		expect(matches("/a|b/", "b")).toBe(true);
		// Without the non-capturing wrapper this would read as "^a" or "b$".
		expect(matches("/a|b/", "ab")).toBe(false);
		expect(matches("/abc/", "xabc")).toBe(false);
	});

	test("`f` matches anywhere and `b` matches a prefix", () => {
		expect(matches("/abc/f", "xxabcxx")).toBe(true);
		expect(matches("/abc/b", "abcxx")).toBe(true);
		expect(matches("/abc/b", "xxabc")).toBe(false);
	});

	test("an anchor the author wrote survives the flag that drops the implicit ones", () => {
		expect(matches("/^abc/f", "abcxx")).toBe(true);
		expect(matches("/^abc/f", "xxabc")).toBe(false);
	});

	test("a regex is case-sensitive until `i` says otherwise", () => {
		expect(matches("/brasilia/", "Brasilia")).toBe(false);
		expect(matches("/brasilia/i", "Brasilia")).toBe(true);
	});

	test("`n` normalizes both strings, and a stale flag is ignored", () => {
		expect(matches("/Brasília/n", "Brasi\u0301lia")).toBe(true);
		expect(matches("/abc/g", "abc")).toBe(true);
	});

	test("an unparseable regex matches nothing rather than throwing", () => {
		expect(() => matches("/[/", "anything")).not.toThrow();
		expect(matches("/[/", "anything")).toBe(false);
	});
});

test.describe("short answer grading", () => {
	test("a response matching an accept pattern is correct", () => {
		expect(sa({ oneOf: ["Brasília"] }).score({ text: "brasília" }).score).toBe(
			1,
		);
	});

	test("with no reject list, anything unmatched is simply wrong", () => {
		const question = sa({ oneOf: ["Brasília"] });
		const result = question.score({ text: "Rio de Janeiro" });

		expect(result.score).toBe(0);
		expect(result.pending).toBeUndefined();
	});

	test("a reject list that does not cover the response hands it to the instructor", () => {
		// Writing the block out replaces the implicit trailing wildcard, so a
		// response matching neither list is no longer something the question
		// claims to know about.
		const question = sa({
			oneOf: ["Brasília"],
			reject: ["Rio de Janeiro"],
		});

		expect(question.score({ text: "Rio de Janeiro" })).toEqual({
			score: 0,
			feedback: undefined,
		});
		expect(question.score({ text: "Curitiba" })).toEqual({
			score: 0,
			pending: true,
		});
	});

	test("a trailing wildcard closes the question off again, with no special case", () => {
		const question = sa({
			oneOf: ["Brasília"],
			reject: [
				{ pattern: "Rio de Janeiro", feedback: "It used to be." },
				{ pattern: "*", feedback: "Sorry, that is not the correct answer." },
			],
		});

		expect(question.score({ text: "Curitiba" })).toEqual({
			score: 0,
			feedback: "Sorry, that is not the correct answer.",
		});
	});

	test("accept wins when a response matches both lists, and takes its feedback", () => {
		const question = sa({
			accept: [{ pattern: "/[Bb]ras[íi]lia/i", feedback: "Good call!" }],
			reject: [{ pattern: "Brasilia", feedback: "You forgot the accent." }],
		});

		expect(question.score({ text: "Brasilia" })).toEqual({
			score: 1,
			feedback: "Good call!",
		});
	});

	test("feedback is the first matching pattern that carries one", () => {
		const question = sa({
			reject: [
				"Rio de Janeiro",
				{
					pattern: "/Rio.*/f",
					feedback: "It used to be, but it is not anymore.",
				},
				{ pattern: "*", feedback: "Not the right answer." },
			],
			oneOf: ["Brasília"],
		});

		// The bare "Rio de Janeiro" matches first but says nothing, so it does not
		// consume the response's chance at an explanation.
		expect(question.score({ text: "Rio de Janeiro" }).feedback).toBe(
			"It used to be, but it is not anymore.",
		);
	});

	test("an open-ended question goes to the instructor whatever was written", () => {
		expect(sa({ openEnded: true }).score({ text: "anything" })).toEqual({
			score: 0,
			pending: true,
		});
		// And so does one that simply declares no patterns.
		expect(sa().score({ text: "anything" })).toEqual({
			score: 0,
			pending: true,
		});
	});

	test("`accept` replaces `oneOf`, and `regex` joins whichever list won", () => {
		const both = sa({ oneOf: ["Ignored"], accept: ["Brasília"] });
		expect(both.score({ text: "Ignored" }).score).toBe(0);
		expect(both.score({ text: "Brasília" }).score).toBe(1);

		const withRegex = sa({ oneOf: ["Brasília"], regex: "BSB|Bras[íi]lia" });
		expect(withRegex.score({ text: "BSB" }).score).toBe(1);
		expect(withRegex.score({ text: "Brasília" }).score).toBe(1);
	});
});

test.describe("short answer pre-validation", () => {
	const question = {
		preAccept: ["/\\d+/"],
		preReject: [{ pattern: "/0+/", feedback: "Zero is not a count." }],
	};

	test("a response matching no preAccept pattern is flagged", () => {
		expect(validateShortAnswer("many", question)).toEqual({});
		expect(validateShortAnswer("42", question)).toBeUndefined();
	});

	test("preReject beats preAccept, the inverse of grading's precedence", () => {
		// "0" matches both lists. In grading, accept would win; here reject does.
		expect(validateShortAnswer("0", question)).toEqual({
			feedback: "Zero is not a count.",
		});
	});

	test("pre-validation never moves a score", () => {
		const graded = sa({ oneOf: ["Brasília"], ...question });

		expect(graded.score({ text: "Brasília" }).score).toBe(1);
	});
});

test.describe("short answer answerKey and toPublic", () => {
	test("the key is the literals, with regexes and wildcards dropped", () => {
		const question = sa({
			accept: [
				"Brasília",
				"`BSB`",
				{ pattern: "/[Bb]ras[íi]lia/i" },
				{ pattern: "*" },
			],
		});

		expect(question.answerKey()).toEqual(["Brasília", "BSB"]);
	});

	test("a regex-only question has an empty key, meaning nothing to show", () => {
		expect(sa({ regex: "[Bb]ras[íi]lia" }).answerKey()).toEqual([]);
	});

	test("toPublic drops every pattern that decides a grade, and keeps the validators", () => {
		const question = sa({
			oneOf: ["Brasília"],
			regex: "BSB",
			accept: [{ pattern: "Brasília", feedback: "Correct." }],
			reject: [{ pattern: "Rio de Janeiro", feedback: "It used to be." }],
			preAccept: ["/\\w+/"],
			preReject: ["/\\d+/"],
			comment: "Accept the airport code too.",
		});
		const serialized = JSON.stringify(question.toPublic());

		expect(question.toPublic()).toEqual({
			type: "short-answer",
			id: undefined,
			title: undefined,
			stem: "What is the capital of Brazil?",
			preamble: undefined,
			epilogue: undefined,
			tags: undefined,
			preAccept: ["/\\w+/"],
			preReject: ["/\\d+/"],
			openEnded: undefined,
		});
		for (const secret of [
			"Brasília",
			"BSB",
			"accept",
			"reject",
			"comment",
			"It used to be",
		]) {
			expect(serialized).not.toContain(secret);
		}
	});
});

//
// Fill in the blanks
//

function fi(
	extra: Partial<FillIn> & Pick<FillIn, "stem" | "blanks">,
): Question<FillIn> {
	return new Question({ type: "fill-in", ...extra } as FillIn);
}

const capitalBlank: FillInBlank = {
	id: "capital",
	type: "multiple-choice",
	choices: [
		{ id: "brasilia", text: "Brasília", score: 1, feedback: "Correct." },
		{ id: "rio", text: "Rio de Janeiro" },
		{ id: "lisbon", text: "Lisbon", score: -0.25, feedback: "Wrong country." },
	],
};

const sizeBlank: FillInBlank = {
	id: "size",
	type: "numeric",
	answer: 1300000,
	unit: "people",
	tolerance: { relative: 0.1 },
};

const riverBlank: FillInBlank = {
	id: "river",
	type: "short-answer",
	oneOf: ["Paraná"],
};

/** The question used across the fill-in grading, key and privacy tests. */
function brasilia(strategy?: GradingStrategy): Question<FillIn> {
	return fi({
		stem: "The capital of Brazil is [^capital], home to about [^size], on the [^river].",
		blanks: [capitalBlank, sizeBlank, riverBlank],
		...({ grading: strategy } as Partial<FillIn>),
	});
}

/** Every blank answered right, as a baseline to vary one field of. */
const allRight = {
	blanks: { capital: "brasilia", size: "1300000", river: "paraná" },
};

test.describe("fill-in stem parsing", () => {
	test("splits the text around its references", () => {
		expect(parseFillInStem("The capital is [^capital].")).toEqual([
			{ kind: "markdown", text: "The capital is " },
			{ kind: "blank", id: "capital" },
			{ kind: "markdown", text: "." },
		]);
	});

	test("handles a reference at either end and two in a row", () => {
		expect(parseFillInStem("[^a][^b]")).toEqual([
			{ kind: "blank", id: "a" },
			{ kind: "blank", id: "b" },
		]);
		expect(parseFillInStem("[^a] and [^b]")).toEqual([
			{ kind: "blank", id: "a" },
			{ kind: "markdown", text: " and " },
			{ kind: "blank", id: "b" },
		]);
	});

	test("a stem with no reference is one markdown segment", () => {
		expect(parseFillInStem("Nothing to fill in.")).toEqual([
			{ kind: "markdown", text: "Nothing to fill in." },
		]);
		expect(parseFillInStem("")).toEqual([]);
	});

	test("brackets that are not a slug stay in the markdown", () => {
		// A CommonMark footnote reference is `[^1]`, and a digits-only slug is
		// legal, so that one really is a blank here. The rest are not.
		expect(parseFillInStem("[^1] [^ x] [^-a] [^a-] [not a ref]")).toEqual([
			{ kind: "blank", id: "1" },
			{ kind: "markdown", text: " [^ x] [^-a] [^a-] [not a ref]" },
		]);
	});
});

test.describe("fill-in cross references", () => {
	test("a reference with no blank stays in the stem as text", () => {
		const question = fi({
			stem: "The capital is [^capitl].",
			blanks: [capitalBlank],
		});

		// Nothing to draw, nothing to grade, and the typo is left visible.
		expect(question.toPublic().blanks).toEqual([]);
		expect(question.answerKey()).toEqual({});
		expect(question.score({ blanks: {} }).score).toBe(0);
	});

	test("a blank with no reference is dropped everywhere", () => {
		const question = fi({
			stem: "The capital of Brazil is [^capital].",
			blanks: [capitalBlank, riverBlank],
		});

		expect(question.toPublic().blanks.map((b) => b.id)).toEqual(["capital"]);
		expect(Object.keys(question.answerKey())).toEqual(["capital"]);
		// Scored over one blank, not two: the student never saw the second.
		expect(question.score({ blanks: { capital: "brasilia" } }).score).toBe(1);
	});
});

test.describe("fill-in blank grading", () => {
	test("each kind of blank is right, wrong, or never filled in", () => {
		const question = brasilia();

		expect(question.score(allRight).blanks).toEqual({
			capital: 1,
			size: 1,
			river: 1,
		});

		const wrong = question.score({
			blanks: { capital: "lisbon", size: "12", river: "Amazon" },
		});
		expect(wrong.blanks).toEqual({ capital: -0.25, size: 0, river: 0 });

		// An empty blank is absent from the map rather than scored zero: a view
		// draws no mark for it, and the penalising strategies pass it over.
		expect(question.score({ blanks: { capital: "brasilia" } }).blanks).toEqual({
			capital: 1,
		});
		expect(question.score({ blanks: { size: "   " } }).blanks).toEqual({});
	});

	test("a choice id no blank claims counts as nothing picked", () => {
		const question = brasilia();
		expect(question.score({ blanks: { capital: "berlin" } }).blanks).toEqual(
			{},
		);
	});

	test("a numeric blank respects its tolerance, and text is a wrong answer", () => {
		const question = brasilia();
		const size = (text: string) => question.score({ blanks: { size: text } });

		expect(size("1200000").blanks).toEqual({ size: 1 });
		expect(size("1000000").blanks).toEqual({ size: 0 });
		// Unlike a standalone numeric question, which folds an empty box and an
		// unparseable one into the same `null`, fill-in keeps the raw text and
		// can tell them apart.
		expect(size("about a million").blanks).toEqual({ size: 0 });
		expect(size("").blanks).toEqual({});
	});

	test("a short-answer blank's regex replaces oneOf rather than joining it", () => {
		const question = fi({
			stem: "Spell it: [^word].",
			blanks: [
				{
					id: "word",
					type: "short-answer",
					oneOf: ["Paraná"],
					regex: "[Aa]mazon",
				},
			],
		});

		expect(question.score({ blanks: { word: "amazon" } }).blanks).toEqual({
			word: 1,
		});
		// The blank's own docstring says `regex` takes precedence, where the
		// standalone type's says it joins the accept list.
		expect(question.score({ blanks: { word: "Paraná" } }).blanks).toEqual({
			word: 0,
		});
	});

	test("feedback comes back keyed by blank, for whichever choice was picked", () => {
		expect(brasilia().score(allRight).choices).toEqual([
			{ id: "capital", feedback: "Correct." },
		]);
		expect(
			brasilia().score({ blanks: { capital: "lisbon" } }).choices,
		).toEqual([{ id: "capital", feedback: "Wrong country." }]);
	});
});

test.describe("fill-in grading strategies", () => {
	test("every blank right is a full score under all three", () => {
		for (const strategy of [
			"partial",
			"all-or-nothing",
			"symmetric",
		] as const) {
			expect(brasilia(strategy).score(allRight).score).toBe(1);
		}
	});

	test("partial counts the right blanks and ignores the rest", () => {
		const question = brasilia("partial");
		expect(
			question.score({ blanks: { capital: "brasilia", size: "12" } }).score,
		).toBeCloseTo(1 / 3, 12);
		expect(question.score({ blanks: { capital: "lisbon" } }).score).toBe(0);
	});

	test("all-or-nothing counts an unanswered blank as a mistake", () => {
		// Where true/false lets a student abstain and keep credit for what they
		// marked, fill-in's prose is explicit that a blank left empty zeroes it.
		const question = brasilia("all-or-nothing");
		expect(
			question.score({ blanks: { capital: "brasilia", size: "1300000" } })
				.score,
		).toBe(0);
	});

	test("symmetric subtracts a point for a wrong blank and nothing for an empty one", () => {
		const question = brasilia("symmetric");

		// River wrong, size never filled in: 1 - 1 + 0, over three blanks.
		expect(
			question.score({ blanks: { capital: "brasilia", river: "Amazon" } })
				.score,
		).toBe(0);
		// Only the capital, and left empty: nothing counts either way.
		expect(question.score({ blanks: {} }).score).toBe(0);
	});

	test("a price the author put on a wrong choice overrides the flat point", () => {
		// Lisbon declares -0.25, so it costs that rather than the -1 an
		// unpriced wrong answer costs.
		expect(brasilia("symmetric").score({ blanks: { capital: "lisbon" } }).score)
			.toBeCloseTo(-0.25 / 3, 12);

		// Rio declares nothing, so it is priced by `symmetric`'s own rule at
		// -0.75 — the value that makes guessing among these three average zero.
		expect(
			brasilia("symmetric").score({ blanks: { capital: "rio" } }).score,
		).toBeCloseTo(-0.75 / 3, 12);
	});

	test("nothing is clamped", () => {
		const question = brasilia("symmetric");
		expect(
			question.score({
				blanks: { capital: "rio", size: "12", river: "Amazon" },
			}).score,
		).toBeCloseTo((-0.75 - 1 - 1) / 3, 12);
	});
});

test.describe("fill-in answer key and public half", () => {
	test("the key is the acceptable spellings of every referenced blank", () => {
		expect(brasilia().answerKey()).toEqual({
			capital: ["brasilia"],
			size: ["1300000"],
			river: ["Paraná"],
		});
	});

	test("a regex-only blank has an empty key, meaning nothing to show", () => {
		const question = fi({
			stem: "Spell it: [^word].",
			blanks: [{ id: "word", type: "short-answer", regex: "[Aa]mazon" }],
		});

		// A grading rule is not an answer anyone can read, so it is dropped —
		// the same treatment the standalone short-answer key gives its regexes.
		expect(question.answerKey()).toEqual({ word: [] });
	});

	test("the public half keeps the controls and drops every answer", () => {
		const serialized = JSON.stringify(brasilia().toPublic());

		for (const secret of ["score", "answer", "tolerance", "oneOf", "regex"]) {
			expect(serialized).not.toContain(`"${secret}"`);
		}
		expect(serialized).not.toContain("Wrong country");
	});

	test("the public half keeps what it takes to draw each control", () => {
		const blanks = brasilia().toPublic().blanks;

		expect(blanks[0]).toEqual({
			id: "capital",
			type: "multiple-choice",
			choices: [
				{ id: "brasilia", text: "Brasília" },
				{ id: "rio", text: "Rio de Janeiro" },
				{ id: "lisbon", text: "Lisbon" },
			],
		});
		// The domain is resolved rather than left absent, as `PublicNumeric`
		// already does, so the view is handed a concrete one.
		expect(blanks[1]).toMatchObject({
			id: "size",
			type: "numeric",
			unit: "people",
			domain: "integer",
		});
		expect(blanks[2]).toEqual({ id: "river", type: "short-answer" });
	});

	test("the stem goes over as written, references and all", () => {
		// The references are where the inputs go, so stripping them would leave
		// the view nothing to place.
		expect(brasilia().toPublic().stem).toContain("[^capital]");
	});
});
