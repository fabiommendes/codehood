import { ActionError } from "astro:actions";

/**
 * Returns the logged-in user from an action context, or throws UNAUTHORIZED.
 */
export function requireUser(context: { locals: App.Locals }) {
	const user = context.locals.actor;
	if (!user) throw new ActionError({ code: "UNAUTHORIZED" });
	return user;
}
