import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { registry } from ".";

// Importing this module triggers the import of all other api modules, 
// registering their routes and schemas with the global `registry` object. This is
// necessary for generating the OpenAPI document, which is built from the registry.
import "@/api/registry/dynamicHandler";


const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../..",
);

/**
 * Builds the OpenAPI document from every path registered on `registry`.
 * Shared by `scripts/generate-openapi.ts` (writes it to `public/openapi.json`)
 * and `test/openapi.spec.ts` (checks that file hasn't drifted from the Zod
 * schemas/route registrations it's generated from).
 */
export function buildOpenApiDocument() {
	const pkg = JSON.parse(
		readFileSync(path.join(rootDir, "package.json"), "utf8"),
	);

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
