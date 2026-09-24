import { expect, test } from "@playwright/test";
import { buildOpenApiDocument } from "@/api/registry/openapi-document";

/**
 * `dev/specs/to-do/api-no-raw-ids.md`, section 5: no request or response
 * schema under `/api/` may carry a property or parameter called `id` or
 * ending in `Id`, other than `publicId`, at any nesting depth. This walks
 * the generated OpenAPI document itself, so it catches every route, not just
 * the ones exercised elsewhere in the suite.
 */

type Json = Record<string, unknown>;

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

/**
 * Exemptions the ruling on this spec's ambiguities carved out:
 *
 * - `publicId` is the rule's own stated exception.
 * - `githubId`/`schoolId` are external identity-provider ids, not raw
 *   database ids.
 * - `question` (the question entity's MDQ document) is exempted as a whole
 *   subtree: its choices carry author-chosen `id`s that name a choice, not a
 *   database row, so the walk never descends into it.
 */
const EXEMPT_PROPERTIES = new Set(["publicId", "githubId", "schoolId"]);
const SKIP_SUBTREE_PROPERTIES = new Set(["question"]);

/// `id` itself, or anything ending in `Id` — except the exemptions above.
function isRawId(name: string): boolean {
	if (EXEMPT_PROPERTIES.has(name)) return false;
	return name === "id" || /Id$/.test(name);
}

/// Resolves a `$ref` against `document.components.schemas`, returning
/// `undefined` (instead of looping forever) the second time the same schema
/// name is reached along one branch.
function deref(
	document: ReturnType<typeof buildOpenApiDocument>,
	schema: unknown,
	seen: ReadonlySet<string>,
): { resolved: Json | undefined; seen: Set<string> } {
	if (!schema || typeof schema !== "object") {
		return { resolved: undefined, seen: new Set(seen) };
	}
	const ref = (schema as Json).$ref as string | undefined;
	if (!ref) return { resolved: schema as Json, seen: new Set(seen) };

	const name = ref.replace("#/components/schemas/", "");
	if (seen.has(name)) return { resolved: undefined, seen: new Set(seen) };

	const nextSeen = new Set(seen);
	nextSeen.add(name);
	return {
		resolved: document.components?.schemas?.[name] as Json | undefined,
		seen: nextSeen,
	};
}

/// Recursively walks a schema, appending `"<location> <json-pointer>"` to
/// `offenses` for every offending property.
function walkSchema(
	document: ReturnType<typeof buildOpenApiDocument>,
	schema: unknown,
	location: string,
	pointer: string,
	offenses: string[],
	seen: ReadonlySet<string>,
): void {
	const { resolved, seen: nextSeen } = deref(document, schema, seen);
	if (!resolved || typeof resolved !== "object") return;

	const properties = resolved.properties as Json | undefined;
	if (properties && typeof properties === "object") {
		for (const [name, propSchema] of Object.entries(properties)) {
			const childPointer = `${pointer}/properties/${name}`;
			if (isRawId(name)) offenses.push(`${location} ${childPointer}`);
			if (SKIP_SUBTREE_PROPERTIES.has(name)) continue;
			walkSchema(
				document,
				propSchema,
				location,
				childPointer,
				offenses,
				nextSeen,
			);
		}
	}

	if (resolved.items !== undefined) {
		walkSchema(
			document,
			resolved.items,
			location,
			`${pointer}/items`,
			offenses,
			nextSeen,
		);
	}

	for (const combinator of ["allOf", "anyOf", "oneOf"] as const) {
		const options = resolved[combinator];
		if (!Array.isArray(options)) continue;
		options.forEach((option, i) => {
			walkSchema(
				document,
				option,
				location,
				`${pointer}/${combinator}/${i}`,
				offenses,
				nextSeen,
			);
		});
	}

	const additional = resolved.additionalProperties;
	if (additional && typeof additional === "object") {
		walkSchema(
			document,
			additional,
			location,
			`${pointer}/additionalProperties`,
			offenses,
			nextSeen,
		);
	}
}

/// Every `"<METHOD> <path> <json-pointer>"` offense in `document`: a
/// parameter or a request/response schema property named `id` or `*Id`.
function collectRawIdOffenses(
	document: ReturnType<typeof buildOpenApiDocument>,
): string[] {
	const offenses: string[] = [];
	const paths = document.paths ?? {};

	for (const [path, pathItem] of Object.entries(paths)) {
		if (!pathItem || typeof pathItem !== "object") continue;

		for (const method of HTTP_METHODS) {
			const operation = (pathItem as Json)[method] as Json | undefined;
			if (!operation) continue;
			const location = `${method.toUpperCase()} ${path}`;

			const parameters = (operation.parameters ?? []) as Json[];
			for (const param of parameters) {
				const name = param.name as string | undefined;
				if (name && isRawId(name)) {
					offenses.push(`${location} /parameters/${name}`);
				}
			}

			const requestBody = operation.requestBody as Json | undefined;
			const bodySchema = (requestBody?.content as Json | undefined)?.[
				"application/json"
			] as Json | undefined;
			if (bodySchema?.schema) {
				walkSchema(
					document,
					bodySchema.schema,
					location,
					"/requestBody/content/application~1json/schema",
					offenses,
					new Set(),
				);
			}

			const responses = (operation.responses ?? {}) as Json;
			for (const [status, response] of Object.entries(responses)) {
				const responseSchema = (
					(response as Json).content as Json | undefined
				)?.["application/json"] as Json | undefined;
				if (!responseSchema?.schema) continue;
				walkSchema(
					document,
					responseSchema.schema,
					location,
					`/responses/${status}/content/application~1json/schema`,
					offenses,
					new Set(),
				);
			}
		}
	}

	return offenses;
}

test("no path, parameter, request body or response under /api/ carries `id` or a `*Id` property, other than `publicId`", () => {
	const document = buildOpenApiDocument();
	const offenses = collectRawIdOffenses(document);
	expect(offenses, offenses.join("\n")).toEqual([]);
});
