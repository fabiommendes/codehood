import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { requireUser } from "@/auth/require-user";
import { db } from "@/db";
import { parseCourseParams } from "@/urls";
import { withServiceErrors } from "./helpers";

/// The course and exam every exam action addresses, as the page's URL segments.
const examParams = z.object({
	discipline: z.string().min(1),
	course: z.string().min(1),
	exam: z.string().min(1),
});

export const exam = {
	/** Opens the actor's attempt at an exam that is open now. */
	start: defineAction({
		input: examParams,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await db.response.create(
				{ course: parseCourseParams(input), exam: input.exam },
				{ actor },
			);
		}),
	}),

	/** Records the actor's answer to one question of their open attempt. */
	answer: defineAction({
		input: examParams.extend({
			question: z.string().min(1),
			payload: z.record(z.string(), z.unknown()),
		}),
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const { payload, question, ...rest } = input;
			await db.response.submit(
				{
					course: parseCourseParams(rest),
					exam: input.exam,
					question,
					payload,
				},
				{ actor },
			);
		}),
	}),

	/** Closes the actor's attempt; no further answers are accepted. */
	finish: defineAction({
		input: examParams,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await db.response.finish(
				{ course: parseCourseParams(input), exam: input.exam },
				{ actor },
			);
		}),
	}),
};
