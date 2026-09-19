import type { APIRoute } from "astro";
import { buildOpenApiDocument } from "@/api/registry/openapi-document";
import { PRODUCTION } from "@/core/constants";

export const prerender = false;

// The document is a pure function of the route registrations, which are fixed
// at import time. We cache this value in production and regenerate at every
// request during development.
let document: string | undefined;

export const GET: APIRoute = () => {
	if (PRODUCTION) document ??= JSON.stringify(buildOpenApiDocument());
	else document = JSON.stringify(buildOpenApiDocument());

	return new Response(document, {
		headers: { "content-type": "application/json" },
	});
};
