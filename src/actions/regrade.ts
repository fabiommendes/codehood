import { defineAction } from "astro:actions";
import type { z } from "astro/zod";
import type { UserActor } from "@/auth/actor";
import { requireUser } from "@/auth/require-user";
import { NotFound } from "@/core/error";
import {
	regradeAcceptForm,
	regradeRejectForm,
	regradeRequestForm,
	regradeRequestRef,
} from "@/core/schemas";
import { SCORE_ERROR } from "@/core/score";
import { db } from "@/db";
import { parsePercentScore } from "@/services/grading";
import { type CourseNaturalKey, parseCourseParams } from "@/urls";
import { withServiceErrors } from "./helpers";

export const regrade = {
	/**
	 * Opens the actor's regrade request on one of their answers of the exam.
	 *
	 * A submission of another course or exam is not found.
	 */
	request: defineAction({
		input: regradeRequestForm,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
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
			await db.regradeRequest.create(
				{ course, submission: input.submission, message: input.message },
				{ actor },
			);
		}),
	}),

	/**
	 * Withdraws the actor's own open request.
	 *
	 * A request of another course or exam is not found.
	 */
	withdraw: defineAction({
		input: regradeRequestRef,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const course = await checkedRequest(input, actor);
			await db.regradeRequest.delete(
				{ publicId: input.request, course },
				{ actor },
			);
		}),
	}),

	/**
	 * Accepts an open request with a new grade (instructor only).
	 *
	 * `score` is the whole percentage typed in the form, from 0 to 100,
	 * converted with `parsePercentScore`. A request of another course or exam
	 * is not found.
	 */
	accept: defineAction({
		input: regradeAcceptForm,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const score = parsePercentScore(input.score);
			if (score === null) throw new Error(SCORE_ERROR);
			const course = await checkedRequest(input, actor);
			await db.regradeRequest.accept(
				{ publicId: input.request, course },
				{ score, reply: input.reply },
				{ actor },
			);
		}),
	}),

	/**
	 * Rejects an open request with a reply (instructor only).
	 *
	 * A request of another course or exam is not found.
	 */
	reject: defineAction({
		input: regradeRejectForm,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const course = await checkedRequest(input, actor);
			await db.regradeRequest.reject(
				{ publicId: input.request, course },
				{ reply: input.reply },
				{ actor },
			);
		}),
	}),
};

/// The parsed course of `input`, once its request is known to belong to the exam it names.
async function checkedRequest(
	input: z.infer<typeof regradeRequestRef>,
	actor: UserActor,
): Promise<CourseNaturalKey> {
	const course = parseCourseParams(input);
	const request = await db.regradeRequest.findOne(
		{ publicId: input.request, course },
		{ actor },
	);
	if (request?.exam !== input.exam) {
		throw new NotFound("regrade request", { id: input.request });
	}
	return course;
}
