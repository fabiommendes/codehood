import { ActionError, defineAction } from "astro:actions";
import { z } from "astro/zod";
import { verifyPassword } from "@/auth/password";
import { canInvite, canManageApiKeys } from "@/auth/permissions";
import { requireUser } from "@/auth/require-user";
import { apiKeyService } from "@/db/api-key.service";
import {
	checkRedeemable,
	InviteError,
	inviteService,
} from "@/db/invite.service";
import { sessionService } from "@/db/session.service";
import { type User as ServiceUser, userService } from "@/db/user.service";
import { SESSION_COOKIE } from "@/middleware/session";

const SESSION_COOKIE_OPTS = {
	httpOnly: true,
	secure: import.meta.env.PROD,
	sameSite: "lax" as const,
	path: "/",
};

export type User = Omit<ServiceUser, "passwordHash" | "id" | "publicId"> & {
	id: string;
};

export const auth = {
	login: defineAction({
		accept: "form",
		input: z.object({
			login: z.string().min(1),
			password: z.string().min(1),
		}),
		handler: async (input, context) => {
			const user = await userService.findOne({ login: input.login });
			if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
				throw new ActionError({
					code: "UNAUTHORIZED",
					message: "Invalid email/username or password.",
				});
			}
			const { token, session } = await sessionService.create({
				userId: user.id,
			});
			context.cookies.set(SESSION_COOKIE, token, {
				...SESSION_COOKIE_OPTS,
				expires: session.expiresAt,
			});
			return publicUser(user);
		},
	}),

	logout: defineAction({
		accept: "form",
		handler: async (_input, context) => {
			const token = context.cookies.get(SESSION_COOKIE)?.value;
			if (token) await sessionService.revokeByToken(token);
			context.cookies.delete(SESSION_COOKIE, { path: "/" });
		},
	}),

	acceptInvite: defineAction({
		accept: "form",
		input: z.object({
			token: z.string(),
			email: z.email(),
			username: z.string().min(1),
			name: z.string().min(1),
			password: z.string().min(8),
			githubId: z.string().min(1),
			schoolId: z.string().min(1),
		}),
		handler: async (input, context) => {
			const invite = await inviteService.findOne({ token: input.token });
			if (!invite)
				throw new ActionError({
					code: "NOT_FOUND",
					message: "Invite not found or expired.",
				});
			const precheckError = checkRedeemable(invite, input.email);
			if (precheckError) {
				throw new ActionError({
					code: "BAD_REQUEST",
					message: inviteErrorMessage(precheckError),
				});
			}

			const user = await userService.create({
				email: input.email,
				username: input.username,
				name: input.name,
				role: invite.role,
				password: input.password,
				githubId: input.githubId,
				schoolId: input.schoolId,
			});

			try {
				await inviteService.redeem(input.token, user.id, input.email);
			} catch (error) {
				if (error instanceof InviteError) {
					throw new ActionError({
						code: "BAD_REQUEST",
						message: inviteErrorMessage(error.code),
					});
				}
				throw error;
			}

			const { token: sessionToken, session } = await sessionService.create({
				userId: user.id,
			});
			context.cookies.set(SESSION_COOKIE, sessionToken, {
				...SESSION_COOKIE_OPTS,
				expires: session.expiresAt,
			});
			return { role: user.role };
		},
	}),

	createPersonalInvite: defineAction({
		input: z.object({
			email: z.email(),
			role: z.enum(["INSTRUCTOR", "STUDENT"]),
			courseId: z.number().int().optional(),
		}),
		handler: async (input, context) => {
			const actor = requireUser(context);
			if (!canInvite(actor, input.role)) {
				throw new ActionError({
					code: "FORBIDDEN",
					message: `You cannot invite a ${input.role}.`,
				});
			}
			const { token } = await inviteService.createPersonalCode({
				...input,
				createdById: actor.id,
			});
			return { token };
		},
	}),

	createClassroomInvite: defineAction({
		input: z.object({
			courseId: z.number().int(),
			maxUses: z.number().int().positive().optional(),
		}),
		handler: async (input, context) => {
			const actor = requireUser(context);
			if (!canInvite(actor, "STUDENT")) {
				throw new ActionError({
					code: "FORBIDDEN",
					message: "You cannot invite students.",
				});
			}
			const { token } = await inviteService.createClassroomCode({
				...input,
				createdById: actor.id,
			});
			return { token };
		},
	}),

	createApiKey: defineAction({
		accept: "form",
		input: z.object({ name: z.string().min(1), kind: z.enum(["CLI", "BOT"]) }),
		handler: async (input, context) => {
			const actor = requireUser(context);
			const { token } = await apiKeyService.create({
				userId: actor.id,
				name: input.name,
				kind: input.kind,
			});
			return { token };
		},
	}),

	revokeApiKey: defineAction({
		accept: "form",
		input: z.object({ id: z.coerce.number().int() }),
		handler: async (input, context) => {
			const actor = requireUser(context);
			const apiKey = await apiKeyService.findOne({ id: input.id });
			if (!apiKey || !canManageApiKeys(actor, apiKey.userId)) {
				throw new ActionError({ code: "FORBIDDEN" });
			}
			await apiKeyService.revoke(input.id);
		},
	}),
};

function inviteErrorMessage(code: InviteError["code"]): string {
	switch (code) {
		case "not_found":
			return "Invite not found.";
		case "expired":
			return "This invite has expired.";
		case "email_mismatch":
			return "This invite was issued for a different email address.";
		case "exhausted":
			return "This invite has reached its maximum number of uses.";
		case "already_redeemed":
			return "You already have an account.";
	}
}

function publicUser(user: ServiceUser): User {
	return {
		id: user.publicId,
		email: user.email,
		name: user.name,
		username: user.username,
		role: user.role,
		image: user.image,
		githubId: user.githubId ?? undefined,
		schoolId: user.schoolId ?? undefined,
	};
}
