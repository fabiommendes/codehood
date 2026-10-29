/**
 * Zod schemas for the public form of a question (mdq `docs/public-form.md`).
 *
 * The mdq library defines the public form only as types, since the spec gives
 * it no JSON schema. The API needs a runtime schema for its responses and the
 * OpenAPI document, so this module builds one from the library's own field
 * schemas. Each one is pinned to the library's type by an `AssertEqual` at the
 * bottom.
 */
import {
	DiacriticsType,
	EssayContent,
	FillInGrading,
	Indentation,
	MultipleChoiceGrading,
	MultipleSelectionGrading,
	Normalization,
	NumericDomain,
	numericAnswerShape,
	OrderingContent,
	OrderingLine,
	type PublicEssayQuestion,
	type PublicFillInQuestion,
	type PublicMultipleChoiceQuestion,
	type PublicMultipleSelectionQuestion,
	type PublicNumericQuestion,
	type PublicOrderingQuestion,
	type PublicShortAnswerQuestion,
	type PublicTrueFalseQuestion,
	QuestionShuffle,
	questionBaseShape,
	Slug,
	TrueFalseGrading,
	Unmatched,
} from "mdq";
import { z } from "zod";
import type { AssertEqual } from "@/utils/types";

/// The base fields every public form copies.
const base = {
	id: questionBaseShape.id,
	uuid: questionBaseShape.uuid,
	title: questionBaseShape.title,
	stem: questionBaseShape.stem,
	epilogue: questionBaseShape.epilogue,
	tags: questionBaseShape.tags,
	locale: questionBaseShape.locale,
	weight: questionBaseShape.weight,
};

const publicChoice = z.object({ id: z.string(), text: z.string() });

const publicPattern = z.union([
	z.string(),
	z.object({ pattern: z.string(), feedback: z.string().optional() }),
]);

const publicPatternKey = {
	preAccept: z.array(publicPattern).optional(),
	preReject: z.array(publicPattern).optional(),
};

const publicNumericKey = {
	unit: numericAnswerShape.unit,
	domain: NumericDomain,
	decimalPlaces: numericAnswerShape.decimalPlaces,
};

export const publicMultipleChoiceSchema = z.object({
	...base,
	type: z.literal("multiple-choice"),
	shuffle: QuestionShuffle.optional(),
	grading: MultipleChoiceGrading.optional(),
	choices: z.array(publicChoice),
});

export const publicMultipleSelectionSchema = z.object({
	...base,
	type: z.literal("multiple-selection"),
	shuffle: QuestionShuffle.optional(),
	grading: MultipleSelectionGrading.optional(),
	choices: z.array(publicChoice),
});

export const publicTrueFalseSchema = z.object({
	...base,
	type: z.literal("true-false"),
	shuffle: QuestionShuffle.optional(),
	grading: TrueFalseGrading.optional(),
	choices: z.array(publicChoice),
});

export const publicNumericSchema = z.object({
	...base,
	type: z.literal("numeric"),
	...publicNumericKey,
});

export const publicShortAnswerSchema = z.object({
	...base,
	type: z.literal("short-answer"),
	diacritics: DiacriticsType.optional(),
	unmatched: Unmatched,
	...publicPatternKey,
});

export const publicEssaySchema = z.object({
	...base,
	type: z.literal("essay"),
	content: EssayContent.optional(),
	highlight: z.string().optional(),
});

const publicBlank = z.discriminatedUnion("type", [
	z.object({
		id: Slug,
		type: z.literal("multiple-choice"),
		choices: z.array(publicChoice),
	}),
	z.object({
		id: Slug,
		type: z.literal("short-answer"),
		unmatched: Unmatched,
		...publicPatternKey,
	}),
	z.object({ id: Slug, type: z.literal("numeric"), ...publicNumericKey }),
]);

export const publicFillInSchema = z.object({
	...base,
	type: z.literal("fill-in"),
	shuffle: QuestionShuffle.optional(),
	grading: FillInGrading.optional(),
	diacritics: DiacriticsType.optional(),
	blanks: z.array(publicBlank),
});

export const publicOrderingSchema = z.object({
	...base,
	type: z.literal("ordering"),
	content: OrderingContent,
	highlight: z.string().optional(),
	indentation: Indentation.optional(),
	unmatched: Unmatched,
	normalizations: z.array(Normalization).optional(),
	maxLevel: z.number().int().min(1).optional(),
	pool: z.array(OrderingLine),
});

/** The public form of every question type. */
export const publicQuestionSchema = z.discriminatedUnion("type", [
	publicMultipleChoiceSchema,
	publicMultipleSelectionSchema,
	publicTrueFalseSchema,
	publicNumericSchema,
	publicShortAnswerSchema,
	publicEssaySchema,
	publicFillInSchema,
	publicOrderingSchema,
]);

true satisfies AssertEqual<
	z.infer<typeof publicMultipleChoiceSchema>,
	PublicMultipleChoiceQuestion
>;
true satisfies AssertEqual<
	z.infer<typeof publicMultipleSelectionSchema>,
	PublicMultipleSelectionQuestion
>;
true satisfies AssertEqual<
	z.infer<typeof publicTrueFalseSchema>,
	PublicTrueFalseQuestion
>;
true satisfies AssertEqual<
	z.infer<typeof publicNumericSchema>,
	PublicNumericQuestion
>;
true satisfies AssertEqual<
	z.infer<typeof publicShortAnswerSchema>,
	PublicShortAnswerQuestion
>;
true satisfies AssertEqual<
	z.infer<typeof publicEssaySchema>,
	PublicEssayQuestion
>;
true satisfies AssertEqual<
	z.infer<typeof publicFillInSchema>,
	PublicFillInQuestion
>;
true satisfies AssertEqual<
	z.infer<typeof publicOrderingSchema>,
	PublicOrderingQuestion
>;
