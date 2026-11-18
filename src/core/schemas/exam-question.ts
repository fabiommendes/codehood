import { z } from "zod";
import {
	publicCodeSchema,
	publicEssaySchema,
	publicFillInSchema,
	publicMultipleChoiceSchema,
	publicMultipleSelectionSchema,
	publicNumericSchema,
	publicOrderingSchema,
	publicShortAnswerSchema,
	publicTrueFalseSchema,
} from "@/mdq/public-schema";
import { publicId, slug } from "./base";
import { courseRef } from "./course";

/// Addresses the attempt of the acting user at one exam.
export const examAttemptRef = z.object({ course: courseRef, exam: slug });

/// The public form of a question with no `tags`, which stay out of the student's view.
const studentQuestionSchema = z.discriminatedUnion("type", [
	publicMultipleChoiceSchema.omit({ tags: true }),
	publicMultipleSelectionSchema.omit({ tags: true }),
	publicTrueFalseSchema.omit({ tags: true }),
	publicNumericSchema.omit({ tags: true }),
	publicShortAnswerSchema.omit({ tags: true }),
	publicEssaySchema.omit({ tags: true }),
	publicFillInSchema.omit({ tags: true }),
	publicOrderingSchema.omit({ tags: true }),
	publicCodeSchema.omit({ tags: true }),
]);

/// A question of the attempt, in the public form.
export const attemptQuestionSchema = z.object({
	slug,
	version: z.string(),
	weight: z.number(),
	question: studentQuestionSchema,
	code: z
		.object({
			pretests: z.array(z.object({ format: z.string(), text: z.string() })),
			sendable: z.boolean(),
		})
		.optional(),
});

/// What `forAttempt` returns.
export const attemptQuestionsSchema = z.object({
	view: z.enum(["answer", "review"]),
	answering: z.boolean(),
	questions: z.array(attemptQuestionSchema),
});

/// The result a caller computed for one submission.
export const reviewOutcome = z.object({
	question: slug,
	submission: publicId,
	score: z.number().nullable(),
	blanks: z.record(z.string(), z.unknown()).nullable(),
});
export const reviewOutcomes = z.array(reviewOutcome);

/// What a review shows for one answer.
export const reviewResultSchema = z.union([
	z.object({
		score: z.number(),
		feedback: z.array(z.string()),
		blanks: z.record(z.string(), z.unknown()).optional(),
	}),
	z.object({
		pending: z.literal(true),
		blanks: z.record(z.string(), z.unknown()).optional(),
	}),
]);
