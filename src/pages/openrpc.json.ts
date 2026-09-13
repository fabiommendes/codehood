import type { APIRoute } from "astro";
import { buildOpenRpcDocument } from "@/rpc/registry/openrpc-document";

export const prerender = false;

// Built once per process: the method registrations are fixed at import time.
// See `src/pages/openapi.json.ts`, which does the same for the REST document.
let document: string | undefined;

export const GET: APIRoute = () => {
	document ??= JSON.stringify(buildOpenRpcDocument());
	return new Response(document, {
		headers: { "content-type": "application/json" },
	});
};
