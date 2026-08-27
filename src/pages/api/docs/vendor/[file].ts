export const prerender = false;

import { readFileSync } from "node:fs";
import path from "node:path";
import type { APIRoute } from "astro";
import { absolutePath } from "swagger-ui-dist";

/**
 * Self-hosts the handful of `swagger-ui-dist` assets `/api/docs` needs,
 * rather than pulling them from a CDN. An explicit allowlist, not a raw
 * path join of `params.file` — `params.file` is one dynamic segment (no
 * slashes reach here), but keying off a fixed set of known filenames means
 * a request can never resolve outside this directory no matter what.
 */
const ASSETS: Record<string, string> = {
	"swagger-ui.css": "text/css",
	"swagger-ui-bundle.js": "text/javascript",
	"swagger-ui-standalone-preset.js": "text/javascript",
	"favicon-32x32.png": "image/png",
	"favicon-16x16.png": "image/png",
};

export const GET: APIRoute = ({ params }) => {
	const contentType = params.file ? ASSETS[params.file] : undefined;
	if (!contentType) {
		return new Response("Not found", { status: 404 });
	}

	// biome-ignore lint/style/noNonNullAssertion: params.file truthiness already checked above.
	const body = readFileSync(path.join(absolutePath(), params.file!));
	return new Response(body, {
		headers: {
			"Content-Type": contentType,
			"Cache-Control": "public, max-age=3600",
		},
	});
};
