import { z } from "zod";
import { METHOD } from "./registry";

/**
 * `debug.whoami` — reports the actor behind the credentials the request
 * carried.
 *
 * The first question to ask when a CLI is talking to the wrong instance or
 * holding a stale key.
 */
export const whoami = METHOD("debug.whoami", {
	out: z.object({
		username: z.string(),
		name: z.string(),
		role: z.string(),
	}),
	summary: "Report the authenticated actor",
	description:
		"Echoes back who the server thinks you are, for diagnosing credentials that point somewhere unexpected.",
	tags: ["System"],
	handler: async ({ actor }) => ({
		username: actor.username,
		name: actor.name,
		role: actor.role,
	}),
});
