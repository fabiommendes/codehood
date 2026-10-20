import { z } from "zod";
import { m } from "@/i18n";
import { courseId, inviteId, publicId, username } from "./base";
import { courseNaturalKey, courseParams, courseRef } from "./course";
import { userInfo, userRole, userSignUp } from "./user";

export const inviteSchema = z.object({
	id: inviteId,
	publicId: publicId,
	kind: z.enum(["PERSONAL", "CLASSROOM"]),
	email: z.string().nullable(),
	invitedRole: userRole,
	courseId: courseId.nullable(),
	/// The course's natural key, or `null` for an invite not bound to one.
	course: courseNaturalKey.nullable(),
	maxUses: z.number().int().nullable(),
	expiresAt: z.date(),
	redemptions: z.number().int(),
	createdBy: userInfo,
	createdAt: z.date(),

	// Only show once, when the invite is created
	token: z.string().optional(),
});

export const inviteCreate = inviteSchema
	.omit({
		id: true,
		publicId: true,
		courseId: true,
		course: true,
		expiresAt: true,
		createdAt: true,
		redemptions: true,
		createdBy: true,
	})
	.extend({
		// Absent for an invite not bound to a course.
		course: courseRef.optional(),
		expiresInMs: z.number().int().optional(),
		// Only honoured for SYSTEM callers, which have no actor to derive it
		// from; any other caller gets `createdBy` from `opts.actor` instead.
		createdBy: userInfo.optional(),
	});

export const invitePK = z.union([
	z.object({ token: z.string().min(1) }),
	z.object({ id: inviteId }),
	z.object({ publicId: publicId }),
]);

export const inviteFilter = z.object({
	createdBy: username.optional(),
	kind: inviteSchema.shape.kind.optional(),
	course: courseRef.optional(),
	// Only invites that have not expired yet.
	active: z.boolean().optional(),
});

export const inviteUpdate = z.object({
	expiresAt: z.date().optional(),
	maxUses: z.number().nullable().optional(),
});

/**
 * A single-use invite sent to an email.
 *
 * `discipline` and `course` are the course's URL segments and come together;
 * both absent makes an invite not bound to a course, e.g. an admin inviting an
 * instructor to the instance.
 */
export const invitePersonal = z
	.object({
		email: z.email().meta({
			form: {
				label: m.forms_label_email(),
				placeholder: "person@example.edu",
			},
		}),
		role: z
			.enum(["INSTRUCTOR", "STUDENT"])
			.default("INSTRUCTOR")
			.meta({
				form: {
					label: m.forms_label_role(),
					options: {
						STUDENT: m.forms_role_student(),
						INSTRUCTOR: m.forms_role_instructor(),
					},
				},
			}),
		discipline: z.string().min(1).optional(),
		course: z.string().min(1).optional(),
	})
	.refine((input) => !input.discipline === !input.course, {
		path: ["course"],
		message: m.forms_schema_invite_course_together(),
	});

/// The invite to revoke, by its public id.
export const inviteRevoke = inviteSchema.pick({ publicId: true });

/// The form that turns an invite into an account. GitHub and school id are optional here; the service requires them of students.
export const inviteAccept = userSignUp.extend({
	token: z.string().min(1),
	githubId: userSignUp.shape.githubId.optional(),
	schoolId: userSignUp.shape.schoolId.optional(),
});

/// Enrolls the signed-in user in the course an invite carries.
export const inviteJoin = inviteAccept.pick({ token: true });

/// A shareable invite link to a course, optionally limited to `maxUses` redemptions.
export const inviteClassroom = courseParams.extend({
	maxUses: z
		.number()
		.int()
		.positive()
		.optional()
		.meta({
			form: {
				label: m.forms_label_invite_max_uses(),
				placeholder: m.forms_placeholder_invite_max_uses(),
			},
		}),
});
