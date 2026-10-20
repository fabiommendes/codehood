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

/// What the login form sends. `login` is not checked for format: the credentials either match a user or they do not.
export const sessionLogin = z.object({
	login: z
		.string()
		.min(1)
		.meta({ form: { label: "Email or username" } }),
	password: z
		.string()
		.min(1)
		.meta({ form: { widget: "password" } }),
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
