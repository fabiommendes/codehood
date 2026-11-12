import type { z } from "zod";
import { type Actor, SYSTEM } from "@/auth/actor";
import {
	hashPassword,
	passwordStrengthIssues,
	verifyPassword,
} from "@/auth/password";
import { ensurePerm } from "@/auth/permissions";
import { SCHOOL_ID_PATTERN } from "@/core/constants";
import { FieldError, NotAllowed, NotFound, WeakPassword } from "@/core/error";
import {
	passwordChange,
	passwordReset,
	userCreate,
	type userFilter,
	userPK,
	userSchema,
	userUpdate,
} from "@/core/schemas";
import type { ServiceOptsWithoutTx } from "@/db/base-service";
import { defineService, op } from "@/db/define-service";
import { m } from "@/i18n";
import type { FillUndefineds } from "@/typing";
import type { User as DbUser, Prisma, PrismaTx } from "../client";
import { makeSessionService } from "./session.service";

export type { UserId } from "@/core/schemas";

//
// Type definitions
//
export type UserCreate = z.infer<typeof userCreate>;
export type User = z.infer<typeof userSchema>;
export type UserFilter = z.infer<typeof userFilter>;
export type UserPK = z.infer<typeof userPK>;
export type UserUpdate = z.infer<typeof userUpdate>;
export type PasswordChange = z.infer<typeof passwordChange>;
export type PasswordReset = z.infer<typeof passwordReset>;

/// The CRUD shape of the user service.
type UserT = {
	entity: User;
	pkFilter: UserPK;
	create: UserCreate;
	filter: UserFilter;
	update: UserUpdate;
};

/** The user service of `client` (the shared client by default). */
export const makeUserService = defineService<UserT>()((client) => {
	/// Session sweep on a password change.
	const sessions = makeSessionService(client);

	/**
	 * Create a new user.
	 */
	const create = op({
		args: [userCreate],
		returns: userSchema,
		run: async (
			tx: PrismaTx,
			input: UserCreate,
			opts: ServiceOptsWithoutTx,
		): Promise<User> => {
			ensurePerm(opts.actor, "user.create");

			// Grades and pushed grade files match students by these; staff may skip them.
			const isStudent = input.role === "STUDENT";
			if (!input.githubId && isStudent)
				throw new FieldError("githubId", m.errors_required_for_students());
			if (!input.schoolId && isStudent)
				throw new FieldError("schoolId", m.errors_required_for_students());
			assertSchoolIdFormat(input.schoolId);
			// Seeds and imports run as SYSTEM with throwaway passwords; skip, not warn.
			if (opts.actor !== SYSTEM) {
				await assertPasswordStrength(
					input.username,
					input.password,
					opts,
					"password",
				);
			}

			const githubId = input.githubId ?? nullSentinel(input.username);
			const schoolId = input.schoolId ?? nullSentinel(input.username);

			return toUser(
				await tx.user.create({
					data: {
						email: input.email,
						name: input.name,
						username: input.username,
						role: input.role,
						passwordHash: await hashPassword(input.password),
						githubId,
						schoolId,
					},
				}),
			);
		},
	});

	/**
	 * Finds a single user by one of the unique search fields.
	 *
	 * It accepts a single filter at a time, can search by email, username,
	 * githubId, schoolId or login (email or username).
	 */
	const findOne = op({
		transaction: false,
		args: [userPK],
		returns: userSchema.nullable(),
		run: async (
			tx: PrismaTx,
			filter: UserPK,
			opts: ServiceOptsWithoutTx,
		): Promise<User | null> => {
			let user: DbUser | null = null;
			const by = filter as FillUndefineds<UserPK>; // zod doesn't narrow to a single field, so we do it here

			if (by.email) {
				user = await tx.user.findUnique({
					where: { email: by.email },
				});
			} else if (by.username) {
				user = await tx.user.findUnique({
					where: { username: by.username },
				});
			} else if (by.githubId) {
				user = await tx.user.findUnique({
					where: { githubId: by.githubId },
				});
			} else if (by.schoolId) {
				user = await tx.user.findUnique({
					where: { schoolId: by.schoolId },
				});
			} else if (by.login) {
				user = await tx.user.findFirst({
					where: {
						OR: [
							{ email: by.login },
							{ username: by.login.trim().toLowerCase() },
						],
					},
				});
			}

			if (!user) return null;
			ensurePerm(opts.actor, "user.read", user);
			return toUser(user);
		},
	});

	/**
	 * Find many users by some search criteria, narrowed to what `actor` may
	 * see. Newest first.
	 */
	const findMany = op({
		transaction: false,
		returns: userSchema.array(),
		run: async (
			tx: PrismaTx,
			by: UserFilter,
			opts: ServiceOptsWithoutTx,
		): Promise<User[]> => {
			const users = await tx.user.findMany({
				where: {
					AND: [
						by.usernames ? { username: { in: by.usernames } } : {},
						userWhere(opts.actor),
					],
				},
				orderBy: { createdAt: "desc" },
				take: by.take,
			});
			for (const user of users) ensurePerm(opts.actor, "user.read", user);
			return users.map(toUser);
		},
	});

	/**
	 * Updates the editable profile fields for a user.
	 *
	 * The password is not one of them: {@link changePassword} handles it, and
	 * demands the current password first.
	 */
	const update = op({
		args: [userPK, userUpdate],
		returns: userSchema,
		run: async (
			tx: PrismaTx,
			filter: UserPK,
			payload: UserUpdate,
			opts: ServiceOptsWithoutTx,
		): Promise<User> => {
			const target = await findOne(tx, filter, opts);

			if (!target) throw new Error("user not found");
			ensurePerm(opts.actor, "user.update", target);

			const { githubId, schoolId, ...rest } = payload;
			assertSchoolIdFormat(schoolId);

			return toUser(
				await tx.user.update({
					where: { username: target.username },
					data: {
						...rest,
						githubId: mask(githubId, target.username),
						schoolId: mask(schoolId, target.username),
					},
				}),
			);
		},
	});

	/**
	 * Upserts a user keyed on `username`: creates one if absent, else updates
	 * `name`/`email`/`githubId`/`schoolId`.
	 *
	 * PUT semantics: admin-only whether creating or updating, because the
	 * create permission is enforced on the update branch too, so a student
	 * cannot reach a wider write through `upsert` than `update` already
	 * grants for their own profile. `password` is only read on the create
	 * branch: an existing user's stored one is left alone, and is changed
	 * through {@link changePassword} instead.
	 */
	const upsert = op({
		args: [userCreate],
		returns: userSchema,
		run: async (
			tx: PrismaTx,
			input: UserCreate,
			opts: ServiceOptsWithoutTx,
		): Promise<User> => {
			assertSchoolIdFormat(input.schoolId);

			const pk = { username: input.username };
			let existing: User | null;
			try {
				existing = await findOne(tx, pk, opts);
			} catch (error) {
				throw error instanceof NotAllowed ? error.as("user.create") : error;
			}
			if (!existing) return create(tx, input, opts);

			ensurePerm(opts.actor, "user.create");
			return update(
				tx,
				pk,
				{
					name: input.name,
					email: input.email,
					githubId: input.githubId,
					schoolId: input.schoolId,
				},
				opts,
			);
		},
	});

	/**
	 * Deletes a user. Only SYSTEM can delete users, and it is irreversible.
	 */
	const remove = op({
		args: [userPK],
		run: async (
			tx: PrismaTx,
			filter: UserPK,
			opts: ServiceOptsWithoutTx,
		): Promise<void> => {
			if (opts.actor !== SYSTEM) throw new NotAllowed("user.delete");

			const user = await findOne(tx, filter, opts);

			// TODO: define an error for NotFound entities
			if (!user) throw new Error("user not found");

			// TODO: delete or soft delete? design decision
			await tx.user.delete({ where: { username: user.username } });
		},
	});

	// TODO: this method should be moved to the auth service.
	/**
	 * Sets a user's password without proof of the current one.
	 *
	 * Returns the password hash. A user changes their own password through
	 * `changePassword`, which proves the current one.
	 *
	 * @throws NotAllowed when the actor lacks `user.reset-password`.
	 */
	const updatePassword = op({
		args: [userSchema],
		run: async (
			tx: PrismaTx,
			user: User,
			password: string,
			opts: ServiceOptsWithoutTx,
		): Promise<{ hash: string }> => {
			ensurePerm(opts.actor, "user.reset-password");
			return writePassword(tx, user, password, opts);
		},
	});

	// TODO: move to the auth service.
	/**
	 * Replaces a user's password once the current one is proven, and revokes
	 * every session they hold.
	 *
	 * Proving the current password is what separates a password change from a
	 * password reset: without it, a session or API key held for a moment
	 * becomes permanent ownership of the account. `updatePassword` is the
	 * reset, and stays SYSTEM/admin territory. The session sweep makes a change
	 * useful as incident response, so a caller that owns a session cookie
	 * should mint a fresh one afterwards. API keys survive, since revoking
	 * every robot on a routine password change is its own outage; `/profile`
	 * lists them for revoking one by one.
	 *
	 * @throws NotAllowed when `currentPassword` does not match.
	 */
	const changePassword = op({
		args: [userSchema, passwordChange],
		run: async (
			tx: PrismaTx,
			user: User,
			input: PasswordChange,
			opts: ServiceOptsWithoutTx,
		): Promise<void> => {
			ensurePerm(opts.actor, "user.update", user);

			if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
				throw new NotAllowed("user.update", {
					message: m.errors_current_password_incorrect(),
					status: 401,
				});
			}

			await writePassword(tx, user, input.newPassword, opts);
			await sessions.delete({ username: user.username }, { ...opts, tx });
		},
	});

	// TODO: move to the auth service.
	/**
	 * Replaces a user's password without proof of the current one, and revokes every session they hold.
	 *
	 * This is how an admin lets a locked-out user back in, so it takes a
	 * permission no user holds over their own account.
	 *
	 * @throws NotFound when no account has `input.username`.
	 */
	const resetPassword = op({
		args: [passwordReset],
		run: async (
			tx: PrismaTx,
			input: PasswordReset,
			opts: ServiceOptsWithoutTx,
		): Promise<void> => {
			ensurePerm(opts.actor, "user.reset-password");
			const user = await findOne(tx, { username: input.username }, opts);
			if (!user) throw new NotFound("user", input.username);

			await updatePassword(tx, user, input.newPassword, opts);
			await sessions.delete({ username: user.username }, { ...opts, tx });
		},
	});

	return {
		create,
		findOne,
		findMany,
		update,
		upsert,
		delete: remove,
		updatePassword,
		changePassword,
		resetPassword,
	};
});

/** The user service, as built by {@link makeUserService}. */
export type UserService = ReturnType<typeof makeUserService>;

/// Checks the strength of `password` and stores its hash, with no permission check.
async function writePassword(
	tx: PrismaTx,
	user: User,
	password: string,
	opts: ServiceOptsWithoutTx,
): Promise<{ hash: string }> {
	await assertPasswordStrength(user.username, password, opts);

	const updated = await tx.user.update({
		where: { username: user.username },
		data: { passwordHash: await hashPassword(password) },
	});
	return { hash: updated.passwordHash };
}

//
// Auxiliary functions
//

/** Prisma `where` fragment implementing the same rule as the `user.read` permission. */
export function userWhere(actor: Actor): Prisma.UserWhereInput {
	if (actor === SYSTEM || actor.role === "ADMIN") return {};
	return { username: actor.username };
}

/**
 * Rejects a school id outside the instance's `SCHOOL_ID_PATTERN`.
 *
 * @throws {FieldError} When the id is present and does not match.
 */
function assertSchoolIdFormat(schoolId: string | null | undefined): void {
	if (schoolId && SCHOOL_ID_PATTERN && !SCHOOL_ID_PATTERN.test(schoolId))
		throw new FieldError("schoolId", m.errors_school_id_format());
}

/// Refuses a weak password; SYSTEM may set any, but it is logged.
async function assertPasswordStrength(
	username: string,
	password: string,
	opts: { actor: unknown },
	field = "newPassword",
): Promise<void> {
	const issues = await passwordStrengthIssues(password);
	if (!issues) return;
	if (opts.actor !== SYSTEM) throw new WeakPassword(issues, field);
	for (const issue of issues) {
		console.warn(`[password-${issue.code}] for ${username}: ${issue.message}`);
	}
}

// The `schoolId`/`githubId` columns are NOT NULL @unique, so an account with
// no real value stores this sentinel instead — see the comment on `User` in
// schema.prisma. `unmask` reverses it back to `undefined` on the way out.
function nullSentinel(username: string): string {
	return `!${username}`;
}

function unmask(value: string, username: string): string | null {
	return value === nullSentinel(username) ? null : value;
}

/**
 * Maps a cleared external id back onto the sentinel the NOT NULL column holds.
 *
 * `undefined` means "not saying" and is left for Prisma to skip; `null` means
 * "clear it" and becomes the sentinel.
 */
function mask(
	value: string | null | undefined,
	username: string,
): string | undefined {
	if (value === undefined) return undefined;
	return value ?? nullSentinel(username);
}

// Convert a database user record to the public-facing user type.
export function toUser(dbUser: DbUser): User {
	return {
		email: dbUser.email,
		name: dbUser.name,
		username: dbUser.username,
		createdAt: dbUser.createdAt,
		role: dbUser.role,
		passwordHash: dbUser.passwordHash,
		githubId: unmask(dbUser.githubId, dbUser.username),
		schoolId: unmask(dbUser.schoolId, dbUser.username),
	};
}
