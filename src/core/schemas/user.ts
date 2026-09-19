import { z } from "zod";
import { username } from "./base";

export const userSchema = z.object({
	email: z.email(),
	name: z.string().min(1),
	username: z.string().min(1),
	role: z.enum(["STUDENT", "INSTRUCTOR", "ADMIN"]),

	// TODO: add validations for githubId and schoolId (e.g. regex, length)
	// schoolId should read the optional regex from a env variable.
	githubId: z.string().nullable(),
	schoolId: z.string().nullable(),
	passwordHash: z.string(),
	createdAt: z.date(),
});
export const userRole = userSchema.shape.role;

/// A login identifier: either an email or a username.
export const usernameOrEmail = z
	.union([z.email(), username])
	.describe("The user's email or username.");

/// `username` is tightened here rather than on `userSchema` to avoid
/// duplication of validation logic.
export const userCreate = userSchema
	.omit({ passwordHash: true, createdAt: true })
	.partial({ githubId: true, schoolId: true })
	.extend({
		password: z.string().min(1),
		username,
	});

/**
 * PUT-shaped input: `password` is optional and, when present on an existing
 * user, resets the stored one.
 */
export const userUpsert = userCreate.partial({ password: true });

export const userUpdate = userSchema
	.pick({
		name: true,
		email: true,
		githubId: true,
		schoolId: true,
	})
	.extend({
		password: z.string().min(1).optional(),
	})
	.partial()
	.strict();

export const userPK = z.union([
	z.object({ email: z.email() }),
	z.object({ username: z.string() }),
	z.object({ githubId: z.string() }),
	z.object({ schoolId: z.string() }),
	z.object({ login: z.string() }), // email or username
]);

export const userFilter = z.object({
	usernames: z.array(z.string()).optional(),
	take: z.number().int().min(1).max(100).optional(),
});

/**
 * Simplified representation of a user in the system.
 *
 * Usually used embedded in other entities, e.g. `Course.instructor` or `ApiKey.createdBy`.
 */
export const userInfo = userSchema.pick({
	name: true,
	username: true,
});
