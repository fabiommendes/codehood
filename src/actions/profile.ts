import { ActionError, defineAction } from "astro:actions";
import { requireUser } from "@/auth/require-user";
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/core/constants";
import { FieldError, NotAllowed } from "@/core/error";
import { profileUpdate } from "@/core/schemas";
import { db, schema } from "@/db";
import { uniqueConstraintError, withActionErrors } from "./helpers";

export const profile = {
	update: defineAction({
		accept: "form",
		input: profileUpdate,
		handler: withActionErrors(async (input, context) => {
			const actor = requireUser(context);
			if (actor.role === "STUDENT") {
				if (!input.githubId) {
					throw new FieldError("githubId", "Required for students.");
				}
				if (!input.schoolId) {
					throw new FieldError("schoolId", "Required for students.");
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
					message: "Current password is incorrect.",
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

	logoutEverywhere: defineAction({
		accept: "form",
		handler: async (_input, context) => {
			const actor = requireUser(context);
			await db.session.delete({ username: actor.username }, { actor });
			context.cookies.delete(SESSION_COOKIE, { path: "/" });
		},
	}),
};
