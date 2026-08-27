import type { APIContext } from "astro";
import { z } from "zod";
import { verifyPassword } from "@/auth/password";
import { apiKeyService } from "@/db/api-key.service";
import { FULL_ACCESS } from "@/db/base-service";
import { userService } from "@/db/user.service";
import { registry } from "./openapi/registry";

export const CliLoginRequest = z
	.object({
		email: z.email(),
		password: z.string().min(1),
	})
	.openapi("CliLoginRequest");

export const CliLoginResponse = z
	.object({
		token: z.string().openapi({
			description:
				"The raw API key. Shown once — store it; it can't be recovered later.",
		}),
	})
	.openapi("CliLoginResponse");

export const ApiError = z
	.object({
		error: z.string(),
	})
	.openapi("ApiError");

registry.registerPath({
	method: "post",
	path: "/api/auth/cli-login",
	operationId: "cliLogin",
	summary: "Exchange email/password for a CLI API key",
	description:
		"Verifies the given credentials and issues a new CLI-kind API key for that user, the same as one created on /profile.",
	tags: ["Auth"],
	security: [],
	request: {
		body: {
			content: { "application/json": { schema: CliLoginRequest } },
		},
	},
	responses: {
		200: {
			description: "A new API key.",
			content: { "application/json": { schema: CliLoginResponse } },
		},
		400: {
			description: "Missing or malformed email/password.",
			content: { "application/json": { schema: ApiError } },
		},
		401: {
			description: "The email/password pair does not match any user.",
			content: { "application/json": { schema: ApiError } },
		},
	},
});

/**
 * POST /api/auth/cli-login — exchanges email/password for a CLI API key.
 */
export async function cliLogin(context: APIContext): Promise<Response> {
	const body = await context.request.json().catch(() => null);
	const parsed = CliLoginRequest.safeParse(body);
	if (!parsed.success) {
		return Response.json(
			{ error: "email and password are required" } satisfies z.infer<
				typeof ApiError
			>,
			{ status: 400 },
		);
	}
	const { email, password } = parsed.data;

	const user = await userService.findOne({ email }, FULL_ACCESS);
	if (!user || !(await verifyPassword(user.passwordHash, password))) {
		return Response.json(
			{ error: "invalid credentials" } satisfies z.infer<typeof ApiError>,
			{ status: 401 },
		);
	}

	const { token } = await apiKeyService.create(
		{ userId: user.id, name: "CLI login", kind: "CLI" },
		{ actor: { id: user.id, role: user.role } },
	);
	return Response.json({ token } satisfies z.infer<typeof CliLoginResponse>);
}
