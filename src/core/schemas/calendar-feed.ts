import { z } from "zod";
import { username } from "./base";
import { userSchema } from "./user";

/// Shape of a calendar feed token: the base64url alphabet `generateToken` produces, which hand-picked seed tokens such as `dev-student-calendar` also fit.
export const calendarFeedToken = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

export const calendarFeedSchema = z.object({
	username: username,
	token: calendarFeedToken,
	lastUsedAt: z.date().nullable(),
	createdAt: z.date(),
});

/// A calendar feed is identified by the user who owns it, one feed per user.
export const calendarFeedPK = calendarFeedSchema.shape.username;

/// Who a valid feed token resolves to: exactly the fields of a `UserActor`.
export const calendarFeedOwner = userSchema.pick({
	username: true,
	name: true,
	role: true,
});
