import type { APIContext } from "astro";
import { z } from "zod";
import { prisma } from "@/db/client";
import { registry } from "./openapi/registry";

export const HealthOk = z
	.object({
		status: z.literal("ok"),
		database: z.literal("ok"),
	})
	.openapi("HealthOk");

export const HealthError = z
	.object({
		status: z.literal("error"),
		database: z.literal("unreachable"),
	})
	.openapi("HealthError");

registry.registerPath({
	method: "get",
	path: "/api/health",
	operationId: "getHealth",
	summary: "Liveness/readiness probe",
	description:
		"Confirms the server can reach the database, not just that the process answers HTTP. Unauthenticated — uptime monitors and orchestration probes hitting this usually don't hold an API key.",
	tags: ["Health"],
	security: [],
	responses: {
		200: {
			description: "The server is up and can reach the database.",
			content: { "application/json": { schema: HealthOk } },
		},
		503: {
			description: "The server is up but cannot reach the database.",
			content: { "application/json": { schema: HealthError } },
		},
	},
});

/**
 * GET /api/health — liveness/readiness probe for the CLI, uptime monitors,
 * and orchestration systems. Unauthenticated on purpose: whatever is
 * checking this often can't hold an API key yet (that's what it's checking).
 * Confirms the server can actually reach the database, not just that the
 * process is up — a server that answers HTTP but can't query is not healthy.
 */
export async function health(_context: APIContext): Promise<Response> {
	try {
		await prisma.$queryRaw`SELECT 1`;
	} catch {
		return Response.json(
			{ status: "error", database: "unreachable" } satisfies z.infer<
				typeof HealthError
			>,
			{ status: 503 },
		);
	}

	return Response.json({ status: "ok", database: "ok" } satisfies z.infer<
		typeof HealthOk
	>);
}
