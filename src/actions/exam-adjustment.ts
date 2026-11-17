import { defineAction } from "astro:actions";
import { requireUser } from "@/auth/require-user";
import { FieldError, InvalidData } from "@/core/error";
import {
	examAdjustmentCreateForm,
	examAdjustmentRevokeForm,
	examAdjustmentUpdateForm,
} from "@/core/schemas/exam-adjustment";
import { db } from "@/db";
import { parseCourseParams } from "@/urls";
import { withServiceErrors } from "./helpers";

export const examAdjustment = {
	/**
	 * Adjusts the score of each of `usernames` on the exam, or on one of its questions (instructor only).
	 */
	create: defineAction({
		input: examAdjustmentCreateForm,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const { discipline, course, ...rest } = input;
			try {
				await db.examAdjustment.create(
					{ ...rest, course: parseCourseParams({ discipline, course }) },
					{ actor },
				);
			} catch (error) {
				if (!(error instanceof InvalidData)) throw error;
				const [field, issues] = Object.entries(error.errors)[0] ?? [];
				throw new FieldError(
					field ?? "$",
					issues?.[0]?.message ?? error.message,
				);
			}
		}),
	}),

	/**
	 * Changes the operation, value, reason or notes of an active adjustment (instructor only).
	 */
	update: defineAction({
		input: examAdjustmentUpdateForm,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const { discipline, course, exam, adjustment, updatedAt, ...fields } =
				input;
			await db.examAdjustment.update(
				{
					course: parseCourseParams({ discipline, course }),
					exam,
					publicId: adjustment,
				},
				fields,
				{ actor, expectedUpdatedAt: updatedAt },
			);
		}),
	}),

	/**
	 * Lifts an active adjustment (instructor only).
	 */
	revoke: defineAction({
		input: examAdjustmentRevokeForm,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const { discipline, course, exam, adjustment, updatedAt } = input;
			await db.examAdjustment.revoke(
				{
					course: parseCourseParams({ discipline, course }),
					exam,
					publicId: adjustment,
				},
				{ actor, expectedUpdatedAt: updatedAt },
			);
		}),
	}),
};
