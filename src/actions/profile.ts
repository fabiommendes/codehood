import type { ActionAPIContext } from "astro:actions";
import { ActionError, defineAction } from "astro:actions";
import { requireUser } from "@/auth/require-user";
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/core/constants";
import { FieldError, NotAllowed } from "@/core/error";
import { profileUpdate } from "@/core/schemas";
import { db, schema } from "@/db";
import { m } from "@/i18n";
import { uniqueConstraintError, withActionErrors } from "./helpers";

export const profile = {
	update: defineAction({
		accept: "form",
		input: profileUpdate,
		handler: withActionErrors(async (input, context) => {
			const actor = requireUser(context);
			if (actor.role === "STUDENT") {
				if (!input.githubId) {
					throw new FieldError("githubId", m.errors_required_for_students());
				}
				if (!input.schoolId) {
					throw new FieldError("schoolId", m.errors_required_for_students());
				}
			}
			try {
				await db.user.update({ username: actor.username }, input, {
					actor,
				});
			} catch (error) {
				throw uniqueConstraintError(error) ?? error;
			}
		}),
	}),

	changePassword: defineAction({
		accept: "form",
		input: schema.passwordChange,
		handler: withActionErrors(async (input, context) => {
			const actor = requireUser(context);
			const user = await db.user.findOne(
				{ username: actor.username },
				{ actor },
			);
			if (!user) {
				throw new ActionError({
					code: "UNAUTHORIZED",
					message: m.errors_current_password_incorrect(),
				});
			}

			try {
				await db.user.changePassword(user, input, { actor });
			} catch (error) {
				if (error instanceof NotAllowed) {
					throw new FieldError("currentPassword", error.message);
				}
				throw error;
			}

			// The change revoked every session, this one included. Minting a
			// replacement keeps the device the change was made from signed in,
			// while the others still have to log in again.
			const { token, session } = await db.session.create(
				{ username: user.username },
				{ actor },
			);
			context.cookies.set(SESSION_COOKIE, token, {
				...SESSION_COOKIE_OPTIONS,
				expires: session.expiresAt,
			});
		}),
	}),

	/**
	 * Gives the signed-in user a new calendar feed URL, creating the feed when there is none.
	 *
	 * The previous URL, if any, stops working at once. Returns nothing; the
	 * profile page reads the feed again. Refuses a visitor with no session the
	 * way `requireUser` does.
	 */
	rotateCalendarFeed: defineAction({
		accept: "form",
		handler: withActionErrors(
			async (_input: unknown, context: ActionAPIContext) => {
				const actor = requireUser(context);
				await db.calendarFeed.rotate(actor.username, { actor });
			},
		),
	}),

	/**
	 * Turns off the signed-in user's calendar feed; does nothing when there is none.
	 *
	 * Refuses a visitor with no session the way `requireUser` does.
	 */
	removeCalendarFeed: defineAction({
		accept: "form",
		handler: withActionErrors(
			async (_input: unknown, context: ActionAPIContext) => {
				const actor = requireUser(context);
				await db.calendarFeed.remove(actor.username, { actor });
			},
		),
	}),

	logoutEverywhere: defineAction({
		accept: "form",
		handler: async (_input, context) => {
			const actor = requireUser(context);
			await db.session.delete({ username: actor.username }, { actor });
			context.cookies.delete(SESSION_COOKIE, { path: "/" });
		},
	}),
};
