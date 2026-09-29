import { defineAction } from "astro:actions";
import { randomUUID } from "node:crypto";
import { z } from "astro/zod";
import { requireUser } from "@/auth/require-user";
import { NotFound } from "@/core/error";
import { db } from "@/db";
import { parsePercentScore, SCORE_ERROR } from "@/services/grading";
import { parseCourseParams } from "@/urls";
import { withServiceErrors } from "./helpers";

/// The answer every grading action addresses: the page's URL segments and the submission's `publicId`.
const answerParams = z.object({
	discipline: z.string().min(1),
	course: z.string().min(1),
	exam: z.string().min(1),
	submission: z.string().min(1),
});

export const grading = {
	/**
	 * Records a new grading pass by the actor on one answer (instructor only).
	 *
	 * `score` is the text typed in the form, a whole percentage from 0 to 100.
	 * A comment of only whitespace is stored as no comment. A submission of
	 * another course or exam is not found.
	 */
	grade: defineAction({
		input: answerParams.extend({
			score: z.string(),
			comment: z.string().optional(),
		}),
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const score = parsePercentScore(input.score);
			if (score === null) throw new Error(SCORE_ERROR);

			const course = parseCourseParams(input);
			const submission = await db.submission.findOne(
				{ publicId: input.submission, course },
				{ actor },
			);
			const response = submission
				? await db.response.findOne(
						{ publicId: submission.response, course },
						{ actor },
					)
				: null;
			if (response?.exam !== input.exam) {
				throw new NotFound("submission", { id: input.submission });
			}

			const comment = input.comment?.trim();
			await db.feedback.create(
				{
					submission: { publicId: input.submission, course },
					ref: `web-${randomUUID()}`,
					score,
					feedback: comment ? comment : null,
				},
				{ actor },
			);
		}),
	}),
};
