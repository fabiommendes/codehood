/**
 * What a student reads of an exam's questions, through the exam grant.
 */
import { z } from "zod";
import { slug } from "@/core/schemas/base";
import {
	attemptQuestionsSchema,
	examAttemptRef,
	reviewOutcomes,
	reviewResultSchema,
} from "@/core/schemas/exam-question";
import { defineService, op } from "@/db/define-service";

export type ExamAttemptRef = z.infer<typeof examAttemptRef>;
export type AttemptQuestions = z.infer<typeof attemptQuestionsSchema>;
export type ReviewResults = Record<string, z.infer<typeof reviewResultSchema>>;

export const makeExamQuestionService = defineService()(() => {
	const forAttempt = op({
		transaction: false,
		args: [examAttemptRef],
		returns: attemptQuestionsSchema.nullable(),
		run: async (): Promise<AttemptQuestions | null> => {
			throw new Error("not implemented");
		},
	});

	const reviews = op({
		transaction: false,
		args: [examAttemptRef, reviewOutcomes],
		returns: z.record(slug, reviewResultSchema),
		run: async (): Promise<ReviewResults> => {
			throw new Error("not implemented");
		},
	});

	const titles = op({
		transaction: false,
		args: [examAttemptRef],
		returns: z.record(slug, z.string()),
		run: async (): Promise<Record<string, string>> => {
			throw new Error("not implemented");
		},
	});

	return { forAttempt, reviews, titles };
});
