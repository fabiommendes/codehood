import { ActionError, defineAction } from "astro:actions";
import { z } from "astro/zod";
import { requireUser } from "@/auth/require-user";
import { db, type schema } from "@/db";
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
		input: z.object({
			courseId: z.coerce.number().int(),
			slug: z.string().min(1),
			status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
		}),
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const courseId = input.courseId as schema.CourseId;

			const existing = await db.question.findOne(
				{ course: courseId, slug: input.slug, public: false },
				{ actor },
			);
			if (!existing) {
				throw new ActionError({
					code: "NOT_FOUND",
					message: `Question "${input.slug}" not found.`,
				});
			}

			if (existing.status === "ARCHIVED") {
				return db.question.upsert(
					{
						course: courseId,
						slug: input.slug,
						status: input.status,
						version: existing.version,
						question: existing.question,
					},
					{ actor },
				);
			}

			return db.question.update(
				{ course: courseId, slug: input.slug },
				{ status: input.status },
				{ actor },
			);
		}),
	}),
};
