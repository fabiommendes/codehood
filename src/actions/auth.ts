import { ActionError, defineAction } from "astro:actions";
import { FULL_ACCESS } from "@/auth/actor";
import { verifyPassword } from "@/auth/password";
import { requireUser } from "@/auth/require-user";
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/core/constants";
import { FieldError } from "@/core/error";
import {
	apiKeyForm,
	apiKeyRevoke,
	inviteAccept,
	inviteClassroom,
	inviteJoin,
	invitePersonal,
	sessionLogin,
} from "@/core/schemas";
import { db, InviteError, type User } from "@/db";
import { prisma } from "@/db/client";
import { parseCourseParams } from "@/urls";
import {
	uniqueConstraintError,
	withActionErrors,
	withServiceErrors,
} from "./helpers";

export type PublicUser = Omit<User, "passwordHash" | "createdAt">;

export const auth = {
	login: defineAction({
		accept: "form",
		input: sessionLogin,
		handler: async (input, context) => {
			const user = await db.user.findOne({ login: input.login }, FULL_ACCESS);
			if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
				throw new ActionError({
					code: "UNAUTHORIZED",
					message: "Invalid email/username or password.",
				});
			}
			const { token, session } = await db.session.create(
				{ username: user.username },
				FULL_ACCESS,
			);
			context.cookies.set(SESSION_COOKIE, token, {
				...SESSION_COOKIE_OPTIONS,
				expires: session.expiresAt,
			});
			return publicUser(user);
		},
	}),

	logout: defineAction({
		accept: "form",
		handler: async (_input, context) => {
			const token = context.cookies.get(SESSION_COOKIE)?.value;
			if (token) await db.session.delete({ token }, FULL_ACCESS);
			context.cookies.delete(SESSION_COOKIE, { path: "/" });
		},
	}),

	acceptInvite: defineAction({
		accept: "form",
		input: inviteAccept,
		handler: withActionErrors(async (input, context) => {
			const invite = await db.invite.findOne(
				{ token: input.token },
				FULL_ACCESS,
			);
			if (!invite)
				throw new ActionError({
					code: "NOT_FOUND",
					message: "Invite not found or expired.",
				});
			if (invite.invitedRole === "STUDENT") {
				if (!input.githubId) {
					throw new FieldError("githubId", "Required for students.");
				}
				if (!input.schoolId) {
					throw new FieldError("schoolId", "Required for students.");
				}
			}
			const precheckError = db.invite.checkRedeemable(invite, input.email);
			if (precheckError) throw inviteRefusal(precheckError);

			// One transaction: a redemption failure (race on maxUses, etc.) must not
			// leave behind a User row with no invite and no course to show for it.
			let user: User;
			try {
				user = await prisma.$transaction(async (tx) => {
					const createdUser = await db.user.create(
						{
							email: input.email,
							username: input.username,
							name: input.name,
							role: invite.invitedRole,
							password: input.password,
							githubId: input.githubId || undefined,
							schoolId: input.schoolId || undefined,
						},
						{ ...FULL_ACCESS, tx },
					);
					await db.invite.redeem(
						input.token,
						createdUser.username,
						input.email,
						{ ...FULL_ACCESS, tx },
					);
					if (invite.courseId) {
						await db.enrollment.create(
							{ course: invite.courseId, username: createdUser.username },
							{ ...FULL_ACCESS, tx },
						);
					}
					return createdUser;
				});
			} catch (error) {
				if (error instanceof InviteError) throw inviteRefusal(error.code);
				throw uniqueConstraintError(error) ?? error;
			}

			const { token: sessionToken, session } = await db.session.create(
				{ username: user.username },
				FULL_ACCESS,
			);
			context.cookies.set(SESSION_COOKIE, sessionToken, {
				...SESSION_COOKIE_OPTIONS,
				expires: session.expiresAt,
			});
			return { role: user.role };
		}),
	}),

	/**
	 * Enrolls the logged-in user in the course a classroom or personal invite
	 * carries, redeeming the invite, instead of creating a new account.
	 *
	 * Only a student invite bound to a course can be used this way; an invite
	 * without a course exists to create an account. Already being enrolled is
	 * not an error.
	 */
	joinWithInvite: defineAction({
		accept: "form",
		input: inviteJoin,
		handler: withActionErrors(async (input, context) => {
			const actor = requireUser(context);
			const user = await db.user.findOne(
				{ username: actor.username },
				FULL_ACCESS,
			);
			const invite = await db.invite.findOne(
				{ token: input.token },
				FULL_ACCESS,
			);
			if (!invite || !user)
				throw new ActionError({
					code: "NOT_FOUND",
					message: "Invite not found or expired.",
				});
			if (!invite.courseId || invite.invitedRole !== "STUDENT") {
				throw new ActionError({
					code: "BAD_REQUEST",
					message:
						"This invite creates a new account, and you already have one.",
				});
			}
			if (user.role !== "STUDENT") {
				throw new ActionError({
					code: "BAD_REQUEST",
					message: `${user.name} is not a student account.`,
				});
			}
			const courseId = invite.courseId;
			const enrolled = await db.enrollment.findOne(
				{ course: courseId, username: user.username },
				{ actor },
			);
			if (enrolled?.status !== "ACTIVE") {
				const precheckError = db.invite.checkRedeemable(invite, user.email);
				if (precheckError) {
					throw new ActionError({
						code: "BAD_REQUEST",
						message: inviteErrorMessage(precheckError),
					});
				}
				try {
					await prisma.$transaction(async (tx) => {
						await db.invite.redeem(input.token, user.username, user.email, {
							...FULL_ACCESS,
							tx,
						});
						await db.enrollment.create(
							{ course: courseId, username: user.username },
							{ ...FULL_ACCESS, tx },
						);
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
			}
			return { courseId };
		}),
	}),

	createPersonalInvite: defineAction({
		accept: "form",
		input: invitePersonal,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const course =
				input.discipline && input.course
					? parseCourseParams({
							discipline: input.discipline,
							course: input.course,
						})
					: undefined;
			const { token } = await db.invite.create(
				{
					email: input.email,
					invitedRole: input.role,
					course,
					kind: "PERSONAL",
					maxUses: 1,
				},
				{ actor },
			);
			return { token };
		}),
	}),

	createClassroomInvite: defineAction({
		input: inviteClassroom,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const course = parseCourseParams({
				discipline: input.discipline,
				course: input.course,
			});
			const { token } = await db.invite.create(
				{
					email: null,
					course,
					maxUses: input.maxUses ?? null,
					kind: "CLASSROOM",
					invitedRole: "STUDENT",
				},
				{ actor },
			);
			return { token };
		}),
	}),

	createApiKey: defineAction({
		accept: "form",
		input: apiKeyForm,
		handler: withActionErrors(async (input, context) => {
			const actor = requireUser(context);
			const { token } = await db.apiKey.create(
				{
					createdBy: { username: actor.username, name: actor.name },
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
		input: apiKeyRevoke,
		handler: withActionErrors(async (input, context) => {
			const actor = requireUser(context);
			await db.apiKey.delete({ publicId: input.publicId }, { actor });
		}),
	}),
};

/// The error an invite refusal shows: on the email field when the address is wrong, else on the form.
function inviteRefusal(code: InviteError["code"]): FieldError | ActionError {
	const message = inviteErrorMessage(code);
	return code === "email_mismatch"
		? new FieldError("email", message)
		: new ActionError({ code: "BAD_REQUEST", message });
}

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
			return "You already used this invite.";
	}
}

/**
 * Strips a `User` down to what an action may safely return to the browser.
 */
export function publicUser(user: User): PublicUser {
	return {
		email: user.email,
		name: user.name,
		username: user.username,
		role: user.role,
		githubId: user.githubId,
		schoolId: user.schoolId,
	};
}
