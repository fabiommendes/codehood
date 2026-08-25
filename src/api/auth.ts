import type { APIContext } from "astro";
import { verifyPassword } from "@/auth/password";
import { apiKeyService } from "@/db/api-key.service";
import { userService } from "@/db/user.service";

/**
 * POST /api/auth/cli-login — exchanges email/password for a CLI API key.
 */
export async function cliLogin(context: APIContext): Promise<Response> {
	const body = await context.request.json().catch(() => null);
	const email = typeof body?.email === "string" ? body.email : null;
	const password = typeof body?.password === "string" ? body.password : null;

	if (!email || !password) {
		return Response.json(
			{ error: "email and password are required" },
			{ status: 400 },
		);
	}

	const user = await userService.findOne({ email });
	if (!user || !(await verifyPassword(user.passwordHash, password))) {
		return Response.json({ error: "invalid credentials" }, { status: 401 });
	}

	const { token } = await apiKeyService.create(user.id, "CLI login", "CLI");
	return Response.json({ token });
}
