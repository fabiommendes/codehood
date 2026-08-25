import { ActionError } from "astro:actions";
import * as z from "zod";
import { verifyPassword } from "@/auth/password";
import { canInvite } from "@/auth/permissions";
import {
	checkRedeemable,
	InviteError,
	inviteService,
} from "@/db/invite.service";
import type { Role } from "./client";
import { sessionService } from "./session.service";
import { type User, userService } from "./user.service";

export interface CreateUserInput {
	email: string;
	name: string;
	username: string;
	role: Role;
	password: string;
	githubId?: string;
	schoolId?: string;
}

export const login = z.object({
	login: z.string().min(1),
	password: z.string().min(1),
});

export const logout = z.object({
	token: z.string().min(1).optional(),
});

export const acceptInvite = z.object({
	token: z.string(),
	email: z.email(),
	username: z.string().min(1),
	name: z.string().min(1),
	password: z.string().min(8),
	githubId: z.string().min(1),
	schoolId: z.string().min(1),
});

export const createClassroomInvite = z.object({
	courseId: z.number().int(),
	maxUses: z.number().int().positive().optional(),
});

export const createPersonalInvite = z.object({
	email: z.email(),
	role: z.enum(["INSTRUCTOR", "STUDENT"]),
	courseId: z.number().int().optional(),
});

export type Login = z.infer<typeof login>;
export type Logout = z.infer<typeof logout>;
export type AcceptInvite = z.infer<typeof acceptInvite>;
export type CreateClassroomInvite = z.infer<typeof createClassroomInvite>;
export type CreatePersonalInvite = z.infer<typeof createPersonalInvite>;

export const authService = {
	/**
	 * Email/username and password login. Returns the user, session token, and
	 * session object if successful.
	 */
	async login(input: Login) {
		const user = await userService.findOne({ login: input.login });
		const passwordHash = user?.passwordHash ?? "";

		if (!user || !(await verifyPassword(passwordHash, input.password))) {
			throw new ActionError({
				code: "UNAUTHORIZED",
				message: "Invalid email/username or password.",
			});
		}
		const { token, session } = await sessionService.create(user.id);
		return { user, token, session };
	},

	/**
	 * Logout the current session.
	 */
	async logout(input: Logout) {
		if (input.token) await sessionService.revokeByToken(input.token);
	},

	/**
	 * Accept an invite to create a new user account.
	 */
	async acceptInvite(input: AcceptInvite) {
		const invite = await inviteService.findByToken(input.token);
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

		const { token, session } = await sessionService.create(user.id);
		return { user, token, session };
	},

	async createPersonalInvite(input: CreatePersonalInvite, user: User) {
		if (!canInvite(user, input.role)) {
			throw new ActionError({
				code: "FORBIDDEN",
				message: `You cannot invite a ${input.role}.`,
			});
		}
		const { token } = await inviteService.createPersonalCode({
			...input,
			createdById: user.id,
		});
		return { token };
	},

	async createClassroomInvite(input: CreateClassroomInvite, user: User) {
		if (!canInvite(user, "STUDENT")) {
			throw new ActionError({
				code: "FORBIDDEN",
				message: "You cannot invite students.",
			});
		}
		const { token } = await inviteService.createClassroomCode({
			...input,
			createdById: user.id,
		});
		return { token };
	},
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
