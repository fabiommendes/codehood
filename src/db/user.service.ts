import { nanoid } from "nanoid";
import { hashPassword } from "@/auth/password";
import { type User as DbUser, prisma, type Role } from "./client";

export interface CreateUser {
	email: string;
	name: string;
	username: string;
	role: Role;
	password: string;
	githubId?: string;
	schoolId?: string;
}

export interface FindOneBy {
	id?: string;
	email?: string;
	username?: string;
	githubId?: string;
	schoolId?: string;
	login?: string; // either email or username
}

export interface FindManyBy {
	usernames: string[];
}

/**
 * Thats the main User type returned from the service functions.
 */
export type User = Omit<DbUser, "createdAt">;


export const userService = {
	async create(input: CreateUser) {
		const isAdmin = input.role === "ADMIN";
		if (!input.githubId && !isAdmin) {
			throw new Error("githubId is required for non-admin users");
		}
		if (!input.schoolId && !isAdmin) {
			throw new Error("schoolId is required for non-admin users");
		}

		const githubId = input.githubId ?? defaultHandle(input.username);
		const schoolId = input.schoolId ?? defaultHandle(input.username);

		return await prisma.user.create({
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
	},

	/**
	 * Finds a single user by one of the unique search fields.
	 */
	async findOne(by: FindOneBy): Promise<User | null> {
		if (!by.id && !by.email && !by.username && !by.githubId && !by.schoolId) {
			return null;
		}

		let user: DbUser | null = null;

		if (by.id) {
			user = await prisma.user.findUnique({ where: { publicId: by.id } });
		} else if (by.email) {
			user = await prisma.user.findUnique({ where: { email: by.email } });
		} else if (by.username) {
			user = await prisma.user.findUnique({ where: { username: by.username } });
		} else if (by.githubId) {
			user = await prisma.user.findUnique({ where: { githubId: by.githubId } });
		} else if (by.schoolId) {
			user = await prisma.user.findUnique({ where: { schoolId: by.schoolId } });
		} else if (by.login) {
			user = await prisma.user.findFirst({
				where: { OR: [{ email: by.login }, { username: by.login }] },
			});
		}

		return user;
	},

	/**
	 * Find many users by some search criteria.
	 */
	async findMany(by: FindManyBy): Promise<User[]> {
		const users = await prisma.user.findMany({
			where: { username: { in: by.usernames } },
		});
		return users;
	},


	/**
	 * Number of users in the database.
	 */
	async count(): Promise<number> {
		return prisma.user.count();
	},


	/**
	 * Update password for a user. Returns the password hash.
	 */
	async updatePassword(user: User, password: string) {
		const updated = await prisma.user.update({
			where: { id: user.id },
			data: { passwordHash: await hashPassword(password) }
		});
		return { passwordHash: updated.passwordHash };
	},
};

/**
 * Synthetic handle for ADMIN accounts that don't need a real GitHub/school id.
 */
function defaultHandle(username: string): string {
	return `@${username}`;
}
