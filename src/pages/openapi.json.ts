import type { APIRoute } from "astro";
import { buildOpenApiDocument } from "@/api/registry/openapi-document";

export const prerender = false;

// The document is a pure function of the route registrations, which are fixed
// at import time, so it is built once per process instead of being committed
// to `public/` by a generator that can go stale between edit and regenerate.
let document: string | undefined;

export const GET: APIRoute = () => {
	document ??= JSON.stringify(buildOpenApiDocument());
	return new Response(document, {
		headers: { "content-type": "application/json" },
	});
};
