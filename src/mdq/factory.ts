/**
 * Fishery factories producing valid MDQ question documents.
 *
 * Use these when a test needs *many* questions, or a question varying in one
 * field; use the hand-written documents in `./fixtures` when it needs a
 * specific, readable one. Every factory emits a document that parses against
 * its schema and reports no problem from `validateQuestion`, including under
 * overrides — `fillInFactory` rewrites its stem to match whatever `blanks` it
 * is given, since a stem and its blanks disagreeing is the one defect the
 * schemas cannot catch.
 */
import { faker } from "@faker-js/faker";
import { Factory } from "fishery";
import {
	essay,
	fillIn,
	multipleChoice,
	multipleSelection,
	numeric,
	shortAnswer,
	trueFalse,
} from "./fixtures";
import type {
	Essay,
	FillIn,
	FillInBlank,
	MultipleChoice,
	MultipleSelection,
	Numeric,
	Question,
	ShortAnswer,
	TrueFalse,
} from "./schemas-generated";

/// Url-friendly and unique per run, matching the `id` pattern the schemas impose.
function id(prefix: string, sequence: number): string {
	return `${prefix}-${sequence}`;
}

/// A question stem phrased as a question, so generated documents read like documents.
function stem(): string {
	return faker.lorem.sentence().replace(/\.$/, "?");
}

export const multipleChoiceFactory = Factory.define<MultipleChoice>(
	({ sequence }) =>
		multipleChoice({
			id: id("mc", sequence),
			title: faker.lorem.words(3),
			stem: stem(),
			choices: [
				{ id: "right", text: faker.lorem.words(2), score: 1 },
				{ id: "wrong-1", text: faker.lorem.words(2), score: 0 },
				{ id: "wrong-2", text: faker.lorem.words(2), score: 0 },
			],
		}),
);

export const multipleSelectionFactory = Factory.define<MultipleSelection>(
	({ sequence }) =>
		multipleSelection({
			id: id("ms", sequence),
			title: faker.lorem.words(3),
			stem: stem(),
			choices: [
				{ id: "in-1", text: faker.lorem.words(2), correct: true },
				{ id: "in-2", text: faker.lorem.words(2), correct: true },
				{ id: "out-1", text: faker.lorem.words(2) },
				{ id: "out-2", text: faker.lorem.words(2) },
			],
		}),
);

export const trueFalseFactory = Factory.define<TrueFalse>(({ sequence }) =>
	trueFalse({
		id: id("tf", sequence),
		title: faker.lorem.words(3),
		stem: stem(),
		choices: [
			{ id: "claim-1", text: faker.lorem.sentence(), correct: true },
			{ id: "claim-2", text: faker.lorem.sentence(), correct: false },
		],
	}),
);

export const essayFactory = Factory.define<Essay>(({ sequence }) =>
	essay({
		id: id("essay", sequence),
		title: faker.lorem.words(3),
		stem: stem(),
		input: "plain",
		answerKey: faker.lorem.paragraph(),
	}),
);

export const numericFactory = Factory.define<Numeric>(({ sequence }) => {
	const answer = faker.number.int({ min: 1, max: 1000 });
	return numeric({
		id: id("num", sequence),
		title: faker.lorem.words(3),
		stem: stem(),
		answer,
		tolerance: { absolute: answer * 0.01 },
	});
});

export const shortAnswerFactory = Factory.define<ShortAnswer>(
	({ sequence }) => {
		const expected = faker.lorem.word();
		return shortAnswer({
			id: id("sa", sequence),
			title: faker.lorem.words(3),
			stem: stem(),
			oneOf: [expected],
			// A trailing wildcard, so no response is left for a human to settle.
			reject: [{ pattern: "*", feedback: faker.lorem.sentence() }],
		});
	},
);

/// The three blank kinds, so a generated fill-in exercises every control.
function blanks(sequence: number): FillInBlank[] {
	return [
		{
			id: id("pick", sequence),
			type: "multiple-choice",
			choices: [
				{ id: "right", text: faker.lorem.word(), score: 1 },
				{ id: "wrong", text: faker.lorem.word(), score: 0 },
			],
		},
		{
			id: id("count", sequence),
			type: "numeric",
			answer: faker.number.int({ min: 1, max: 100 }),
		},
		{
			id: id("word", sequence),
			type: "short-answer",
			oneOf: [faker.lorem.word()],
		},
	];
}

/// A stem referencing every blank exactly once, which is what `validateQuestion` demands.
function stemFor(items: readonly FillInBlank[]): string {
	const refs = items.map((blank) => `[^${blank.id}]`).join(", ");
	return `${faker.lorem.sentence().replace(/\.$/, "")}: ${refs}.`;
}

/**
 * Builds fill-in documents whose stem always references exactly the blanks the
 * document defines, including when `blanks` is overridden.
 *
 * An explicit `stem` override still wins, which is how a test asks for a
 * deliberately inconsistent document.
 */
export const fillInFactory = Factory.define<FillIn>(({ sequence, params }) => {
	const items =
		(params.blanks as FillInBlank[] | undefined) ?? blanks(sequence);
	return fillIn({
		id: id("fi", sequence),
		title: faker.lorem.words(3),
		stem: stemFor(items),
		blanks: items,
	});
});

/// The factory for each question type, so a missing type is a compile error.
const FACTORIES: {
	[K in Question["type"]]: Factory<Extract<Question, { type: K }>>;
} = {
	"multiple-choice": multipleChoiceFactory,
	"multiple-selection": multipleSelectionFactory,
	"true-false": trueFalseFactory,
	essay: essayFactory,
	numeric: numericFactory,
	"short-answer": shortAnswerFactory,
	"fill-in": fillInFactory,
};

/// The question types in a fixed order, so `questionFactory` cycles predictably.
const TYPES = [
	"multiple-choice",
	"multiple-selection",
	"true-false",
	"essay",
	"numeric",
	"short-answer",
	"fill-in",
] as const satisfies readonly Question["type"][];

/**
 * Builds a question of any type, cycling through the types in order.
 *
 * `questionFactory.buildList(7)` is one document of every type, which is what a
 * test covering the whole union wants. Pass `type` to pin it instead.
 */
export const questionFactory = Factory.define<Question>(
	({ sequence, params }) => {
		const type = params.type ?? TYPES[sequence % TYPES.length] ?? TYPES[0];
		// `Factory<T>` puts `T` in both argument and return position, so a
		// `Factory<MultipleChoice>` is not a `Factory<Question>` however sound
		// the call below is.
		return (FACTORIES[type] as Factory<Question>).build();
	},
);
