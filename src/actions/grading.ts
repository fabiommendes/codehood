import { defineAction } from "astro:actions";
import { randomUUID } from "node:crypto";
import { z } from "astro/zod";
import type { UserActor } from "@/auth/actor";
import { requireUser } from "@/auth/require-user";
import { NotFound } from "@/core/error";
import { answerGrade, answerRef } from "@/core/schemas";
import { SCORE_ERROR } from "@/core/score";
import { db } from "@/db";
import { type PrismaTx, prisma } from "@/db/client";
import { parsePercentScore, WILL_NOT_GRADE_REF } from "@/services/grading";
import { type CourseNaturalKey, parseCourseParams } from "@/urls";
import { withServiceErrors } from "./helpers";

export const grading = {
	/**
	 * Records a new grading pass by the actor on one answer (instructor only).
	 *
	 * `score` is the text typed in the form, a whole percentage from 0 to 100.
	 * A comment of only whitespace is stored as no comment. A submission of
	 * another course or exam is not found.
	 */
	grade: defineAction({
		input: answerGrade,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const score = parsePercentScore(input.score);
			if (score === null) throw new Error(SCORE_ERROR);

			const course = await checkedAnswer(input, actor);
			await recordPass(input.submission, course, score, input.comment, actor);
		}),
	}),

	/**
	 * Marks one answer as will-not-grade (instructor only).
	 *
	 * A comment that is not empty is recorded as a grading pass by the actor
	 * with score zero, so the student reads it once grades are released. The
	 * submission's status is `WILL_NOT_GRADE` afterwards. A submission of
	 * another course or exam is not found.
	 */
	willNotGrade: defineAction({
		input: answerRef.extend({ comment: z.string().optional() }),
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const course = await checkedAnswer(input, actor);

			// One transaction: the comment's pass and the status land together.
			await prisma.$transaction(async (tx) => {
				if (input.comment?.trim()) {
					await recordPass(
						input.submission,
						course,
						"0",
						input.comment,
						actor,
						{
							ref: `${WILL_NOT_GRADE_REF}${randomUUID()}`,
							tx,
						},
					);
				}
				await db.submission.update(
					{ publicId: input.submission, course },
					{ status: "WILL_NOT_GRADE" },
					{ actor, tx },
				);
			});
		}),
	}),
};

/// The parsed course of `input`, once its submission is known to belong to the exam it names.
async function checkedAnswer(
	input: z.infer<typeof answerRef>,
	actor: UserActor,
): Promise<CourseNaturalKey> {
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
	return course;
}

/// Appends a grading pass by `actor`, under a `ref` no other pass shares; a blank comment is stored as none.
async function recordPass(
	submission: string,
	course: CourseNaturalKey,
	score: string,
	comment: string | undefined,
	actor: UserActor,
	options: { ref?: string; tx?: PrismaTx } = {},
): Promise<void> {
	const text = comment?.trim();
	await db.feedback.create(
		{
			submission: { publicId: submission, course },
			ref: options.ref ?? `web-${randomUUID()}`,
			score,
			feedback: text ? text : null,
		},
		{ actor, tx: options.tx },
	);
}
