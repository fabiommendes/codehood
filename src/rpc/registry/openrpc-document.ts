import { z } from "zod";
import pkg from "../../../package.json" with { type: "json" };
import { getMethods, type RpcMethod } from ".";

// Importing the method index registers every method, which is what there is
// to document. Same trick as `openapi-document.ts` on the REST side.
import "@/rpc";

/** JSON Schema for a Zod type, as the input side of the schema. */
export function jsonSchemaOf(schema: z.ZodType, io: "input" | "output") {
	return z.toJSONSchema(schema, {
		io,
		unrepresentable: "any",
		cycles: "ref",
		reused: "inline",
	});
}

/**
 * Expands a method's input object into OpenRPC content descriptors.
 *
 * OpenRPC describes params one at a time; a Codehood method takes a single Zod
 * object, so its properties become the params, which is exactly what a
 * by-name caller sends.
 */
function paramsOf(method: RpcMethod) {
	if (!method.in) return [];
	const schema = jsonSchemaOf(method.in, "input") as {
		properties?: Record<string, unknown>;
		required?: string[];
	};
	return Object.entries(schema.properties ?? {}).map(([name, value]) => ({
		name,
		required: schema.required?.includes(name) ?? false,
		schema: value,
	}));
}

/**
 * Builds the OpenRPC document from every registered method.
 *
 * Called by `src/pages/openrpc.json.ts`, which caches the result for the life
 * of the process, and by the tests that assert what the document says.
 */
export function buildOpenRpcDocument() {
	return {
		openrpc: "1.2.6",
		info: {
			title: "Codehood RPC",
			version: pkg.version,
			description:
				"JSON-RPC 2.0 interface for operations that do not fit the REST CRUD surface. Authenticated with `Authorization: Bearer <key>` or a session cookie, except where noted.",
		},
		servers: [{ name: "default", url: "/rpc" }],
		methods: [...getMethods().values()]
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((method) => ({
				name: method.name,
				summary: method.summary,
				description: method.description,
				tags: method.tags.map((name) => ({ name })),
				// Every handler validates a Zod object and no method defines an
				// argument order, so by-position calls are refused at dispatch.
				paramStructure: "by-name",
				params: paramsOf(method),
				result: {
					name: `${method.name}.result`,
					schema: jsonSchemaOf(method.out, "output"),
				},
				// Not an OpenRPC field. Authentication is out of scope for the
				// spec, and "does this need a key" is the one thing a caller
				// cannot discover by reading the rest of the document.
				"x-authentication": method.isPublic ? "none" : "required",
			})),
	};
}
