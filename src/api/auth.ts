import "reflect-metadata";
import { z } from "zod";
import { verifyPassword } from "@/auth/password";
import { FULL_ACCESS } from "@/core/actor";
import { loginSchema } from "@/core/schemas";
import { apiKeyService } from "@/db/services/api-key.service";
import { sessionService } from "@/db/services/session.service";
import { userService } from "@/db/services/user.service";
import { POST } from "./registry";

/**
 * POST /api/auth/logout — logs out the current user by invalidating their session.
 */
export const logout = POST("/api/auth/logout", {
	out: z.object({ success: z.boolean() }).openapi("LogoutResponse"),
	summary: "Logs out the current user.",
	description: "Logs out the current user by invalidating their session.",
	tags: ["Authentication"],
	operationId: "logout",
	handler: async ({ actor }) => {
		sessionService.delete({ userId: actor.id }, { actor });
		return { success: true };
	},
});

/**
 * POST /api/auth/login — exchanges email/password for a CLI API key.
 */
export const login = POST("/api/auth/login", {
	isPublic: true,
	in: z
		.object({
			login: loginSchema,
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
	handler: async ({ body }) => {
		// TODO: move it to a service method
		const { login, password } = body;

		const user = await userService.findOne({ login }, FULL_ACCESS);
		if (!user || !(await verifyPassword(user.passwordHash, password))) {
			// TODO: define the correct error type
			throw new Error("invalid credentials");
		}

		const { token } = await apiKeyService.create(
			{ userId: user.id, name: "Login token", kind: "CLI" },
			{ actor: user },
		);
		return { token };
	},
});
