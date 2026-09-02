import "reflect-metadata";
import { z } from "zod";
import { verifyPassword } from "@/auth/password";
import { apiKeyService } from "@/db/api-key.service";
import { FULL_ACCESS } from "@/db/base-service";
import { sessionService } from "@/db/session.service";
import { userService } from "@/db/user.service";
import { POST } from "./registry";


/**
 * POST /api/auth/logout — logs out the current user by invalidating their session.
 */
export const logout = POST("/api/auth/logout", {
	out: z.object({ success: z.boolean() }).openapi("LogoutResponse"),
	summary: "Logs out the current user.",
	description: "Logs out the current user by invalidating their session.",
	handler: async ({ actor }) => {
		sessionService.delete({ userId: actor.id }, { actor });
		return { success: true };
	},
});

/**
 * POST /api/auth/login — exchanges email/password for a CLI API key.
 */
export const token = POST("/api/auth/token", {
	isPublic: true,
	in: z.object({
		login: z
			.string()
			.min(1)
			.openapi({ description: "The user's email or username." }),
		password: z.string().min(1),
	}).openapi("LoginRequest"),
	out: z.object({
		token: z.string().openapi({
			description:
				"The raw API key. Shown once; it can't be recovered later.",
		}),
	}).openapi("LoginResponse"),
	handler: async ({ body }) => {
		// TODO: move it to a service method
		const { login, password } = body;

		const user = await userService.findOne({ login }, FULL_ACCESS);
		if (!user || !(await verifyPassword(user.passwordHash, password))) {
			// TODO: define the correct error type
			throw new Error("invalid credentials");
		}

		const { token } = await apiKeyService.create({ userId: user.id, name: "Login token", kind: "CLI" }, { actor: user });
		return { token };
	},
});
