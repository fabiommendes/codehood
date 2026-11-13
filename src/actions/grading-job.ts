import { defineAction } from "astro:actions";
import { requireUser } from "@/auth/require-user";
import { gradingJobStudentQuery, gradingQuestion } from "@/core/schemas";
import { db } from "@/db";
import { parseCourseParams } from "@/urls";
import { withServiceErrors } from "./helpers";

export const gradingJob = {
	/**
	 * Reads the state of the grading queue of one question: counts, failed jobs and the instructor's bot keys (instructor only).
	 */
	summary: defineAction({
		input: gradingQuestion,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			return db.gradingJob.summary(
				{
					course: parseCourseParams(input),
					exam: input.exam,
					question: input.question,
				},
				{ actor },
			);
		}),
	}),

	/**
	 * Puts the failed grading jobs of one question back in the queue (instructor only).
	 */
	requeueFailed: defineAction({
		input: gradingQuestion,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			return db.gradingJob.requeueFailed(
				{
					course: parseCourseParams(input),
					exam: input.exam,
					question: input.question,
				},
				{ actor },
			);
		}),
	}),

	/**
	 * Reads the status and, once released, the result of the actor's own submissions of one question.
	 */
	forStudent: defineAction({
		input: gradingJobStudentQuery,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			return db.gradingJob.forStudent(input, { actor });
		}),
	}),
};
