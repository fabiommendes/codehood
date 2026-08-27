import { nanoid } from "nanoid";
import { hashPassword } from "@/auth/password";
import {
	canCreateUser,
	canEditUser,
	canViewUser,
	userVisibility,
} from "@/auth/permissions";
import type { FillUndefineds } from "@/utils/types";
import {
	type ActingOpts,
	type CreateAs,
	type FindManyAs,
	type FindOneAs,
	ForbiddenError,
	type ServiceMethodOpts,
	type UpdateAs,
} from "./base-service";
import {
	type User as DbUser,
	type PrismaClient,
	prisma,
	type Role,
} from "./client";

export interface CreateUser {
	email: string;
	name: string;
	username: string;
	role: Role;
	password: string;
	githubId?: string;
	schoolId?: string;
}

type FindOneBy = FillUndefineds<
	| { publicId: string }
	| { privateId: number }
	| { email: string }
	| { username: string }
	| { githubId: string }
	| { schoolId: string }
	| { login: string } // either email or username
>;

export interface FindManyBy {
	usernames?: string[];
}

export interface UpdateUserFilter {
	id: number;
}

/**
 * The editable profile fields. `username` is deliberately absent: it is a
 * stable identifier baked into course URLs (`Course.instructorId` targets
 * `User.username`), so it is set once at signup and never changes.
 */
export interface UpdateProfile {
	name: string;
	email: string;
	githubId: string;
	schoolId: string;
}

/**
 * Thats the main User type returned from the service functions.
 */
export type User = Omit<DbUser, "createdAt">;

class UserService
	implements
		CreateAs<CreateUser, User>,
		FindOneAs<FindOneBy, User>,
		FindManyAs<FindManyBy, User>,
		UpdateAs<UpdateUserFilter, UpdateProfile, User>
{
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	/**
	 * Create new user. Real accounts always go through invite redemption or
	 * the `manage create-user` CLI — see {@link canCreateUser}.
	 */
	async create(input: CreateUser, opts: ActingOpts): Promise<User> {
		if (!canCreateUser(opts.actor)) {
			throw new ForbiddenError();
		}

		const isAdmin = input.role === "ADMIN";
		if (!input.githubId && !isAdmin) {
			throw new Error("githubId is required for non-admin users");
		}
		if (!input.schoolId && !isAdmin) {
			throw new Error("schoolId is required for non-admin users");
		}

		const githubId = input.githubId ?? defaultHandle(input.username);
		const schoolId = input.schoolId ?? defaultHandle(input.username);
		const client = opts.tx ?? this.prisma;

		return await client.user.create({
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
		});
	}

	/**
	 * Finds a single user by one of the unique search fields. Throws
	 * `FORBIDDEN` if the user exists but `actor` may not see it (see
	 * {@link canViewUser}); returns `null` if it does not exist.
	 */
	async findOne(by: FindOneBy, opts: ActingOpts): Promise<User | null> {
		const client = opts.tx ?? this.prisma;
		let user: DbUser | null = null;

		if (by.publicId) {
			user = await client.user.findUnique({
				where: { publicId: by.publicId },
			});
		} else if (by.privateId) {
			user = await client.user.findUnique({
				where: { id: by.privateId },
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
		if (!canViewUser(opts.actor, user)) {
			throw new ForbiddenError();
		}
		return user;
	}

	/**
	 * Find many users by some search criteria, narrowed to what `actor` may
	 * see (see {@link userVisibility}). Newest first.
	 */
	async findMany(by: FindManyBy, opts: ActingOpts): Promise<User[]> {
		const client = opts.tx ?? this.prisma;
		const users = await client.user.findMany({
			where: {
				AND: [
					by.usernames ? { username: { in: by.usernames } } : {},
					userVisibility(opts.actor),
				],
			},
			orderBy: { createdAt: "desc" },
		});
		return users;
	}

	/**
	 * Fetches a user by their raw numeric id (e.g. `context.locals.user.id`).
	 * Distinct from `findOne({ id })`, which looks up by the public-facing id.
	 */
	async getById(id: number, opts: ActingOpts): Promise<User | null> {
		const client = opts.tx ?? this.prisma;
		const user = await client.user.findUnique({ where: { id } });
		if (!user) return null;
		if (!canViewUser(opts.actor, user)) {
			throw new ForbiddenError();
		}
		return user;
	}

	/**
	 * Updates the editable profile fields for a user. Rejects any attempt to
	 * smuggle a `username` change through `fields` — see {@link UpdateProfile}.
	 */
	async update(
		filter: UpdateUserFilter,
		fields: UpdateProfile,
		opts: ActingOpts,
	): Promise<User> {
		if (!canEditUser(opts.actor, filter.id)) {
			throw new ForbiddenError();
		}
		if ("username" in fields) {
			throw new Error(
				"username cannot be changed: it is used as a stable identifier in course URLs",
			);
		}
		const client = opts.tx ?? this.prisma;
		return client.user.update({ where: { id: filter.id }, data: fields });
	}

	/**
	 * Number of users in the database. System-only bootstrap utility — not
	 * exposed to any actor-facing feature.
	 */
	async count(opts?: ServiceMethodOpts): Promise<number> {
		const client = opts?.tx ?? this.prisma;
		return await client.user.count();
	}

	/**
	 * Update password for a user. Returns the password hash.
	 */
	async updatePassword(
		user: User,
		password: string,
		opts: ActingOpts,
	): Promise<{ hash: string }> {
		if (!canEditUser(opts.actor, user.id)) {
			throw new ForbiddenError();
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

/**
 * Synthetic handle for ADMIN accounts that don't need a real GitHub/school id.
 */
function defaultHandle(username: string): string {
	return `@${username}`;
}
