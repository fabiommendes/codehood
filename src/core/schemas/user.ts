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
 * The form an admin uses to add an account: {@link userCreate} with the
 * password rule and texts a form needs.
 */
export const userCreateForm = userCreate.extend({
	name: userSchema.shape.name.meta({ form: { placeholder: "Ada Lovelace" } }),
	email: userSchema.shape.email.meta({
		form: { placeholder: "ada@example.edu" },
	}),
	username: username.meta({ form: { placeholder: "ada" } }),
	githubId: z
		.string()
		.optional()
		.meta({
			form: { label: "GitHub id", placeholder: "required unless Admin" },
		}),
	schoolId: z
		.string()
		.optional()
		.meta({
			form: { label: "School id", placeholder: "required unless Admin" },
		}),
	password: z
		.string()
		.min(8)
		.meta({ form: { widget: "password" } }),
});

/**
 * Editable profile fields.
 *
 * `password` is deliberately absent: a password is changed through
 * {@link passwordChange}, which proves the current one first. Leaving it here
 * made `PATCH /api/user/me` a password reset that any momentarily captured
 * session or leaked API key could use to take the account over for good.
 */
export const userUpdate = userSchema
	.pick({
		name: true,
		email: true,
		githubId: true,
		schoolId: true,
	})
	.partial()
	.strict();

/// Proof of the current password plus the one replacing it.
export const passwordChange = z.object({
	currentPassword: z
		.string()
		.min(1)
		.meta({ form: { label: "Current password", widget: "password" } }),
	newPassword: z
		.string()
		.min(8)
		.meta({ form: { label: "New password", widget: "password" } }),
});

/// What a person types to create their own account.
export const userSignUp = z.object({
	name: userSchema.shape.name.meta({ form: { label: "Name" } }),
	email: userSchema.shape.email,
	username: username.meta({ form: { label: "Username" } }),
	password: z
		.string()
		.min(8)
		.meta({ form: { widget: "password" } }),
	githubId: z
		.string()
		.trim()
		.min(1)
		.meta({ form: { label: "GitHub username" } }),
	schoolId: z
		.string()
		.trim()
		.min(1)
		.meta({ form: { label: "School id" } }),
});

/// The details a user edits on their own profile page.
export const profileUpdate = userSignUp.pick({
	name: true,
	email: true,
	githubId: true,
	schoolId: true,
});

export const userPK = z.union([
	z.object({ email: z.email() }),
	z.object({ username: z.string() }),
	z.object({ githubId: z.string() }),
	z.object({ schoolId: z.string() }),
	z.object({ login: z.string() }), // email or username
]);

/// An account addressed by its username alone.
export const userByUsername = userSchema.pick({ username: true });

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
