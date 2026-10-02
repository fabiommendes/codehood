import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { requireUser } from "@/auth/require-user";
import { db } from "@/db";
import { parseCourseParams } from "@/urls";
import { withServiceErrors } from "./helpers";

export const gradeColumn = {
	/** Releases a grade column to its students (instructor only). */
	release: defineAction({
		input: z.object({
			discipline: z.string().min(1),
			course: z.string().min(1),
			slug: z.string().min(1),
		}),
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
