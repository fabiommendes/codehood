import { z } from "zod";
import { courseId, inviteId, publicId, username } from "./base";
import { courseNaturalKey, courseRef } from "./course";
import { userInfo, userRole } from "./user";

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
