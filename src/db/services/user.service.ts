import { nanoid } from "nanoid";
import type { z } from "zod";
import { hashPassword, passwordStrengthIssues } from "@/auth/password";
import {
	canCreateUser,
	canEditUser,
	canViewUser,
	userVisibility,
} from "@/auth/permissions";
import { SYSTEM } from "@/core/actor";
import { NotAllowed } from "@/core/error";
import type { FillUndefineds } from "@/utils/types";
import { Validate } from "@/utils/validate";
import {
	type UserId,
	userCreate,
	type userFilter,
	userPK,
	userSchema,
	userUpdate,
} from "../../core/schemas";
import type { Crud, ServiceOpts } from "../base-service";
import { type User as DbUser, type PrismaClient, prisma } from "../client";

export type { UserId } from "../../core/schemas";

function brand<T extends { id: number }>(user: T): T & { id: UserId } {
	return user as T & { id: UserId }; // branding is a runtime no-op
}

//
// Type definitions
//
export type UserCreate = z.infer<typeof userCreate>;
export type User = z.infer<typeof userSchema>;
export type UserFilter = z.infer<typeof userFilter>;
export type UserPK = z.infer<typeof userPK>;
export type UserUpdate = z.infer<typeof userUpdate>;

class UserService
	implements
		Crud<{
			entity: User;
			pkFilter: UserPK;
			create: UserCreate;
			filter: UserFilter;
			update: UserUpdate;
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
		if (!canCreateUser(opts.actor))
			throw new NotAllowed({ action: "create-user" });

		const isAdmin = input.role === "ADMIN";
		if (!input.githubId && !isAdmin)
			throw new Error("githubId is required for non-admin users");
		if (!input.schoolId && !isAdmin)
			throw new Error("schoolId is required for non-admin users");

		const githubId = input.githubId ?? defaultHandle(input.username);
		const schoolId = input.schoolId ?? defaultHandle(input.username);
		const client = opts.tx ?? this.prisma;

		return toUser(
			await client.user.create({
				data: {
					publicId: nanoid(10),
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
	 * It accepts a single filter at a time, can search by id, publicId, email,
	 * username, githubId, schoolId or login (email or username).
	 */
	@Validate({ service: true, returns: userSchema.nullable(), args: [userPK] })
	async findOne(filter: UserPK, opts: ServiceOpts): Promise<User | null> {
		const client = opts.tx ?? this.prisma;
		let user: DbUser | null = null;
		const by = filter as FillUndefineds<UserPK>; // zod doesn't narrow to a single field, so we do it here

		if (by.id) {
			user = await client.user.findUnique({
				where: { id: by.id as UserId },
			});
		} else if (by.publicId) {
			user = await client.user.findUnique({
				where: { publicId: by.publicId },
			});
		} else if (by.email) {
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
		if (!canViewUser(opts.actor, brand(user))) {
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
		return toUser(
			await client.user.update({ where: { id: target.id }, data: payload }),
		);
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
		await client.user.delete({ where: { id: user.id } });
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
			where: { id: user.id },
			data: { passwordHash: await hashPassword(password) },
		});
		return { hash: updated.passwordHash };
	}
}

export const userService = new UserService();

//
// Auxiliary functions
//

// Synthetic handle for ADMIN accounts that don't need a real GitHub/school id.
function defaultHandle(username: string): string {
	return `@${username}`;
}

// Convert a database user record to the public-facing user type.
function toUser(dbUser: DbUser): User {
	return {
		publicId: dbUser.publicId,
		id: dbUser.id as UserId, // branding is safe because it comes from the DB.
		email: dbUser.email,
		name: dbUser.name,
		username: dbUser.username,
		role: dbUser.role,
		passwordHash: dbUser.passwordHash,
		githubId: dbUser.githubId ?? "",
		schoolId: dbUser.schoolId ?? "",
	};
}
