import pkg from "../../../package.json" with { type: "json" };
import { getMethods, type RpcMethod } from ".";
import { jsonSchemaOf } from "./openrpc-document";

// Registers every method, as `openrpc-document.ts` does.
import "@/rpc";

/**
 * Describes the RPC surface as an OpenAPI document, so it can be browsed and
 * called from the Swagger UI the REST API already self-hosts.
 *
 * OpenRPC is the honest description of the protocol and is served as such at
 * `/openrpc.json`. This exists because its reference UIs ship as React
 * component libraries, and bundling React and MUI into a SolidJS app to render
 * a documentation page is a worse trade than projecting the same registry into
 * a format we already have a viewer for.
 *
 * Every method becomes its own operation on `POST /rpc#<method>`. The fragment
 * is what keeps the paths distinct in a document where every operation shares
 * one URL; browsers strip it before sending, so "Try it out" posts to `/rpc`.
 */
export function buildRpcOpenApiDocument() {
	const methods = [...getMethods().values()].sort((a, b) =>
		a.name.localeCompare(b.name),
	);

	return {
		openapi: "3.0.0",
		info: {
			title: "Codehood RPC",
			version: pkg.version,
			description:
				"JSON-RPC 2.0 interface for operations that do not fit the REST CRUD surface.\n\nEvery operation below posts to the single `/rpc` endpoint; the `#method` in each path exists only to keep them apart in this document. The machine-readable description of this API is [OpenRPC](/openrpc.json).\n\nErrors arrive as HTTP 200 with an `error` object. A non-200 means the body was not a JSON-RPC message at all.",
		},
		servers: [{ url: "/", description: "Same origin as the web app" }],
		security: [{ BearerAuth: [] }],
		components: {
			securitySchemes: {
				BearerAuth: {
					type: "http",
					scheme: "bearer",
					description:
						"An API key for the CLI or a grading bot. Issued by POST /api/auth/login, or created on /profile.",
				},
			},
			schemas: { RpcError: RPC_ERROR_SCHEMA },
		},
		paths: Object.fromEntries(
			methods.map((method) => [`/rpc#${method.name}`, operationOf(method)]),
		),
	};
}

function operationOf(method: RpcMethod) {
	return {
		post: {
			operationId: method.name,
			summary: method.summary,
			description: method.description,
			tags: method.tags,
			...(method.isPublic ? { security: [] } : {}),
			requestBody: {
				required: true,
				content: {
					"application/json": {
						schema: {
							type: "object",
							required: ["jsonrpc", "method"],
							properties: {
								jsonrpc: { type: "string", enum: ["2.0"] },
								method: { type: "string", enum: [method.name] },
								params: method.in
									? jsonSchemaOf(method.in, "input")
									: { type: "object" },
								// Omitting `id` makes the call a notification: it
								// runs, and answers 204 with no body. Spelled as a
								// `oneOf` because OpenAPI 3.0 has no union type.
								id: ID_SCHEMA,
							},
						},
						example: {
							jsonrpc: "2.0",
							method: method.name,
							params: {},
							id: 1,
						},
					},
				},
			},
			responses: {
				200: {
					description:
						"A JSON-RPC response carrying either `result` or `error`.",
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									jsonrpc: { type: "string", enum: ["2.0"] },
									id: { ...ID_SCHEMA, nullable: true },
									result: jsonSchemaOf(method.out, "output"),
									error: { $ref: "#/components/schemas/RpcError" },
								},
							},
						},
					},
				},
				204: {
					description: "The request was a notification, so there is no answer.",
				},
			},
		},
	};
}

const ID_SCHEMA = {
	oneOf: [{ type: "string" }, { type: "integer" }],
};

const RPC_ERROR_SCHEMA = {
	type: "object",
	required: ["code", "message"],
	description:
		"-32700 parse error, -32600 invalid request, -32601 no such method, -32602 invalid params, -32603 internal error, -32000 domain error, -32001 authentication required, -32002 permission denied, -32003 not found.",
	properties: {
		code: { type: "integer" },
		message: { type: "string" },
		data: {
			type: "object",
			description: "The same error body the REST API would have returned.",
		},
	},
};
