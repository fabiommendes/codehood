/**
 * The response to a request on the runner origin.
 */

import type { RunnerAssets } from "./assets";
import { pickEncoding, runnerHeaders } from "./routing";

/** What `serveRunner` needs besides the request. */
export interface RunnerServerOptions {
	assets: RunnerAssets;
	/// Origin of the app, the only one allowed to embed the frame.
	appOrigin: string;
	/// Offers the `fake` language and lets `?isolation=off` turn off
	/// `Document-Isolation-Policy`, for tests. Never in production.
	development: boolean;
}

/**
 * Answers a GET under `/runner/` on the runner origin: the frame page, the
 * service worker, the bundle and the runtime files; 404 for anything else.
 *
 * The caller decides that the request belongs to the runner origin
 * (`requestSide`).
 */
export async function serveRunner(
	request: Request,
	{ assets, appOrigin, development }: RunnerServerOptions,
): Promise<Response> {
	const url = new URL(request.url);
	if (url.pathname === "/runner/frame") {
		const headers = runnerHeaders("frame", appOrigin);
		// Lets tests reach the service worker stdin channel through real detection.
		if (development && url.searchParams.get("isolation") === "off") {
			headers.delete("Document-Isolation-Policy");
		}
		headers.set("Content-Type", "text/html; charset=utf-8");
		const html = assets.framePage({
			appOrigin,
			withFake: development,
			exclusive: url.searchParams.get("exclusive") === "1",
		});
		return new Response(html, { headers });
	}

	const asset = await assets.read(url.pathname, (offered) =>
		pickEncoding(request.headers.get("Accept-Encoding"), offered),
	);
	if (asset === null) return new Response("Not found", { status: 404 });
	const headers = runnerHeaders(asset.kind, appOrigin);
	headers.set("Content-Type", asset.contentType);
	headers.set("Vary", "Accept-Encoding");
	if (asset.encoding) headers.set("Content-Encoding", asset.encoding);
	return new Response(asset.body as BodyInit, { headers });
}
