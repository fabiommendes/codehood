import { z } from "zod";
import { courseId, inviteId, username } from "./base";
import { userInfo, userRole } from "./user";

export const inviteSchema = z.object({
	id: inviteId,
	tokenHash: z.string(),
	kind: z.enum(["PERSONAL", "CLASSROOM"]),
	email: z.string().nullable(),
	invitedRole: userRole,
	courseId: courseId.nullable(),
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
		tokenHash: true,
		expiresAt: true,
		createdAt: true,
		redemptions: true,
	})
	.extend({ expiresInMs: z.number().int().optional() });

export const invitePK = z.union([
	z.object({ token: z.string().min(1) }),
	z.object({ id: inviteId }),
]);

export const inviteFilter = z.object({
	createdById: username.optional(),
	kind: inviteSchema.shape.kind.optional(),
	courseId: z.number().optional(),
	// Only invites that have not expired yet.
	active: z.boolean().optional(),
});

export const inviteUpdate = z.object({
	expiresAt: z.date().optional(),
	maxUses: z.number().nullable().optional(),
});
