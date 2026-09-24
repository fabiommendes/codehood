import { ActionError, defineAction } from "astro:actions";
import { z } from "astro/zod";
import { FULL_ACCESS } from "@/auth/actor";
import { requireUser } from "@/auth/require-user";
import { db, type schema } from "@/db";
import { withActionErrors, withServiceErrors } from "./helpers";

/** Outcome of {@link course.addStudent}: an enrolment, or an invite to accept first. */
export type AddStudentResult =
	| { kind: "enrolled"; username: string; name: string }
	| { kind: "invited"; email: string; token: string };

export const course = {
	/**
	 * Puts a student in the course by email or username, inviting them when no
	 * account matches.
	 *
	 * An existing account is enrolled straight away (reactivating a `DROPPED`
	 * row), because acceptance would add nothing: the instructor already knows
	 * who they mean. An unknown email gets a single-use personal invite
	 * carrying the course, so redeeming it both creates the account and enrolls
	 * it.
	 */
	addStudent: defineAction({
		accept: "form",
		input: z.object({
			courseId: z.coerce.number().int(),
			login: z.string().trim().min(1),
		}),
		handler: withActionErrors(
			async (input, context): Promise<AddStudentResult> => {
				const actor = requireUser(context);
				const courseId = input.courseId as schema.CourseId;

				// FULL_ACCESS: `user.read` is admin-or-self, and an instructor
				// filling in the roster is neither. Nothing about the account
				// leaves this handler except whether it exists.
				const user = await db.user.findOne({ login: input.login }, FULL_ACCESS);

				if (user) {
					if (user.role !== "STUDENT") {
						throw new ActionError({
							code: "BAD_REQUEST",
							message: `${user.name} is not a student account.`,
						});
					}
					await db.enrollment.create(
						{ course: courseId, username: user.username as schema.UserId },
						{ actor },
					);
					return { kind: "enrolled", username: user.username, name: user.name };
				}

				if (!z.string().email().safeParse(input.login).success) {
					throw new ActionError({
						code: "BAD_REQUEST",
						message: `No account matches "${input.login}". Use an email address to invite someone who has not signed up yet.`,
					});
				}

				const { token } = await db.invite.create(
					{
						email: input.login,
						invitedRole: "STUDENT",
						course: courseId,
						kind: "PERSONAL",
						maxUses: 1,
					},
					{ actor },
				);
				// biome-ignore lint/style/noNonNullAssertion: create() always sets a token
				return { kind: "invited", email: input.login, token: token! };
			},
		),
	}),

	/**
	 * Drops `username`'s enrollment, defaulting to the caller — the one action
	 * behind both the instructor's "Drop" control on the Students tab and a
	 * student's own "Leave course" button, gated by `enrollment.delete` inside
	 * `db.enrollment.delete`.
	 */
	dropEnrollment: defineAction({
		accept: "form",
		input: z.object({
			courseId: z.coerce.number().int(),
			username: z.string().optional(),
		}),
		handler: withActionErrors(async (input, context) => {
			const actor = requireUser(context);
			await db.enrollment.delete(
				{
					course: input.courseId as schema.CourseId,
					username:
						(input.username as schema.UserId | undefined) ?? actor.username,
				},
				{ actor },
			);
		}),
	}),

	/**
	 * Generates a passphrase for the Manage tab's Enrollment panel — an
	 * auto-generated code unless the instructor overrides it, live for 5
	 * minutes (`PassphraseService`). There is no follow-up action: it is shown
	 * once and expires on its own, the same way a generated invite link is
	 * shown once and revoked rather than edited.
	 */
	generatePassphrase: defineAction({
		accept: "form",
		input: z.object({
			courseId: z.coerce.number().int(),
			value: z.string().trim().min(1).optional(),
		}),
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			return db.passphrase.create(
				{ course: input.courseId as schema.CourseId, value: input.value },
				{ actor },
			);
		}),
	}),
};
