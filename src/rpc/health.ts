import { z } from "zod";
import { Unavailable } from "@/core/error";
import { prisma } from "@/db/client";
import { METHOD } from "./registry";

/**
 * `health.check` — the RPC counterpart of `GET /api/health`.
 *
 * Unauthenticated on purpose: whatever is probing usually holds no API key,
 * which is often the thing it is checking. Unlike the REST route it answers
 * 200 with an error object when the database is unreachable, because the
 * transport is fine — a probe that cannot tell "server down" from "database
 * down" is the failure this exists to avoid. The REST route keeps its 503 for
 * monitors that only read status codes.
 */
export const check = METHOD("health.check", {
	isPublic: true,
	out: z.object({
		status: z.literal("ok"),
		database: z.literal("ok"),
	}),
	summary: "Liveness/readiness probe",
	description:
		"Confirms the server can reach the database, not just that the process answers HTTP. Unauthenticated — uptime monitors and orchestration probes hitting this usually don't hold an API key.",
	tags: ["System"],
	handler: async () => {
		try {
			await prisma.$queryRaw`SELECT 1`;
		} catch {
			throw new Unavailable("The database is unreachable.");
		}
		return { status: "ok", database: "ok" } as const;
	},
});
