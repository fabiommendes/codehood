import { z } from "zod";
import { publicQuestionSchema } from "@/mdq/public-schema";
import { publicId, slug } from "./base";
import { courseRef } from "./course";

/// Addresses the attempt of the acting user at one exam.
export const examAttemptRef = z.object({ course: courseRef, exam: slug });

/// A question of the attempt, in the public form.
export const attemptQuestionSchema = z.object({
	slug,
	version: z.string(),
	weight: z.number(),
	question: publicQuestionSchema,
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
