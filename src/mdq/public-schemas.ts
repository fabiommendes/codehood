/**
 * Runtime half of `public.ts`: a Zod schema for every public representation,
 * so a service can validate what it is about to send to a student.
 *
 * Each schema is picked out of the generated schema for its question type
 * rather than written from scratch -- picking is what keeps a field added to
 * mdq.spec from silently appearing in the public half -- and each is pinned to
 * the matching `Public*` type by an `AssertEqual` at the bottom of the file.
 */
import { z } from "zod";
import type { AssertEqual } from "@/utils/types";
import { commonPublicFields } from "./fields";
import type {
	PublicEssay,
	PublicFillIn,
	PublicMultipleChoice,
	PublicMultipleSelection,
	PublicNumeric,
	PublicQuestion,
	PublicShortAnswer,
	PublicTrueFalse,
} from "./public";
import * as schema from "./schemas-generated";

export const publicChoiceSchema = z.object({
	id: z.string(),
	text: z.string(),
});

export const publicEssaySchema = schema.essaySchema.pick({
	...commonPublicFields,
	input: true,
	highlight: true,
});

export const publicNumericSchema = schema.numericSchema
	.pick({
		...commonPublicFields,
		unit: true,
		decimalPlaces: true,
	})
	.extend({ domain: schema.numericSchema.shape.domain.unwrap() });

export const publicShortAnswerSchema = schema.shortAnswerSchema.pick({
	...commonPublicFields,
	preAccept: true,
	preReject: true,
	openEnded: true,
});

export const publicMultipleChoiceSchema = schema.multipleChoiceSchema
	.pick(commonPublicFields)
	.extend({ choices: publicChoiceSchema.array() });

export const publicMultipleSelectionSchema = schema.multipleSelectionSchema
	.pick(commonPublicFields)
	.extend({
		choices: publicChoiceSchema.array(),
	});

export const publicTrueFalseSchema = schema.trueFalseSchema
	.pick(commonPublicFields)
	.extend({ choices: publicChoiceSchema.array() });

export const publicFillInChoiceBlankSchema = schema.fillInChoiceBlankSchema
	.pick({ id: true, type: true })
	.extend({
		choices: publicChoiceSchema.array(),
	});

export const publicFillInShortAnswerBlankSchema =
	schema.fillInShortAnswerBlankSchema.pick({ id: true, type: true });

export const publicFillInNumericBlankSchema = schema.fillInNumericBlankSchema
	.pick({
		id: true,
		type: true,
		unit: true,
		decimalPlaces: true,
	})
	.extend({ domain: schema.fillInNumericBlankSchema.shape.domain.unwrap() });

export const publicFillInBlankSchema = z.discriminatedUnion("type", [
	publicFillInChoiceBlankSchema,
	publicFillInShortAnswerBlankSchema,
	publicFillInNumericBlankSchema,
]);

export const publicFillInSchema = schema.fillInSchema
	.pick({
		...commonPublicFields,
		shuffle: true,
	})
	.extend({ blanks: publicFillInBlankSchema.array() });

/** Any question as a student sees it, discriminated by `type`. */
export const publicQuestionSchema = z.discriminatedUnion("type", [
	publicMultipleChoiceSchema,
	publicMultipleSelectionSchema,
	publicTrueFalseSchema,
	publicEssaySchema,
	publicNumericSchema,
	publicShortAnswerSchema,
	publicFillInSchema,
]);

true satisfies AssertEqual<z.infer<typeof publicEssaySchema>, PublicEssay>;
true satisfies AssertEqual<z.infer<typeof publicNumericSchema>, PublicNumeric>;
true satisfies AssertEqual<
	z.infer<typeof publicShortAnswerSchema>,
	PublicShortAnswer
>;
true satisfies AssertEqual<
	z.infer<typeof publicMultipleChoiceSchema>,
	PublicMultipleChoice
>;
true satisfies AssertEqual<
	z.infer<typeof publicMultipleSelectionSchema>,
	PublicMultipleSelection
>;
true satisfies AssertEqual<
	z.infer<typeof publicTrueFalseSchema>,
	PublicTrueFalse
>;
true satisfies AssertEqual<z.infer<typeof publicFillInSchema>, PublicFillIn>;
true satisfies AssertEqual<
	z.infer<typeof publicQuestionSchema>,
	PublicQuestion
>;
