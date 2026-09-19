/**
 * RPC methods used by the CLI client.
 */

import { z } from "zod";
import { NotFound } from "@/core/error";
import * as schemas from "@/core/schemas";
import { db } from "@/db";
import { METHOD } from "./registry";

export const courseSyncState = z.object({
	resources: z.array(
		z.object({
			slug: z.string(),
			hash: z.string(),
			timestamp: z.date(),
		}),
	),
});

/**
 * `cli.course.preSync` — Used before `ch push` to check the state of the
 * remote repository before pushing changes.
 *
 * The CLI uses the result from this method to determine which changes need to
 * be updated before pushing.
 */
export const getState = METHOD("cli.course.preSync", {
	in: schemas.courseNaturalKey,
	out: courseSyncState,
	summary: "Report the authenticated actor",
	description:
		"Echoes back who the server thinks you are, for diagnosing credentials that point somewhere unexpected.",
	tags: ["System"],
	handler: async ({ actor, body }) => {
		const course = await db.course.findOne({ ...body }, { actor });
		if (!course) throw new NotFound("course", db.course.naturalKey(body));

		// const resources = await db.resource.findMany(
		// 	{ courseId: course.id },
		// 	{ actor },
		// );

		return {
			resources: [],
		};
	},
});
