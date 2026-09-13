import type { APIRoute } from "astro";
import { buildRpcOpenApiDocument } from "@/rpc/registry/openapi-projection";

export const prerender = false;

// Built once per process, like `/openapi.json` and `/openrpc.json`.
let document: string | undefined;

export const GET: APIRoute = () => {
	document ??= JSON.stringify(buildRpcOpenApiDocument());
	return new Response(document, {
		headers: { "content-type": "application/json" },
	});
};
