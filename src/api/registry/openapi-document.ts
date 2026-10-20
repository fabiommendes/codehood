import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import pkg from "../../../package.json" with { type: "json" };
import { registry } from "./route";

// Importing this module triggers the import of all other api modules,
// registering their routes and schemas with the global `registry` object. This is
// necessary for generating the OpenAPI document, which is built from the registry.
import "@/api/registry/dynamicHandler";

/// Removes the `form` key that zod-to-openapi copies from `.meta({ form })`
/// into every schema. A property that is itself called `form` lives under
/// `properties`, whose keys are names and not keywords, so it stays.
function stripFormMeta(node: unknown, isNameMap = false): void {
	if (Array.isArray(node)) {
		for (const item of node) stripFormMeta(item);
		return;
	}
	if (typeof node !== "object" || node === null) return;
	const record = node as Record<string, unknown>;
	if (!isNameMap) delete record.form;
	for (const [key, value] of Object.entries(record)) {
		stripFormMeta(value, !isNameMap && key === "properties");
	}
}

/**
 * Builds the OpenAPI document from every path registered on `registry`.
 *
 * Called by `src/pages/openapi.json.ts`, which caches the result for the life
 * of the process, and by the tests that assert what the document says.
 */
export function buildOpenApiDocument() {
	const generator = new OpenApiGeneratorV3(registry.definitions);
	const document = generator.generateDocument({
		openapi: "3.0.0",
		info: {
			title: "Codehood API",
			version: pkg.version,
			description:
				"REST API for the Codehood CLI and grading bots. Authenticated with `Authorization: Bearer <key>`, except where noted — see src/urls/README.md.",
		},
		servers: [{ url: "/", description: "Same origin as the web app" }],
		security: [{ BearerAuth: [] }],
	});
	stripFormMeta(document);
	return document;
}
