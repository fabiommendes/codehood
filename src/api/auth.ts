import { z } from "zod";
import { FULL_ACCESS } from "@/auth/actor";
import { verifyPassword } from "@/auth/password";
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/core/constants";
import { NotAllowed } from "@/core/error";
import { usernameOrEmail } from "@/core/schemas";
import { db } from "@/db";
import { POST } from "./registry";

const invalidCredentials = z
	.object({
		type: z.literal("error"),
		code: z.literal("not-allowed"),
		status: z.literal(401),
		message: z.string(),
		action: z.string(),
		timestamp: z.coerce.date(),
	})
	.openapi("InvalidCredentials");

/**
 * POST /api/auth/logout — logs out the current user by invalidating their
 * session, Bearer key or cookie alike, and clears the session cookie if set.
 */
export const logout = POST("/api/auth/logout", {
	out: z.object({ success: z.boolean() }).openapi("LogoutResponse"),
	summary: "Logs out the current user.",
	description: "Logs out the current user by invalidating their session.",
	tags: ["Authentication"],
	operationId: "logout",
	handler: async ({ actor, cookies }) => {
		await db.session.delete({ username: actor.username }, { actor });
		cookies.delete(SESSION_COOKIE, { path: "/" });
		return { success: true };
	},
});

/**
 * POST /api/auth/login — exchanges email/password for a CLI API key, and
 * also sets a session cookie so a browser client (e.g. Swagger UI's "Try it
 * out") is authenticated for subsequent same-origin requests without having
 * to paste the token into the Bearer auth dialog.
 */
export const login = POST("/api/auth/login", {
	isPublic: true,
	in: z
		.object({
			login: usernameOrEmail,
			password: z.string().min(1),
		})
		.openapi("LoginRequest"),
	out: z
		.object({
			token: z.string().openapi({
				description:
					"The raw API key. Shown once; it can't be recovered later.",
			}),
		})
		.openapi("LoginResponse"),
	tags: ["Authentication"],
	operationId: "login",
	errors: {
		401: {
			description: "The login or password is incorrect.",
			schema: invalidCredentials,
		},
	},
	handler: async ({ body, cookies }) => {
		// TODO: move it to a service method
		const { login, password } = body;

		const user = await db.user.findOne({ login }, FULL_ACCESS);
		if (!user || !(await verifyPassword(user.passwordHash, password))) {
			throw new NotAllowed("session.create", {
				message: "Invalid login or password.",
				status: 401,
			});
		}

		const { token } = await db.apiKey.create(
			{
				createdBy: { username: user.username, name: user.name },
				name: "Login token",
				kind: "CLI",
			},
			{ actor: user },
		);

		const session = await db.session.create(
			{ username: user.username },
			{ actor: user },
		);
		cookies.set(SESSION_COOKIE, session.token, {
			...SESSION_COOKIE_OPTIONS,
			expires: session.session.expiresAt,
		});

		return { token };
	},
});
