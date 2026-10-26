import { defineAction } from "astro:actions";
import { requireUser } from "@/auth/require-user";
import { FieldError } from "@/core/error";
import { reportForm, reportRef, reportTriageForm } from "@/core/schemas";
import { db } from "@/db";
import { m } from "@/i18n";
import { parseCourseParams } from "@/urls";
import { withServiceErrors } from "./helpers";

export const report = {
	/**
	 * Sends a report as the actor, with the context the page captured and up to three images.
	 *
	 * A `CONTENT` report needs the course of the page it was sent from.
	 */
	create: defineAction({
		accept: "form",
		input: reportForm,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const course =
				input.discipline && input.course
					? parseCourseParams({
							discipline: input.discipline,
							course: input.course,
						})
					: null;
			if (input.kind === "CONTENT" && !course) {
				throw new FieldError("kind", m.forms_schema_report_course_required());
			}
			const attachments = await Promise.all(
				(input.images ?? []).map(async (file) => ({
					filename: file.name,
					bytes: Buffer.from(await file.arrayBuffer()),
				})),
			);
			await db.report.create(
				{
					kind: input.kind,
					message: input.message,
					url: input.url,
					userAgent: input.userAgent,
					viewport: input.viewport,
					course,
					attachments,
				},
				{ actor },
			);
		}),
	}),

	/**
	 * Changes the status, type or note of a report (admin, or the instructor of a `CONTENT` report).
	 */
	triage: defineAction({
		input: reportTriageForm,
		handler: withServiceErrors(async ({ publicId, ...update }, context) => {
			const actor = requireUser(context);
			await db.report.update({ publicId }, update, { actor });
		}),
	}),

	/**
	 * Deletes a report (its author while it is `OPEN`, or an admin).
	 */
	delete: defineAction({
		input: reportRef,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await db.report.delete(input, { actor });
		}),
	}),
};
