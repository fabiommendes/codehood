import { defineAction } from "astro:actions";
import { requireUser } from "@/auth/require-user";
import { answerEditAppendRequest, examParams } from "@/core/schemas";
import { db } from "@/db";
import type { AnswerEditFieldInput } from "@/db/services/answer-edit.service";
import { parseCourseParams } from "@/urls";
import { withActionErrors } from "./helpers";

/// The attempt a call addresses: the exam as URL segments plus the attempt's `publicId`.
const attemptParams = examParams.extend({
	attempt: answerEditAppendRequest.shape.attempt,
});

/// Builds the service reference from validated input only, so nothing else in a request body reaches it.
function attemptRef(input: {
	discipline: string;
	course: string;
	exam: string;
	attempt: string;
}) {
	return {
		course: parseCourseParams(input),
		exam: input.exam,
		attempt: input.attempt,
	};
}

export const answerHistory = {
	/**
	 * Tells the actor's browser where the server's history of each field of an attempt stands.
	 *
	 * A thin layer over `db.answerEdit.inspect`; only the author of the attempt may ask.
	 */
	inspect: defineAction({
		input: attemptParams,
		handler: withActionErrors(async (input, context) => {
			const actor = requireUser(context);
			return db.answerEdit.inspect(attemptRef(input), { actor });
		}),
	}),

	/**
	 * Stores the edit batches and gap markers a browser collected, one result per item.
	 *
	 * A thin layer over `db.answerEdit.append`. The clock is the server's and
	 * the author is the session's: the schema drops every other key of the body.
	 */
	send: defineAction({
		input: attemptParams.extend({
			fields: answerEditAppendRequest.shape.fields,
		}),
		handler: withActionErrors(async (input, context) => {
			const actor = requireUser(context);
			return db.answerEdit.append(
				{
					...attemptRef(input),
					// The service checks each item itself; the type only describes a well-formed one.
					fields: input.fields as AnswerEditFieldInput[],
				},
				{ actor },
			);
		}),
	}),
};
