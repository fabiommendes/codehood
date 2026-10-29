/**
 * Well-formed question documents, one per MDQ type, and the builders
 * that make them.
 *
 * Every fixture here passes `validateDocument` and has an id on each choice,
 * so a test that needs "some valid question" can take one instead of
 * hand-writing a document that drifts from the spec. Tests that need a
 * *malformed* document should build it from a builder and break the one field
 * under test, keeping the defect visible at the call site.
 */
import type {
	EssayQuestion,
	FillInQuestion,
	MultipleChoiceQuestion,
	MultipleSelectionQuestion,
	NumericQuestion,
	OrderingQuestion,
	QuestionDocument,
	ShortAnswerQuestion,
	TrueFalseQuestion,
} from "./index";

// -----------------------------------------------------------------------------
// Builders

/** Builds a multiple-choice document, supplying its discriminator. */
export function multipleChoice(
	data: Omit<MultipleChoiceQuestion, "type">,
): MultipleChoiceQuestion {
	return { type: "multiple-choice", ...data };
}

/** Builds a multiple-selection document, supplying its discriminator. */
export function multipleSelection(
	data: Omit<MultipleSelectionQuestion, "type">,
): MultipleSelectionQuestion {
	return { type: "multiple-selection", ...data };
}

/** Builds a true-false document, supplying its discriminator. */
export function trueFalse(
	data: Omit<TrueFalseQuestion, "type">,
): TrueFalseQuestion {
	return { type: "true-false", ...data };
}

/** Builds an essay document, supplying its discriminator. */
export function essay(data: Omit<EssayQuestion, "type">): EssayQuestion {
	return { type: "essay", ...data };
}

/** Builds a numeric document, supplying its discriminator. */
export function numeric(data: Omit<NumericQuestion, "type">): NumericQuestion {
	return { type: "numeric", ...data };
}

/** Builds a short-answer document, supplying its discriminator. */
export function shortAnswer(
	data: Omit<ShortAnswerQuestion, "type">,
): ShortAnswerQuestion {
	return { type: "short-answer", ...data };
}

/** Builds a fill-in document, supplying its discriminator. */
export function fillIn(data: Omit<FillInQuestion, "type">): FillInQuestion {
	return { type: "fill-in", ...data };
}

/** Builds an ordering document, supplying its discriminator. */
export function ordering(
	data: Omit<OrderingQuestion, "type">,
): OrderingQuestion {
	return { type: "ordering", ...data };
}

// -----------------------------------------------------------------------------
// Canonical documents

/// Scores spread over the whole [-1, 1] range, so a fixture exercising a
/// penalty does not have to introduce a negative score of its own.
export const capitalChoice: MultipleChoiceQuestion = multipleChoice({
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

/// Three of four correct, so a partially correct answer is expressible.
export const primesSelection: MultipleSelectionQuestion = multipleSelection({
	id: "primes-under-six",
	stem: "Select every prime number below six.",
	choices: [
		{ id: "two", text: "2", correct: true },
		{ id: "three", text: "3", correct: true },
		{
			id: "four",
			text: "4",
			correct: false,
			feedback: "Four is two squared.",
		},
		{ id: "five", text: "5", correct: true },
	],
});

/// Mixes true and false statements, so an answer can be right about one and
/// wrong about another.
export const protocolsTrueFalse: TrueFalseQuestion = trueFalse({
	id: "network-protocols",
	stem: "Judge each statement about network protocols.",
	choices: [
		{
			id: "tcp-order",
			text: "TCP guarantees ordered delivery.",
			correct: true,
			feedback: "True: TCP reassembles segments in order.",
		},
		{
			id: "udp-guarantee",
			text: "UDP guarantees delivery.",
			correct: false,
			feedback: "False: UDP makes no delivery guarantee at all.",
		},
	],
});

/// Carries an `answerKey`, which the public form has to withhold.
export const idempotenceEssay: EssayQuestion = essay({
	id: "define-idempotence",
	stem: "In one sentence, define idempotence.",
	content: "plain",
	answerKey:
		"An operation is idempotent when applying it more than once has the same effect as applying it once.",
});

/// Carries a unit and an absolute tolerance, so a near miss is still credited.
export const waterNumeric: NumericQuestion = numeric({
	id: "grams-of-water",
	stem: "Assume pure water at 4 °C, where its density is exactly 1 g/mL.\n\nHow many grams of water are there in a liter?",
	answer: 1000,
	unit: "g",
	tolerance: { absolute: 5 },
});

/// Has an `accept` list, so a response that matches no pattern is incorrect
/// and nothing is left for an instructor to settle by hand.
export const capitalShortAnswer: ShortAnswerQuestion = shortAnswer({
	id: "capital-of-brazil-typed",
	stem: "What is the capital of Brazil?",
	accept: [{ pattern: "Brasília", feedback: "Good call!" }],
	reject: [
		{
			pattern: "Rio de Janeiro",
			feedback: "It used to be, but it is not anymore.",
		},
	],
	incorrectFeedback: "Sorry, that is not the correct answer.",
});

/// One blank of each kind, all three referenced by the stem, which is what
/// the model rules check and the schema cannot.
export const brasiliaFillIn: FillInQuestion = fillIn({
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
		{ id: "river", type: "short-answer", accept: ["Central", "Planalto"] },
	],
});

/// Code whose indentation counts, with a distractor line the student must leave out.
export const fibonacciOrdering: OrderingQuestion = ordering({
	id: "fibonacci-loop",
	title: "Fibonacci loop",
	stem: "Sort the lines into a loop that prints the first Fibonacci numbers.",
	content: "code",
	highlight: "python",
	indentation: "strict",
	lines: [
		[0, "x, y = 1, 1"],
		[0, "for _ in range(10):"],
		[1, "print(x)"],
		[1, "x, y = y, x + y"],
	],
	extra: [[1, "x = y"]],
	incorrectFeedback: "Print before you advance the pair.",
});

/**
 * One well-formed document of every MDQ type, for tests that must cover
 * the whole union.
 *
 * Adding a type to `questionDocument` without adding it here leaves a hole no
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
	fibonacciOrdering,
] as const satisfies readonly QuestionDocument[];
