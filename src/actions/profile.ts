import { ActionError, defineAction } from "astro:actions";
import { z } from "astro/zod";
import { verifyPassword } from "@/auth/password";
import { requireUser } from "@/auth/require-user";
import { sessionService } from "@/db/services/session.service";
import { userService } from "@/db/services/user.service";
import { SESSION_COOKIE } from "@/middleware";

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
				await userService.update({ id: actor.id }, input, { actor });
			} catch (error) {
				const message = uniqueConstraintMessage(error);
				if (message) throw new ActionError({ code: "BAD_REQUEST", message });
				throw error;
			}
		},
	}),

	changePassword: defineAction({
		accept: "form",
		input: z.object({
			currentPassword: z.string().min(1),
			newPassword: z.string().min(8),
		}),
		handler: async (input, context) => {
			const actor = requireUser(context);
			const user = await userService.findOne({ id: actor.id }, { actor });
			if (
				!user ||
				!(await verifyPassword(user.passwordHash, input.currentPassword))
			) {
				throw new ActionError({
					code: "UNAUTHORIZED",
					message: "Current password is incorrect.",
				});
			}
			await userService.updatePassword(user, input.newPassword, { actor });
		},
	}),

	logoutEverywhere: defineAction({
		accept: "form",
		handler: async (_input, context) => {
			const actor = requireUser(context);
			await sessionService.delete({ userId: actor.id }, { actor });
			context.cookies.delete(SESSION_COOKIE, { path: "/" });
		},
	}),
};
