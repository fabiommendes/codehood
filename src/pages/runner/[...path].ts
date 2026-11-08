import type { APIRoute } from "astro";
import { PRODUCTION, PUBLIC_URL, RUNNER_ORIGIN } from "@/core/constants";
import { readRunnerAsset, renderFramePage } from "@/runner/server/assets";
import {
	pickEncoding,
	requestSide,
	runnerHeaders,
} from "@/runner/server/routing";

const notFound = () => new Response("Not found", { status: 404 });

/// Serves the runner frame page and the sandbox bundle on the runner origin.
export const GET: APIRoute = async ({ url, request }) => {
	// The middleware already decided; checked again so a routing quirk cannot
	// expose the runner on the app origin.
	if (requestSide(url, RUNNER_ORIGIN) !== "runner") return notFound();

	if (url.pathname === "/runner/frame") {
		const headers = runnerHeaders("frame", PUBLIC_URL);
		// Lets tests reach the service worker stdin channel through real detection.
		if (!PRODUCTION && url.searchParams.get("isolation") === "off") {
			headers.delete("Document-Isolation-Policy");
		}
		headers.set("Content-Type", "text/html; charset=utf-8");
		const html = renderFramePage({
			appOrigin: PUBLIC_URL,
			withFake: !PRODUCTION,
			exclusive: url.searchParams.get("exclusive") === "1",
		});
		return new Response(html, { headers });
	}

	const asset = await readRunnerAsset(url.pathname, (offered) =>
		pickEncoding(request.headers.get("Accept-Encoding"), offered),
	);
	if (asset === null) return notFound();
	const headers = runnerHeaders(asset.kind, PUBLIC_URL);
	headers.set("Content-Type", asset.contentType);
	headers.set("Vary", "Accept-Encoding");
	if (asset.encoding) headers.set("Content-Encoding", asset.encoding);
	return new Response(asset.body as BodyInit, { headers });
};
