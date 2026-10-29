import { defineAction } from "astro:actions";
import { randomUUID } from "node:crypto";
import type { z } from "astro/zod";
import type { UserActor } from "@/auth/actor";
import { requireUser } from "@/auth/require-user";
import { InvalidData, NotFound } from "@/core/error";
import {
	answerGrade,
	answerGradeBlanks,
	type answerRef,
	answerWillNotGrade,
} from "@/core/schemas";
import { SCORE_ERROR } from "@/core/score";
import { db } from "@/db";
import { type PrismaTx, prisma } from "@/db/client";
import type { Feedback } from "@/db/services/feedback.service";
import { NotAutoGradable, type QuestionDocument, ResponseError } from "@/mdq";
import { parsePercentScore, WILL_NOT_GRADE_REF } from "@/services/grading";
import { blanksScore } from "@/services/review";
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
	 * Records a grading pass on a fill-in answer from a grade for each of its
	 * pending blanks (instructor only).
	 *
	 * The question score is what the mdq library combines the blank grades and
	 * the blanks it scores itself into, against the question version the exam
	 * pins. A grade for a blank that is not pending, or a pending blank left
	 * without one, is invalid data.
	 */
	gradeBlanks: defineAction({
		input: answerGradeBlanks,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const course = await checkedAnswer(input, actor);
			const { question, payload } = await gradedQuestion(input, actor);

			let score: number;
			try {
				score = blanksScore(question, payload, input.blanks);
			} catch (error) {
				if (
					error instanceof RangeError ||
					error instanceof NotAutoGradable ||
					error instanceof ResponseError
				) {
					throw new InvalidData(
						{ blanks: [{ code: "invalid", message: error.message }] },
						{ message: error.message },
					);
				}
				throw error;
			}
			await recordPass(
				input.submission,
				course,
				String(Number(score.toFixed(6))),
				input.comment,
				actor,
				{ blanks: input.blanks },
			);
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
		input: answerWillNotGrade,
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

/// The question document the exam pins for the answer `input` names, and the answer's payload.
async function gradedQuestion(
	input: z.infer<typeof answerRef>,
	actor: UserActor,
): Promise<{ question: QuestionDocument; payload: unknown }> {
	const course = parseCourseParams(input);
	const submission = await db.submission.findOne(
		{ publicId: input.submission, course },
		{ actor },
	);
	const exam = await db.exam.findOne({ course, slug: input.exam }, { actor });
	const pinned = exam?.questions.find(
		(entry) => entry.slug === submission?.question,
	);
	const stored =
		submission && pinned
			? await db.question.findOne(
					{
						course,
						slug: submission.question,
						public: false,
						version: pinned.version ?? null,
					},
					{ actor },
				)
			: null;
	if (!submission || !stored) {
		throw new NotFound("submission", { id: input.submission });
	}
	return { question: stored.question, payload: submission.payload };
}

/// Appends a grading pass by `actor`, under a `ref` no other pass shares; a blank comment is stored as none.
async function recordPass(
	submission: string,
	course: CourseNaturalKey,
	score: string,
	comment: string | undefined,
	actor: UserActor,
	options: { ref?: string; tx?: PrismaTx; blanks?: Feedback["blanks"] } = {},
): Promise<void> {
	const text = comment?.trim();
	await db.feedback.create(
		{
			submission: { publicId: submission, course },
			ref: options.ref ?? `web-${randomUUID()}`,
			score,
			feedback: text ? text : null,
			blanks: options.blanks ?? null,
		},
		{ actor, tx: options.tx },
	);
}
