import { z } from "zod";
import { sessionId, username } from "./base";

export const sessionSchema = z.object({
	id: sessionId,
	tokenHash: z.string(),
	username: username,
	expiresAt: z.date(),
	createdAt: z.date(),
});

export const sessionCreate = z.object({
	username: username,
});

export const sessionCreateResult = z.object({
	token: z.string(),
	session: sessionSchema,
});

// A `token` deletion needs no further check (holding it is proof of
// ownership); a `username` deletion ("log out everywhere") is actor-gated in
// the service.
export const sessionDeletePK = z.union([
	z.object({ token: z.string().min(1) }),
	z.object({ username: username }),
]);
