import { defineAction } from "astro:actions";
import { requireUser } from "@/auth/require-user";
import { repositoryRotate } from "@/core/schemas";
import { db } from "@/db";
import { parseCourseParams } from "@/urls";
import { withServiceErrors } from "./helpers";

export const repository = {
	/**
	 * Replaces the clone token of a repository, so its old clone URL stops
	 * resolving. Only whoever may write the course's contents can do it.
	 */
	rotateToken: defineAction({
		accept: "form",
		input: repositoryRotate,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const course = parseCourseParams(input);
			await db.repository.rotateToken({ course, slug: input.slug }, { actor });
		}),
	}),
};
