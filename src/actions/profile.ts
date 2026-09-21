import { ActionError, defineAction } from "astro:actions";
import { z } from "astro/zod";
import { requireUser } from "@/auth/require-user";
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/core/constants";
import { NotAllowed } from "@/core/error";
import { db, schema } from "@/db";

const FIELD_LABELS: Record<string, string> = {
	email: "email",
	githubId: "GitHub username",
	schoolId: "school id",
};

/**
 * Turns a Prisma unique-constraint violation into a message naming the conflicting field.
 */
function uniqueConstraintMessage(error: unknown): string | null {
	if (
		typeof error !== "object" ||
		error === null ||
		(error as { code?: string }).code !== "P2002"
	) {
		return null;
	}
	// The classic engine reports meta.target; the better-sqlite3 driver adapter instead
	// nests it under meta.driverAdapterError.cause.constraint.fields. Check both shapes.
	const meta = (error as { meta?: Record<string, unknown> }).meta ?? {};
	const adapterFields = (
		meta.driverAdapterError as
			| { cause?: { constraint?: { fields?: unknown } } }
			| undefined
	)?.cause?.constraint?.fields;
	const target = meta.target ?? adapterFields;
	const fields = Array.isArray(target)
		? target
		: typeof target === "string"
			? [target]
			: [];
	const field = fields.map((f) => FIELD_LABELS[f]).find(Boolean);
	return field
		? `That ${field} is already in use.`
		: "One of those values is already in use.";
}

export const profile = {
	update: defineAction({
		accept: "form",
		input: z.object({
			name: z.string().min(1),
			email: z.email(),
			githubId: z.string().min(1),
			schoolId: z.string().min(1),
		}),
		handler: async (input, context) => {
			const actor = requireUser(context);
			try {
				await db.user.update({ username: actor.username }, input, {
					actor,
				});
			} catch (error) {
				const message = uniqueConstraintMessage(error);
				if (message) throw new ActionError({ code: "BAD_REQUEST", message });
				throw error;
			}
		},
	}),

	changePassword: defineAction({
		accept: "form",
		input: schema.passwordChange,
		handler: async (input, context) => {
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
					throw new ActionError({
						code: "UNAUTHORIZED",
						message: error.message,
					});
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
		},
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
