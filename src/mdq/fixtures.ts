/**
 * Well-formed question documents, one per MDQ type, and the builders that make
 * them.
 *
 * Every fixture here parses against its schema and reports no problem from
 * `validateQuestion`, so a test that needs "some valid question" can take one
 * instead of hand-writing a document that drifts from the schemas. Tests that
 * need a *malformed* document should build it from a builder and break the one
 * field under test, keeping the defect visible at the call site.
 */
import { Question } from "./question";
import type {
	Question as AnyQuestion,
	Essay,
	FillIn,
	MultipleChoice,
	MultipleSelection,
	Numeric,
	ShortAnswer,
	TrueFalse,
} from "./schemas-generated";

// -----------------------------------------------------------------------------
// Builders

/** Builds a multiple-choice document, supplying its discriminator. */
export function multipleChoice(
	data: Omit<MultipleChoice, "type">,
): MultipleChoice {
	return { type: "multiple-choice", ...data };
}

/** Builds a multiple-selection document, supplying its discriminator. */
export function multipleSelection(
	data: Omit<MultipleSelection, "type">,
): MultipleSelection {
	return { type: "multiple-selection", ...data };
}

/** Builds a true-false document, supplying its discriminator. */
export function trueFalse(data: Omit<TrueFalse, "type">): TrueFalse {
	return { type: "true-false", ...data };
}

/** Builds an essay document, supplying its discriminator. */
export function essay(data: Omit<Essay, "type">): Essay {
	return { type: "essay", ...data };
}

/** Builds a numeric document, supplying its discriminator. */
export function numeric(data: Omit<Numeric, "type">): Numeric {
	return { type: "numeric", ...data };
}

/** Builds a short-answer document, supplying its discriminator. */
export function shortAnswer(data: Omit<ShortAnswer, "type">): ShortAnswer {
	return { type: "short-answer", ...data };
}

/** Builds a fill-in document, supplying its discriminator. */
export function fillIn(data: Omit<FillIn, "type">): FillIn {
	return { type: "fill-in", ...data };
}

/** Wraps a document in the `Question` class, for the methods rather than the data. */
export function asQuestion<Q extends AnyQuestion>(data: Q): Question<Q> {
	return new Question(data);
}

// -----------------------------------------------------------------------------
// Canonical documents

/// Scores spread over the whole [-1, 1] range, so a fixture exercising a
/// penalty does not have to introduce a negative score of its own.
export const capitalChoice: MultipleChoice = multipleChoice({
	id: "capital-of-brazil",
	title: "Capital of Brazil",
	stem: "Which city is the capital of Brazil?",
	tags: ["geography"],
	choices: [
		{ id: "brasilia", text: "Brasília", score: 1, feedback: "Correct." },
		{ id: "rio", text: "Rio de Janeiro", score: 0 },
		{
			id: "sao-paulo",
			text: "São Paulo",
			score: -0.5,
			feedback: "The largest city, not the capital.",
		},
	],
});

/// Two of four correct, so a partially correct answer is expressible.
export const primesSelection: MultipleSelection = multipleSelection({
	id: "primes-under-six",
	stem: "Select every prime number below six.",
	choices: [
		{ id: "two", text: "2", correct: true },
		{ id: "three", text: "3", correct: true },
		{ id: "four", text: "4", feedback: "Four is two squared." },
		{ id: "five", text: "5", correct: true },
	],
});

/// Mixes true and false statements, so an answer can be right about one and
/// wrong about another.
export const protocolsTrueFalse: TrueFalse = trueFalse({
	id: "network-protocols",
	stem: "Judge each statement about network protocols.",
	choices: [
		{
			id: "tcp-order",
			text: "TCP guarantees ordered delivery.",
			correct: true,
			feedback: "True — TCP reassembles segments in order.",
		},
		{
			id: "udp-guarantee",
			text: "UDP guarantees delivery.",
			correct: false,
			feedback: "False — UDP makes no delivery guarantee at all.",
		},
	],
});

/// Carries an `answerKey`, which the public representation has to withhold.
export const idempotenceEssay: Essay = essay({
	id: "define-idempotence",
	stem: "In one sentence, define idempotence.",
	input: "plain",
	answerKey:
		"An operation is idempotent when applying it more than once has the same effect as applying it once.",
});

/// Carries a unit and an absolute tolerance, so a near miss is still credited.
export const waterNumeric: Numeric = numeric({
	id: "grams-of-water",
	stem: "How many grams of water are there in a liter?",
	preamble: "Assume pure water at 4 °C, where its density is exactly 1 g/mL.",
	answer: 1000,
	unit: "g",
	tolerance: { absolute: 5 },
});

/// Ends its reject list with a wildcard, so every response lands in one list
/// or the other and nothing is left for an instructor to settle by hand.
export const capitalShortAnswer: ShortAnswer = shortAnswer({
	id: "capital-of-brazil-typed",
	stem: "What is the capital of Brazil?",
	accept: [{ pattern: "Brasília", feedback: "Good call!" }],
	reject: [
		{
			pattern: "Rio de Janeiro",
			feedback: "It used to be, but it is not anymore.",
		},
		{ pattern: "*", feedback: "Sorry, that is not the correct answer." },
	],
});

/// One blank of each kind, all three referenced by the stem, which is what
/// `validateQuestion` checks and JSON Schema cannot.
export const brasiliaFillIn: FillIn = fillIn({
	id: "brasilia-blanks",
	stem: "The capital of Brazil is [^capital], a city of roughly [^size] on the [^river] plateau.",
	blanks: [
		{
			id: "capital",
			type: "multiple-choice",
			choices: [
				{ id: "brasilia", text: "Brasília", score: 1, feedback: "Correct." },
				{ id: "rio", text: "Rio de Janeiro" },
			],
		},
		{
			id: "size",
			type: "numeric",
			answer: 2800000,
			unit: "people",
			tolerance: { relative: 0.1 },
		},
		{ id: "river", type: "short-answer", oneOf: ["Central", "Planalto"] },
	],
});

/**
 * One well-formed document of every MDQ type, for tests that must cover the
 * whole union.
 *
 * Adding a type to `questionSchema` without adding it here leaves a hole no
 * table-driven test would notice, so keep this exhaustive.
 */
export const everyQuestionType = [
	capitalChoice,
	primesSelection,
	protocolsTrueFalse,
	idempotenceEssay,
	waterNumeric,
	capitalShortAnswer,
	brasiliaFillIn,
] as const satisfies readonly AnyQuestion[];
