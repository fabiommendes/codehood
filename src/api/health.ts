import { z } from "zod";
import { prisma } from "@/db/client";
import { GET } from "./registry";


/**
 * GET /api/health — liveness/readiness probe for the CLI, uptime monitors,
 * and orchestration systems. Unauthenticated on purpose: whatever is
 * checking this often can't hold an API key yet (that's what it's checking).
 * Confirms the server can actually reach the database, not just that the
 * process is up — a server that answers HTTP but can't query is not healthy.
 */
export const health = GET("/api/health", {
	isPublic: true,
	out: z.object({
		status: z.literal("ok"),
		database: z.literal("ok"),
	}).openapi("HealthResponse"),
	summary: "Liveness/readiness probe",
	description:
		"Confirms the server can reach the database, not just that the process answers HTTP. Unauthenticated — uptime monitors and orchestration probes hitting this usually don't hold an API key.",
	errors: {
		503: {
			description: "The server is up but cannot reach the database.",
			schema: z.object({
				status: z.literal("error"),
				database: z.literal("unreachable"),
			}).openapi("HealthError"),
		},
	},
	tags: ["System"],
	operationId: "health",
	handler: async (_) => {
		try {
			await prisma.$queryRaw`SELECT 1`;
		} catch {
			throw new HttpError({ status: "error", database: "unreachable" }, 503);
		}
		return { status: "ok", database: "ok" }
	}
});


// TODO: move this to a shared file, since it's used in multiple places
// Define the representation from Error to JSON mapping
class HttpError extends Error {
	body: { [key: string]: unknown };
	status: number;

	constructor(body: { [key: string]: unknown }, status: number = 500) {
		super(`HTTP ${status}: ${JSON.stringify(body)}`);
		this.body = body;
		this.status = status;
	}
}