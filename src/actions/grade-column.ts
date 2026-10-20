import { defineAction } from "astro:actions";
import { requireUser } from "@/auth/require-user";
import { gradeColumnRelease } from "@/core/schemas";
import { db } from "@/db";
import { parseCourseParams } from "@/urls";
import { withServiceErrors } from "./helpers";

export const gradeColumn = {
	/** Releases a grade column to its students (instructor only). */
	release: defineAction({
		input: gradeColumnRelease,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const released = await db.gradeColumn.release(
				{ course: parseCourseParams(input), slug: input.slug },
				{ actor },
			);
			return { releasedAt: released.releasedAt };
		}),
	}),
};
