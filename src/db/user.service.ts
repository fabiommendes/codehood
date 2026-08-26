import { nanoid } from "nanoid";
import { hashPassword } from "@/auth/password";
import type { FillUndefineds } from "@/utils/types";
import type {
	Create,
	FindMany,
	FindOne,
	ServiceMethodOpts,
	Update,
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
	{ publicId: string }
	| { privateId: number }
	| { email: string }
	| { username: string }
	| { githubId: string }
	| { schoolId: string }
	| { login: string } // either email or username
>;


export interface FindManyBy {
	usernames: string[];
}

export interface UpdateUserFilter {
	id: number;
}

export interface UpdateProfile {
	name: string;
	email: string;
	username: string;
	githubId: string;
	schoolId: string;
}

/**
 * Thats the main User type returned from the service functions.
 */
export type User = Omit<DbUser, "createdAt">;

class UserService
	implements
	Create<CreateUser, User>,
	FindOne<FindOneBy, User>,
	FindMany<FindManyBy, User>,
	Update<UpdateUserFilter, UpdateProfile, User> {
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	/**
	 * Create new user.
	 */
	async create(input: CreateUser, opts?: ServiceMethodOpts): Promise<User> {
		const isAdmin = input.role === "ADMIN";
		if (!input.githubId && !isAdmin) {
			throw new Error("githubId is required for non-admin users");
		}
		if (!input.schoolId && !isAdmin) {
			throw new Error("schoolId is required for non-admin users");
		}

		const githubId = input.githubId ?? defaultHandle(input.username);
		const schoolId = input.schoolId ?? defaultHandle(input.username);
		const client = opts?.tx ?? this.prisma;

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
	 * Finds a single user by one of the unique search fields.
	 */
	async findOne(by: FindOneBy, opts?: ServiceMethodOpts): Promise<User | null> {
		const client = opts?.tx ?? this.prisma;
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

		return user;
	}

	/**
	 * Find many users by some search criteria.
	 */
	async findMany(by: FindManyBy, opts?: ServiceMethodOpts): Promise<User[]> {
		const client = opts?.tx ?? this.prisma;
		const users = await client.user.findMany({
			where: { username: { in: by.usernames } },
		});
		return users;
	}

	/**
	 * Fetches a user by their raw numeric id (e.g. `context.locals.user.id`).
	 * Distinct from `findOne({ id })`, which looks up by the public-facing id.
	 */
	getById(id: number, opts?: ServiceMethodOpts): Promise<User | null> {
		const client = opts?.tx ?? this.prisma;
		return client.user.findUnique({ where: { id } });
	}

	/**
	 * Updates the editable profile fields for a user.
	 */
	update(
		filter: UpdateUserFilter,
		fields: UpdateProfile,
		opts?: ServiceMethodOpts,
	): Promise<User> {
		const client = opts?.tx ?? this.prisma;
		return client.user.update({ where: { id: filter.id }, data: fields });
	}

	/**
	 * Number of users in the database.
	 */
	async count(opts?: ServiceMethodOpts): Promise<number> {
		const client = opts?.tx ?? this.prisma;
		return await client.user.count();
	}

	/**
	 * All users, newest first. Callers are responsible for checking the actor
	 * is allowed to see this (see canManageUsers in auth/permissions.ts).
	 */
	// TODO: remove this and use the FindMany interface.
	listAll(
		opts?: ServiceMethodOpts,
	): Promise<Array<User & { createdAt: Date }>> {
		const client = opts?.tx ?? this.prisma;
		return client.user.findMany({ orderBy: { createdAt: "desc" } });
	}

	/**
	 * Update password for a user. Returns the password hash.
	 */
	async updatePassword(user: User, password: string, opts?: ServiceMethodOpts) {
		const client = opts?.tx ?? this.prisma;
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
