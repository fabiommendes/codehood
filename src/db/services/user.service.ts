import type { z } from "zod";
import { hashPassword, passwordStrengthIssues } from "@/auth/password";
import {
	canCreateUser,
	canEditUser,
	canViewUser,
	userVisibility,
} from "@/auth/permissions";
import type { Actor } from "@/core/actor";
import { SYSTEM } from "@/core/actor";
import { type ActionCode, NotAllowed } from "@/core/error";
import {
	userCreate,
	type userFilter,
	userPK,
	userSchema,
	userUpdate,
	userUpsert,
} from "@/core/schemas";
import type { FillUndefineds } from "@/typing";
import { Validate } from "@/utils/validate";
import { type Crud, type ServiceOpts, upsert } from "../base-service";
import {
	type User as DbUser,
	type PrismaClient,
	type PrismaTx,
	prisma,
} from "../client";

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

class UserService
	implements
		Crud<{
			entity: User;
			pkFilter: UserPK;
			create: UserCreate;
			filter: UserFilter;
			update: UserUpdate;
			upsert: UserUpsert;
		}>
{
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	/**
	 * Create a new user.
	 */
	@Validate({ service: true, returns: userSchema, args: [userCreate] })
	async create(input: UserCreate, opts: ServiceOpts): Promise<User> {
		assertCanCreateUser(opts.actor);

		const isAdmin = input.role === "ADMIN";
		if (!input.githubId && !isAdmin)
			throw new Error("githubId is required for non-admin users");
		if (!input.schoolId && !isAdmin)
			throw new Error("schoolId is required for non-admin users");

		const githubId = input.githubId ?? nullSentinel(input.username);
		const schoolId = input.schoolId ?? nullSentinel(input.username);
		const client = opts.tx ?? this.prisma;

		return toUser(
			await client.user.create({
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
	@Validate({ service: true, returns: userSchema.nullable(), args: [userPK] })
	async findOne(filter: UserPK, opts: ServiceOpts): Promise<User | null> {
		const client = opts.tx ?? this.prisma;
		let user: DbUser | null = null;
		const by = filter as FillUndefineds<UserPK>; // zod doesn't narrow to a single field, so we do it here

		if (by.email) {
			user = await client.user.findUnique({
				where: { email: by.email },
			});
		} else if (by.username) {
			user = await client.user.findUnique({
				where: { username: by.username },
			});
		} else if (by.githubId) {
			user = await client.user.findUnique({
				where: { githubId: by.githubId },
			});
		} else if (by.schoolId) {
			user = await client.user.findUnique({
				where: { schoolId: by.schoolId },
			});
		} else if (by.login) {
			user = await client.user.findFirst({
				where: { OR: [{ email: by.login }, { username: by.login }] },
			});
		}

		if (!user) return null;
		if (!canViewUser(opts.actor, user)) {
			throw new NotAllowed({ action: "read-user" });
		}
		return toUser(user);
	}

	/**
	 * Find many users by some search criteria, narrowed to what `actor` may
	 * see. Newest first.
	 */
	@Validate({ service: true, returns: userSchema.array() })
	async findMany(by: UserFilter, opts: ServiceOpts): Promise<User[]> {
		const client = opts.tx ?? this.prisma;
		const users = await client.user.findMany({
			where: {
				AND: [
					by.usernames ? { username: { in: by.usernames } } : {},
					userVisibility(opts.actor),
				],
			},
			orderBy: { createdAt: "desc" },
			take: by.take,
		});
		return users.map(toUser);
	}

	/**
	 * Updates the editable profile fields for a user.
	 */
	@Validate({ service: true, returns: userSchema, args: [userPK, userUpdate] })
	async update(
		filter: UserPK,
		payload: UserUpdate,
		opts: ServiceOpts,
	): Promise<User> {
		const target = await this.findOne(filter, opts);

		if (!target) throw new Error("user not found");
		if (!canEditUser(opts.actor, target))
			throw new NotAllowed({ action: "update-user" });

		const client = opts.tx ?? this.prisma;
		const { githubId, schoolId, ...rest } = payload;
		return toUser(
			await client.user.update({
				where: { username: target.username },
				data: {
					...rest,
					githubId: mask(githubId, target.username),
					schoolId: mask(schoolId, target.username),
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
	@Validate({ service: true, returns: userSchema, args: [userUpsert] })
	async upsert(input: UserUpsert, opts: ServiceOpts): Promise<User> {
		const run = async (tx: PrismaTx): Promise<User> => {
			const scoped: ServiceOpts = { ...opts, tx };

			// `assertCreatable` runs on the update branch only, so it doubles as
			// the signal for which branch `upsert` took. `create` already stores
			// the password; re-running `updatePassword` after it would hash twice
			// and apply strength rules `create` does not.
			let existed = false;

			const user = await upsert(
				this.prisma,
				this,
				input,
				scoped,
				{
					pk: (i) => ({ username: i.username }),
					update: (i) => ({
						name: i.name,
						email: i.email,
						githubId: i.githubId,
						schoolId: i.schoolId,
					}),
					assertCreatable: (_i, o) => {
						existed = true;
						assertCanCreateUser(o.actor, "upsert-user");
					},
				},
				"upsert-user",
			);

			if (!existed || input.password === undefined) return user;
			const { hash } = await this.updatePassword(user, input.password, scoped);
			return { ...user, passwordHash: hash };
		};
		return opts.tx ? run(opts.tx) : this.prisma.$transaction((tx) => run(tx));
	}

	/**
	 * Deletes a user. Only SYSTEM can delete users, and it is irreversible.
	 */
	@Validate({ service: true, args: [userPK] })
	async delete(filter: UserPK, opts: ServiceOpts): Promise<void> {
		if (opts.actor !== SYSTEM) throw new NotAllowed({ action: "delete-user" });

		const client = opts.tx ?? this.prisma;
		const user = await this.findOne(filter, opts);

		// TODO: define an error for NotFound entities
		if (!user) throw new Error("user not found");

		// TODO: delete or soft delete? design decision
		await client.user.delete({ where: { username: user.username } });
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
		if (!canEditUser(opts.actor, user))
			throw new NotAllowed({ action: "update-user.password" });

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

export const userService = new UserService();

//
// Auxiliary functions
//

/**
 * Enforces {@link canCreateUser}, tagged with `action` — `create()`'s own
 * check, and reused by `upsert()`'s update branch so a request that would
 * fail as a fresh `create` fails the same way when the row already exists.
 */
function assertCanCreateUser(
	actor: Actor,
	action: ActionCode = "create-user",
): void {
	if (!canCreateUser(actor)) throw new NotAllowed({ action });
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
