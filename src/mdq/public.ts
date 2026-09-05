import { resolveChoiceIds } from "./choices";
import { fillInBlanks } from "./fill-in";
import type * as schema from "./schemas-generated";

type CommonPublicFields =
	| "type"
	| "id"
	| "title"
	| "stem"
	| "preamble"
	| "epilogue"
	| "tags";

/**
 * Type-level function that computes the public representation from the question type.
 */
export type Public<Q extends schema.Question> = Q extends schema.Essay
	? PublicEssay
	: Q extends schema.Numeric
		? PublicNumeric
		: Q extends schema.ShortAnswer
			? PublicShortAnswer
			: Q extends schema.MultipleChoice
				? PublicMultipleChoice
				: Q extends schema.MultipleSelection
					? PublicMultipleSelection
					: Q extends schema.TrueFalse
						? PublicTrueFalse
						: Q extends schema.FillIn
							? PublicFillIn
							: never;

/**
 * A public representation of any question data.
 */
export type PublicQuestion = Public<schema.Question>;

/**
 * A public representation of an essay question.
 *
 * `input` and `highlight` survive because they describe the editor, not the
 * answer: a student cannot write a code answer without a code box.
 */
export type PublicEssay = Pick<schema.Essay, CommonPublicFields> &
	Pick<schema.Essay, "input" | "highlight">;

/**
 * A public representation of a numeric question.
 *
 * `unit`, `domain` and `decimalPlaces` survive because they describe the input
 * box, not the answer, and `domain` is resolved here so the view is handed a
 * concrete one rather than reimplementing mdq.spec's coercion table.
 */
export type PublicNumeric = Pick<schema.Numeric, CommonPublicFields> &
	Pick<schema.Numeric, "unit" | "decimalPlaces"> & {
		domain: NonNullable<schema.Numeric["domain"]>;
	};

/**
 * A public representation of a short-answer question.
 *
 * `preAccept` and `preReject` survive because mdq.spec asks that students be
 * warned about an invalid submission before they commit to it, which the view
 * cannot do without them. They describe the shape of a well-formed response,
 * not what a correct one says, and they take no part in grading.
 */
export type PublicShortAnswer = Pick<schema.ShortAnswer, CommonPublicFields> &
	Pick<schema.ShortAnswer, "preAccept" | "preReject" | "openEnded">;

/**
 * A public representation of a multiple-choice question.
 */
export type PublicMultipleChoice = Pick<
	schema.MultipleChoice,
	CommonPublicFields
> & {
	choices: PublicChoice[];
};

/**
 * A public representation of a multiple-selection question.
 */
export type PublicMultipleSelection = Pick<
	schema.MultipleSelection,
	CommonPublicFields
> & {
	choices: PublicChoice[];
};

/**
 * A public representation of a true/false question.
 */
export type PublicTrueFalse = Pick<schema.TrueFalse, CommonPublicFields> & {
	choices: PublicChoice[];
};

/**
 * A public representation of a fill-in question.
 *
 * The stem goes over as written, references and all — the references are where
 * the inputs go — and only the blanks the stem actually refers to are shipped,
 * since a control the student never sees is a control they cannot answer.
 */
export type PublicFillIn = Pick<schema.FillIn, CommonPublicFields> &
	Pick<schema.FillIn, "shuffle"> & { blanks: PublicFillInBlank[] };

/** A blank as a student sees it: enough to draw the control, and nothing more. */
export type PublicFillInBlank =
	| PublicFillInChoiceBlank
	| PublicFillInShortAnswerBlank
	| PublicFillInNumericBlank;

/** A choice blank with the per-choice scores and feedback taken out. */
export type PublicFillInChoiceBlank = Pick<
	schema.FillInChoiceBlank,
	"id" | "type"
> & { choices: PublicChoice[] };

/**
 * A short-answer blank, which is its id and nothing else.
 *
 * Both of its fields — `oneOf` and `regex` — are the answer, and the blank
 * carries no `preAccept` or `preReject` to warn a student with, so there is
 * nothing left to describe the box.
 */
export type PublicFillInShortAnswerBlank = Pick<
	schema.FillInShortAnswerBlank,
	"id" | "type"
>;

/**
 * A numeric blank with the answer and the tolerance taken out.
 *
 * `unit`, `domain` and `decimalPlaces` survive for the reason `PublicNumeric`
 * argues: they describe the input box rather than what a correct answer says.
 */
export type PublicFillInNumericBlank = Pick<
	schema.FillInNumericBlank,
	"id" | "type" | "unit" | "decimalPlaces"
> & { domain: NonNullable<schema.FillInNumericBlank["domain"]> };

/**
 * A choice as a student sees it: text and a stable id, and nothing else.
 * */
export type PublicChoice = { id: string; text: string };

/**
 * Public representation of questions, omitting sensitive fields such as
 * correct answers, and teacher feedback from the student.
 */
export const publicRepresentation = {
	/**
	 * Remove the model answer and the teacher comment.
	 */
	essay(data: schema.Essay): PublicEssay {
		return {
			...commonFields(data),
			input: data.input,
			highlight: data.highlight,
		};
	},

	/**
	 * Remove the answer, the tolerance and the teacher comment.
	 */
	numeric(data: schema.Numeric): PublicNumeric {
		return {
			...commonFields(data),
			unit: data.unit,
			decimalPlaces: data.decimalPlaces,
			domain: numericDomain(data),
		};
	},

	/**
	 * Remove every accept and reject pattern, and the teacher comment.
	 */
	shortAnswer(data: schema.ShortAnswer): PublicShortAnswer {
		return {
			...commonFields(data),
			preAccept: data.preAccept,
			preReject: data.preReject,
			openEnded: data.openEnded,
		};
	},

	/**
	 * Remove scores and teacher comment and feedback.
	 */
	multipleChoice(data: schema.MultipleChoice): PublicMultipleChoice {
		return { ...commonFields(data), choices: publicChoices(data.choices) };
	},

	/**
	 * Remove answers and teacher comment and feedback.
	 */
	multipleSelection(data: schema.MultipleSelection): PublicMultipleSelection {
		return { ...commonFields(data), choices: publicChoices(data.choices) };
	},

	/**
	 * Remove answers, markers, and teacher comment and feedback.
	 *
	 * `marker` goes with the answers rather than with the text: the letter an
	 * author wrote is `T` exactly when the statement is true, so keeping it
	 * would hand over the key in a field that does not look like one.
	 */
	trueFalse(data: schema.TrueFalse): PublicTrueFalse {
		return { ...commonFields(data), choices: publicChoices(data.choices) };
	},

	/**
	 * Remove every blank's answer — scores, `correct`, `oneOf`, `regex`, the
	 * numeric answer and its tolerance — and drop the blanks the stem never
	 * refers to.
	 */
	fillIn(data: schema.FillIn): PublicFillIn {
		return {
			...commonFields(data),
			shuffle: data.shuffle,
			blanks: fillInBlanks(data).map(publicBlank),
		};
	},
};

/** One blank, stripped to what it takes to draw its control. */
function publicBlank(blank: schema.FillInBlank): PublicFillInBlank {
	switch (blank.type) {
		case "multiple-choice":
			return {
				id: blank.id,
				type: blank.type,
				choices: publicChoices(blank.choices),
			};
		case "short-answer":
			return { id: blank.id, type: blank.type };
		case "numeric":
			return {
				id: blank.id,
				type: blank.type,
				unit: blank.unit,
				decimalPlaces: blank.decimalPlaces,
				domain: numericDomain(blank),
			};
	}
}

/**
 * The kind of number a question asks for, declared or inferred.
 *
 * mdq.spec infers an omitted domain from how the value and the absolute
 * tolerance were *written*, ranking `integer < fraction < decimal`. By the time
 * a question reaches this code the schema has parsed both into JavaScript
 * numbers, so `-1/3` and `-0.333…` are the same value and `fraction` can only
 * ever be declared, never inferred. The relative tolerance takes no part
 * either way: `42 +- 5%` is an integer question.
 */
export function numericDomain(
	question: Pick<schema.Numeric, "domain" | "answer" | "tolerance">,
): NonNullable<schema.Numeric["domain"]> {
	if (question.domain !== undefined) return question.domain;

	const written = [question.answer, question.tolerance?.absolute ?? 0];
	return written.every(Number.isInteger) ? "integer" : "decimal";
}

//
// Question based helpers
//
function publicChoices(
	choices: readonly { id?: string; text: string }[],
): PublicChoice[] {
	const ids = resolveChoiceIds(choices);
	return choices.map((choice, index) => ({
		id: ids[index],
		text: choice.text,
	}));
}

function commonFields<Q extends schema.Question>(
	data: Q,
): Pick<Q, CommonPublicFields> {
	return {
		type: data.type,
		id: data.id,
		title: data.title,
		stem: data.stem,
		preamble: data.preamble,
		epilogue: data.epilogue,
		tags: data.tags,
	};
}
