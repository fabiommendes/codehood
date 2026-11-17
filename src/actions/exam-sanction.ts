import { defineAction } from "astro:actions";
import { requireUser } from "@/auth/require-user";
import { FieldError, InvalidData } from "@/core/error";
import {
	examSanctionCreateForm,
	examSanctionRevokeForm,
	examSanctionUpdateForm,
} from "@/core/schemas";
import { db } from "@/db";
import { parseCourseParams } from "@/urls";
import { withServiceErrors } from "./helpers";

export const examSanction = {
	/**
	 * Sanctions each of `usernames` on the exam, or on one of its questions (instructor only).
	 */
	create: defineAction({
		input: examSanctionCreateForm,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const { discipline, course, ...rest } = input;
			try {
				await db.examSanction.create(
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
	 * Changes the factor, reason or notes of an active sanction (instructor only).
	 */
	update: defineAction({
		input: examSanctionUpdateForm,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const { discipline, course, exam, sanction, updatedAt, ...fields } =
				input;
			await db.examSanction.update(
				{
					course: parseCourseParams({ discipline, course }),
					exam,
					publicId: sanction,
				},
				fields,
				{ actor, expectedUpdatedAt: updatedAt },
			);
		}),
	}),

	/**
	 * Lifts an active sanction (instructor only).
	 */
	revoke: defineAction({
		input: examSanctionRevokeForm,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const { discipline, course, exam, sanction, updatedAt } = input;
			await db.examSanction.revoke(
				{
					course: parseCourseParams({ discipline, course }),
					exam,
					publicId: sanction,
				},
				{ actor, expectedUpdatedAt: updatedAt },
			);
		}),
	}),
};
