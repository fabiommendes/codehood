import { z } from "zod";
import { publicQuestionSchema } from "@/mdq/public-schemas";
import { questionSchema as mdqQuestionSchema } from "@/mdq/schemas-generated";
import type { AssertEqual } from "@/utils/types";
import { courseId, questionRefId, slug } from "./base";
import { courseNaturalKey } from "./course";

export const questionSchema = z.object({
	slug: slug,
	id: questionRefId,
	status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
	version: z.string().min(1),
	createdAt: z.date(),
	updatedAt: z.date(),

	/// The MDQ document representing the question.
	question: mdqQuestionSchema,
});

export const questionPublicSchema = questionSchema
	.omit({ question: true })
	.extend({
		question: publicQuestionSchema,
	});

export const questionCreate = questionSchema
	.omit({ createdAt: true, updatedAt: true, id: true })
	.extend({
		courseId: z.union([courseId, courseNaturalKey]),
	});

export const questionUpsert = questionCreate;

export const questionUpdate = questionCreate
	.omit({ slug: true, courseId: true })
	.partial();

export const questionNaturalKey = courseNaturalKey.extend({ slug: slug });

/**
 * Which view a read returns: `true` forces the public half, `false` demands
 * the whole document, and leaving it out gives whatever the actor may see.
 */
export const questionFindOneQuery = z.object({
	public: z.boolean().optional(),
});
const questionPKPublicFlag = questionFindOneQuery.shape;

export const questionPK = z.union([
	z.object({ id: questionRefId, ...questionPKPublicFlag }),
	z.object({ publicId: z.string().min(1), ...questionPKPublicFlag }),
	z.object({ courseId: z.number(), slug: slug, ...questionPKPublicFlag }),
	questionNaturalKey.extend(questionPKPublicFlag),
]);

export const questionFilterBase = z.object({
	slugs: z.array(slug).optional(),
	statuses: z.array(z.lazy(() => questionStatus)).optional(),
	types: z.array(z.lazy(() => questionType)).optional(),
	tags: z.array(z.string()).optional(),
	...questionPKPublicFlag,
});

export const questionFilter = z.union([
	questionFilterBase.extend({ courseId: courseId }),
	questionFilterBase.extend(courseNaturalKey.shape),
]);

export const questionStatus = questionSchema.shape.status;

export const questionType = z.enum([
	"multiple-choice",
	"multiple-selection",
	"true-false",
	"essay",
	"numeric",
	"short-answer",
	"fill-in",
]);
export type QuestionType = z.infer<typeof questionType>;
true satisfies AssertEqual<
	QuestionType,
	z.infer<typeof mdqQuestionSchema>["type"]
>;
