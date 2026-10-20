import { ActionError, defineAction } from "astro:actions";
import { requireUser } from "@/auth/require-user";
import { questionStatusUpdate } from "@/core/schemas";
import { db } from "@/db";
import { m } from "@/i18n";
import { parseCourseParams } from "@/urls";
import { withServiceErrors } from "./helpers";

export const question = {
	/**
	 * Moves a question to `status`, called from the question bank table's
	 * archive/status control.
	 *
	 * `update` refuses to touch an archived row (FR-SYNC-012), so reviving one
	 * goes through `upsert` instead, carrying its current document forward
	 * unchanged — the same distinction `course.addStudent` draws between an
	 * existing and a not-yet-existing account.
	 */
	updateStatus: defineAction({
		input: questionStatusUpdate,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const course = parseCourseParams(input);

			const existing = await db.question.findOne(
				{ course, slug: input.slug, public: false },
				{ actor },
			);
			if (!existing) {
				throw new ActionError({
					code: "NOT_FOUND",
					message: m.errors_question_not_found({ slug: input.slug }),
				});
			}

			if (existing.status === "ARCHIVED") {
				const updated = await db.question.upsert(
					{
						course,
						slug: input.slug,
						status: input.status,
						version: existing.version,
						question: existing.question,
					},
					{ actor },
				);
				return { status: updated.status };
			}

			const updated = await db.question.update(
				{ course, slug: input.slug },
				{ status: input.status },
				{ actor },
			);
			return { status: updated.status };
		}),
	}),
};
