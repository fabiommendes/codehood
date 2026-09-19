import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import pkg from "../../../package.json" with { type: "json" };
import { registry } from "./route";

// Importing this module triggers the import of all other api modules,
// registering their routes and schemas with the global `registry` object. This is
// necessary for generating the OpenAPI document, which is built from the registry.
import "@/api/registry/dynamicHandler";

/**
 * Builds the OpenAPI document from every path registered on `registry`.
 *
 * Called by `src/pages/openapi.json.ts`, which caches the result for the life
 * of the process, and by the tests that assert what the document says.
 */
export function buildOpenApiDocument() {
	const generator = new OpenApiGeneratorV3(registry.definitions);
	return generator.generateDocument({
		openapi: "3.0.0",
		info: {
			title: "Codehood API",
			version: pkg.version,
			description:
				"REST API for the Codehood CLI and grading bots. Authenticated with `Authorization: Bearer <key>`, except where noted — see docs/design/url-structure.md.",
		},
		servers: [{ url: "/", description: "Same origin as the web app" }],
		security: [{ BearerAuth: [] }],
	});
}
