import type { z } from "zod";
import { type Actor, SYSTEM } from "@/auth/actor";
import { hashPassword, passwordStrengthIssues } from "@/auth/password";
import { ensurePerm } from "@/auth/permissions";
import { InvalidData, NotAllowed } from "@/core/error";
import {
	userCreate,
	type userFilter,
	userPK,
	userSchema,
	userUpdate,
	userUpsert,
} from "@/core/schemas";
import {
	CrudBase,
	type ServiceOpts,
	type ServiceOptsWithoutTx,
	upsert,
} from "@/db/base-service";
import type { FillUndefineds } from "@/typing";
import { Validate } from "@/utils/validate";
import type { User as DbUser, Prisma, PrismaTx } from "../client";

export type { UserId } from "@/core/schemas";

//
// Type definitions
//
export type UserCreate = z.infer<typeof userCreate>;
export type User = z.infer<typeof userSchema>;
export type UserFilter = z.infer<typeof userFilter>;
export type UserPK = z.infer<typeof userPK>;
export type UserUpdate = z.infer<typeof userUpdate>;
export type UserUpsert = z.infer<typeof userUpsert>;

export class UserService extends CrudBase<{
	entity: User;
	pkFilter: UserPK;
	create: UserCreate;
	filter: UserFilter;
	update: UserUpdate;
	upsert: UserUpsert;
}> {
	/**
	 * Create a new user.
	 */
	@Validate({
		service: true,
		returns: userSchema,
		args: [undefined, userCreate],
	})
	protected async createTx(
		tx: PrismaTx,
		input: UserCreate,
		opts: ServiceOptsWithoutTx,
	): Promise<User> {
		ensurePerm(opts.actor, "user.create");

		const isAdmin = input.role === "ADMIN";
		if (!input.githubId && !isAdmin)
			throw new Error("githubId is required for non-admin users");
		if (!input.schoolId && !isAdmin)
			throw new Error("schoolId is required for non-admin users");

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
	}

	/**
	 * Finds a single user by one of the unique search fields.
	 *
	 * It accepts a single filter at a time, can search by email, username,
	 * githubId, schoolId or login (email or username).
	 */
	@Validate({
		service: true,
		returns: userSchema.nullable(),
		args: [undefined, userPK],
	})
	protected async findOneTx(
		tx: PrismaTx,
		filter: UserPK,
		opts: ServiceOptsWithoutTx,
	): Promise<User | null> {
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
				where: { OR: [{ email: by.login }, { username: by.login }] },
			});
		}

		if (!user) return null;
		ensurePerm(opts.actor, "user.read", user);
		return toUser(user);
	}

	/**
	 * Find many users by some search criteria, narrowed to what `actor` may
	 * see. Newest first.
	 */
	@Validate({ service: true, returns: userSchema.array() })
	protected async findManyTx(
		tx: PrismaTx,
		by: UserFilter,
		opts: ServiceOptsWithoutTx,
	): Promise<User[]> {
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
	}

	/**
	 * Updates the editable profile fields for a user.
	 */
	@Validate({
		service: true,
		returns: userSchema,
		args: [undefined, userPK, userUpdate],
	})
	protected async updateTx(
		tx: PrismaTx,
		filter: UserPK,
		payload: UserUpdate,
		opts: ServiceOptsWithoutTx,
	): Promise<User> {
		const target = await this.findOne(filter, { ...opts, tx });

		if (!target) throw new Error("user not found");
		ensurePerm(opts.actor, "user.update", target);

		const { githubId, schoolId, password, ...rest } = payload;

		if (password) {
			const issues = await passwordStrengthIssues(password);
			InvalidData.ensureNoError({ password: issues });
		}

		return toUser(
			await tx.user.update({
				where: { username: target.username },
				data: {
					...rest,
					githubId: mask(githubId, target.username),
					schoolId: mask(schoolId, target.username),
					...(password !== undefined
						? { passwordHash: await hashPassword(password) }
						: {}),
				},
			}),
		);
	}

	/**
	 * Upserts a user keyed on `username`: creates one if absent, else updates
	 * `name`/`email`/`githubId`/`schoolId`.
	 *
	 * PUT semantics: admin-only whether creating or updating — the create
	 * permission ({@link assertCanCreateUser}) is enforced on the update
	 * branch too, so a student cannot reach a wider write through `upsert`
	 * than `update` already grants for their own profile. `password`, absent
	 * from `UserUpdate`, is applied as a second write when given; omitted, the
	 * stored hash is left alone.
	 */
	@Validate({
		service: true,
		returns: userSchema,
		args: [undefined, userUpsert],
	})
	protected async upsertTx(
		tx: PrismaTx,
		input: UserUpsert,
		opts: ServiceOptsWithoutTx,
	): Promise<User> {
		const scoped: ServiceOpts = { ...opts, tx };

		// `assertCreatable` runs on the update branch only, so it doubles as
		// the signal for which branch `upsert` took. `create` already stores
		// the password; re-running `updatePassword` after it would hash twice
		// and apply strength rules `create` does not.
		let existed = false;

		const user = await upsert(this, input, {
			...scoped,
			action: "user.create",
			pk: (i) => ({ username: i.username }),
			update: (i) => ({
				name: i.name,
				email: i.email,
				githubId: i.githubId,
				schoolId: i.schoolId,
			}),
			assertCreatable: (_i, o) => {
				existed = true;
				ensurePerm(o.actor, "user.create");
			},
		});

		if (!existed || input.password === undefined) return user;
		const { hash } = await this.updatePassword(user, input.password, scoped);
		return { ...user, passwordHash: hash };
	}

	/**
	 * Deletes a user. Only SYSTEM can delete users, and it is irreversible.
	 */
	@Validate({ service: true, args: [undefined, userPK] })
	protected async deleteTx(
		tx: PrismaTx,
		filter: UserPK,
		opts: ServiceOptsWithoutTx,
	): Promise<void> {
		if (opts.actor !== SYSTEM) throw new NotAllowed("user.delete");

		const user = await this.findOne(filter, { ...opts, tx });

		// TODO: define an error for NotFound entities
		if (!user) throw new Error("user not found");

		// TODO: delete or soft delete? design decision
		await tx.user.delete({ where: { username: user.username } });
	}

	// TODO: this method should be moved to the auth service.
	/**
	 * Update password for a user. Returns the password hash.
	 */
	@Validate({ service: true, args: [userSchema] })
	async updatePassword(
		user: User,
		password: string,
		opts: ServiceOpts,
	): Promise<{ hash: string }> {
		ensurePerm(opts.actor, "user.update", user);

		// Validate password strength
		const issues = await passwordStrengthIssues(password);
		if (issues && opts.actor === SYSTEM) {
			// System can define any password it wants, but we issue a warning
			// anyway so that the system admin can see it in the logs.
			for (const issue of issues) {
				console.warn(
					`[password-${issue.code}] for ${user.username}: ${issue.message}`,
				);
			}
		} else if (issues) {
			// If the actor is not SYSTEM, we throw an error if the password is weak.
			// TODO: pick a better error class
			throw new Error(
				`Password does not meet strength requirements: ${issues
					.map((issue) => issue.message)
					.join(", ")}`,
			);
		}

		const client = opts.tx ?? this.prisma;
		const updated = await client.user.update({
			where: { username: user.username },
			data: { passwordHash: await hashPassword(password) },
		});
		return { hash: updated.passwordHash };
	}
}

//
// Auxiliary functions
//

/** Prisma `where` fragment implementing the same rule as the `user.read` permission. */
export function userWhere(actor: Actor): Prisma.UserWhereInput {
	if (actor === SYSTEM || actor.role === "ADMIN") return {};
	return { username: actor.username };
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
