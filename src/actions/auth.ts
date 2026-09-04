import { ActionError, defineAction } from "astro:actions";
import { z } from "astro/zod";
import { verifyPassword } from "@/auth/password";
import { requireUser } from "@/auth/require-user";
import { FULL_ACCESS } from "@/core/actor";
import * as schema from "@/core/schemas";
import { prisma } from "@/db/client";
import { apiKeyService } from "@/db/services/api-key.service";
import { courseService } from "@/db/services/course.service";
import {
	checkRedeemable,
	InviteError,
	inviteService,
} from "@/db/services/invite.service";
import { sessionService } from "@/db/services/session.service";
import { type User, userService } from "@/db/services/user.service";
import { SESSION_COOKIE } from "@/middleware";
import { USERNAME_RE } from "@/utils/course-url";
import { withActionErrors } from "./helpers";

const SESSION_COOKIE_OPTS = {
	httpOnly: true,
	secure: import.meta.env.PROD,
	sameSite: "lax" as const,
	path: "/",
};

export type PublicUser = Omit<User, "passwordHash" | "id" | "publicId"> & {
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
			const user = await userService.findOne(
				{ login: input.login },
				FULL_ACCESS,
			);
			if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
				throw new ActionError({
					code: "UNAUTHORIZED",
					message: "Invalid email/username or password.",
				});
			}
			const { token, session } = await sessionService.create(
				{ userId: user.id },
				FULL_ACCESS,
			);
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
			if (token) await sessionService.delete({ token }, FULL_ACCESS);
			context.cookies.delete(SESSION_COOKIE, { path: "/" });
		},
	}),

	acceptInvite: defineAction({
		accept: "form",
		input: z.object({
			token: z.string(),
			email: z.email(),
			username: z.string().regex(USERNAME_RE, "Invalid username."),
			name: z.string().min(1),
			password: z.string().min(8),
			githubId: z.string().min(1),
			schoolId: z.string().min(1),
		}),
		handler: async (input, context) => {
			const invite = await inviteService.findOne(
				{ token: input.token },
				FULL_ACCESS,
			);
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

			// One transaction: a redemption failure (race on maxUses, etc.) must not
			// leave behind a User row with no invite and no course to show for it.
			let user: User;
			try {
				user = await prisma.$transaction(async (tx) => {
					const createdUser = await userService.create(
						{
							email: input.email,
							username: input.username,
							name: input.name,
							role: invite.role,
							password: input.password,
							githubId: input.githubId,
							schoolId: input.schoolId,
						},
						{ ...FULL_ACCESS, tx },
					);
					await inviteService.redeem(input.token, createdUser.id, input.email, {
						tx,
					});
					if (invite.courseId) {
						await courseService.enroll(
							{ courseId: invite.courseId, userId: createdUser.id },
							{ ...FULL_ACCESS, tx },
						);
					}
					return createdUser;
				});
			} catch (error) {
				if (error instanceof InviteError) {
					throw new ActionError({
						code: "BAD_REQUEST",
						message: inviteErrorMessage(error.code),
					});
				}
				throw error;
			}

			const { token: sessionToken, session } = await sessionService.create(
				{ userId: user.id },
				FULL_ACCESS,
			);
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
		handler: withActionErrors(async (input, context) => {
			const actor = requireUser(context);
			const { token } = await inviteService.create(
				{
					...input,
					kind: "PERSONAL",
					maxUses: 1,
					createdById: actor.id,
				},
				{ actor },
			);
			return { token };
		}),
	}),

	createClassroomInvite: defineAction({
		input: z.object({
			courseId: z.number().int(),
			maxUses: z.number().int().positive().optional(),
		}),
		handler: withActionErrors(async (input, context) => {
			const actor = requireUser(context);
			const { token } = await inviteService.create(
				{
					...input,
					kind: "CLASSROOM",
					role: "STUDENT",
					createdById: actor.id,
				},
				{ actor },
			);
			return { token };
		}),
	}),

	createApiKey: defineAction({
		accept: "form",
		input: z.object({ name: z.string().min(1), kind: z.enum(["CLI", "BOT"]) }),
		handler: withActionErrors(async (input, context) => {
			const actor = requireUser(context);
			const { token } = await apiKeyService.create(
				{
					userId: actor.id,
					name: input.name,
					kind: input.kind,
				},
				{ actor },
			);
			return { token };
		}),
	}),

	revokeApiKey: defineAction({
		accept: "form",
		input: schema.apiKeyPK,
		handler: withActionErrors(async (input, context) => {
			const actor = requireUser(context);
			await apiKeyService.delete({ id: input.id }, { actor });
		}),
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

function publicUser(user: User): PublicUser {
	return {
		id: user.publicId,
		email: user.email,
		name: user.name,
		username: user.username,
		role: user.role,
		githubId: user.githubId ?? undefined,
		schoolId: user.schoolId ?? undefined,
	};
}
