import { defineAction } from "astro:actions";
import { requireUser } from "@/auth/require-user";
import { FieldError, InvalidData, NotFound } from "@/core/error";
import {
	examAnswer,
	examExceptionRemove,
	examExceptionSave,
	examParams,
	examReopenAttempt,
} from "@/core/schemas";
import { db } from "@/db";
import { parseCourseParams } from "@/urls";
import { toDuration } from "@/utils/schedule-time";
import { withServiceErrors } from "./helpers";

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
		input: examAnswer,
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

	/** Releases the exam's grades to its students (instructor only). */
	releaseGrades: defineAction({
		input: examParams,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const released = await db.exam.releaseGrades(
				{ course: parseCourseParams(input), slug: input.exam },
				{ actor },
			);
			return { releasedAt: released.gradesReleasedAt };
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

	/**
	 * Reopens one student's closed attempt so they can keep answering (instructor only).
	 *
	 * A thin layer over `db.response.update` with `acceptingSubmissions: true`
	 * on the student's graded attempt; the answers already given stay.
	 *
	 * @throws {@link NotFound} If the course, the exam or the attempt does not exist.
	 * @throws {@link NotAllowed} If the actor does not own the course.
	 * @throws {@link InvalidData} If the student's personal window has already closed.
	 */
	reopenAttempt: defineAction({
		input: examReopenAttempt,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const course = parseCourseParams(input);
			const [attempt] = await db.response.findMany(
				{ course, exam: input.exam, author: input.username, practice: false },
				{ actor },
			);
			if (!attempt) throw new NotFound("response");
			await db.response.update(
				{ publicId: attempt.publicId, course },
				{ acceptingSubmissions: true },
				{ actor },
			);
		}),
	}),

	/**
	 * Grants or changes one student's exception on an exam (instructor only).
	 *
	 * A thin layer over `db.examException.upsert`: an empty extra time or date
	 * clears that part. A rule the service refuses shows on its field.
	 */
	saveException: defineAction({
		input: examExceptionSave,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			try {
				await db.examException.upsert(
					{
						course: parseCourseParams({
							discipline: input.discipline,
							course: input.course,
						}),
						exam: input.exam,
						username: input.username,
						extraTime: input.extraMinutes
							? toDuration(input.extraMinutes)
							: null,
						scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
						note: input.note || null,
					},
					{ actor },
				);
			} catch (error) {
				if (!(error instanceof InvalidData)) throw error;
				const [field, issues] = Object.entries(error.errors)[0] ?? [];
				const message = issues?.[0]?.message ?? error.message;
				throw new FieldError(
					field === "extraTime" ? "extraMinutes" : (field ?? "$"),
					message,
				);
			}
		}),
	}),

	/** Removes one student's exception, taking them back to the exam's own timing (instructor only). */
	removeException: defineAction({
		input: examExceptionRemove,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await db.examException.delete(
				{
					course: parseCourseParams(input),
					exam: input.exam,
					username: input.username,
				},
				{ actor },
			);
		}),
	}),
};
