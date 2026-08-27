import {
	extendZodWithOpenApi,
	OpenAPIRegistry,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

/**
 * Adds the `.openapi()` method to every Zod schema. Must run before any
 * schema in the codebase calls `.openapi(...)` — importing this module (for
 * its side effect) is how call sites guarantee that ordering, since ESM
 * hoists imports above the rest of a module's body.
 */
extendZodWithOpenApi(z);

/**
 * Shared across every `src/api/*.ts` handler: each one imports this,
 * registers its own request/response schemas next to the code that
 * validates against them, and calls `registry.registerPath(...)` right
 * there — one source of truth for validation and documentation, no
 * separate spec to keep in sync by hand. `scripts/generate-openapi.ts`
 * imports every handler module (for those side effects) and turns the
 * accumulated registrations into `public/openapi.json`.
 */
export const registry = new OpenAPIRegistry();

export const BEARER_AUTH = "BearerAuth";

registry.registerComponent("securitySchemes", BEARER_AUTH, {
	type: "http",
	scheme: "bearer",
	description:
		"An API key for the CLI or a grading bot. Issued by POST /api/auth/cli-login, or created on /profile.",
});
