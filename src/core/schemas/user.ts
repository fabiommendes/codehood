import { z } from "zod";
import { m } from "@/i18n";
import { newUsername, username } from "./base";

export const userSchema = z.object({
	email: z.email(),
	name: z.string().min(1),
	username: z.string().min(1),
	role: z.enum(["STUDENT", "INSTRUCTOR", "ADMIN"]),

	// Raw column values: an account without them stores a sentinel that the
	// input schemas below can never produce.
	githubId: z.string().nullable(),
	schoolId: z.string().nullable(),
	passwordHash: z.string(),
	createdAt: z.date(),
});
export const userRole = userSchema.shape.role;

/// GitHub's own rule for a login. A leading `@` is tolerated and dropped.
const GITHUB_ID_RE = /^@?[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/// The format every school id must have. An instance may narrow it further
/// with `SCHOOL_ID_PATTERN`, checked by the user service.
const SCHOOL_ID_RE = /^[A-Za-z0-9._\-]{1,32}$/;

/// A GitHub username as typed, stored lowercase since GitHub ignores case.
export const githubId = z
	.string()
	.trim()
	.regex(GITHUB_ID_RE, m.forms_schema_github_id_invalid())
	.overwrite((login) => login.replace(/^@/, "").toLowerCase())
	.openapi({ example: "ada-lovelace" });

/// A student's id at their school.
export const schoolId = z
	.string()
	.trim()
	.regex(SCHOOL_ID_RE, m.forms_schema_school_id_invalid())
	.openapi({ example: "231012345" });

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
		username: newUsername,
		githubId: githubId.nullish(),
		schoolId: schoolId.nullish(),
	});

/**
 * The form an admin uses to add an account: {@link userCreate} with the
 * password rule and texts a form needs.
 */
export const userCreateForm = userCreate.extend({
	name: userSchema.shape.name.meta({
		form: { label: m.forms_label_name(), placeholder: "Ada Lovelace" },
	}),
	email: userSchema.shape.email.meta({
		form: { label: m.forms_label_email(), placeholder: "ada@example.edu" },
	}),
	username: newUsername.meta({
		form: { label: m.forms_label_username(), placeholder: "ada" },
	}),
	role: userSchema.shape.role.meta({
		form: {
			label: m.forms_label_role(),
			options: {
				STUDENT: m.forms_role_student(),
				INSTRUCTOR: m.forms_role_instructor(),
				ADMIN: m.forms_role_admin(),
			},
		},
	}),
	githubId: githubId.optional().meta({
		form: {
			label: m.forms_label_github_id(),
			placeholder: m.forms_placeholder_required_unless_admin(),
		},
	}),
	schoolId: schoolId.optional().meta({
		form: {
			label: m.forms_label_school_id(),
			placeholder: m.forms_placeholder_required_unless_admin(),
		},
	}),
	password: z
		.string()
		.min(8)
		.meta({ form: { label: m.forms_label_password(), widget: "password" } }),
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
	.extend({ githubId: githubId.nullable(), schoolId: schoolId.nullable() })
	.partial()
	.strict();

/// Proof of the current password plus the one replacing it.
export const passwordChange = z.object({
	currentPassword: z
		.string()
		.min(1)
		.meta({
			form: { label: m.forms_label_current_password(), widget: "password" },
		}),
	newPassword: z
		.string()
		.min(8)
		.meta({
			form: { label: m.forms_label_new_password(), widget: "password" },
		}),
});

/// What a person types to create their own account.
export const userSignUp = z.object({
	name: userSchema.shape.name.meta({ form: { label: m.forms_label_name() } }),
	email: userSchema.shape.email.meta({
		form: { label: m.forms_label_email() },
	}),
	username: newUsername.meta({ form: { label: m.forms_label_username() } }),
	password: z
		.string()
		.min(8)
		.meta({ form: { label: m.forms_label_password(), widget: "password" } }),
	githubId: githubId.meta({
		form: { label: m.forms_label_github_username() },
	}),
	schoolId: schoolId.meta({ form: { label: m.forms_label_school_id() } }),
});

/// The details a user edits on their own profile page. GitHub and school id are optional here; the action requires them of students.
export const profileUpdate = userSignUp
	.pick({
		name: true,
		email: true,
		githubId: true,
		schoolId: true,
	})
	.extend({
		githubId: userSignUp.shape.githubId.optional(),
		schoolId: userSignUp.shape.schoolId.optional(),
	});

export const userPK = z.union([
	z.object({ email: z.email() }),
	z.object({ username }),
	z.object({ githubId }),
	z.object({ schoolId }),
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
