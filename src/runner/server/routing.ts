/**
 * Splits requests between the app and the runner by origin, and the response
 * headers each side sends.
 *
 * Pure functions: the middleware and the runner endpoint call them with
 * values, so tests need no server.
 */

/**
 * Who answers a request.
 *
 * `app`: the usual pages and API. `runner`: the runner endpoint.
 * `not-found`: answered with 404 before any other middleware.
 */
export type RequestSide = "app" | "runner" | "not-found";

/**
 * Decides who answers `url`.
 *
 * On the runner origin only paths under `/runner/` are `runner`; everything
 * else is `not-found`. On any other origin, paths under `/runner/` are
 * `not-found` and the rest is `app`. With `runnerOrigin` null, `/runner/`
 * paths are `not-found` everywhere.
 *
 * Only requests that reach the middleware are decided here. Files of
 * `public/` and `/_astro/` are answered before it (by Vite in dev, by the
 * node adapter's static handler in production) on every host; in production
 * the reverse proxy must restrict the runner host to `/runner/`.
 */
export function requestSide(
	url: URL,
	runnerOrigin: string | null,
): RequestSide {
	const isRunnerPath = decodedPathname(url).startsWith("/runner/");
	if (runnerOrigin !== null && url.origin === runnerOrigin) {
		return isRunnerPath ? "runner" : "not-found";
	}
	return isRunnerPath ? "not-found" : "app";
}

/// Path as the router sees it: percent-escapes decoded until stable (a
/// double-encoded `/runner/` must not slip past) and repeated slashes folded.
function decodedPathname(url: URL): string {
	let path = url.pathname;
	for (let i = 0; i < 5; i++) {
		let next: string;
		try {
			next = decodeURIComponent(path);
		} catch {
			break;
		}
		if (next === path) break;
		path = next;
	}
	return path.replace(/\/{2,}/g, "/");
}

/**
 * What a runner response carries, which decides its caching and CSP.
 *
 * `frame`: the frame page, `no-cache`. `sw`: the service worker script,
 * `no-cache`. `bundle`: a versioned script of the sandbox bundle,
 * `immutable`. `runtime`: a versioned runtime file, `immutable`.
 */
export type RunnerAssetKind = "frame" | "sw" | "bundle" | "runtime";

/**
 * Headers of every runner response.
 *
 * Always: `Document-Isolation-Policy: isolate-and-credentialless`,
 * `X-Content-Type-Options: nosniff`, and a CSP with `default-src 'self'`,
 * `connect-src 'self'`, `worker-src 'self'`, `object-src 'none'`,
 * `base-uri 'none'`, `form-action 'none'` and `frame-ancestors <appOrigin>`.
 * `bundle` and `runtime` add `'unsafe-eval' 'wasm-unsafe-eval'` to
 * `script-src`, since a Worker's CSP comes from its script; `frame` does not.
 * `Cache-Control` is `no-cache` for `frame` and `sw`, `immutable` otherwise.
 */
export function runnerHeaders(
	kind: RunnerAssetKind,
	appOrigin: string,
): Headers {
	const scriptSrc =
		kind === "bundle" || kind === "runtime"
			? "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'"
			: "script-src 'self'";
	const csp = [
		"default-src 'self'",
		scriptSrc,
		"connect-src 'self'",
		"worker-src 'self'",
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
		`frame-ancestors ${appOrigin}`,
	].join("; ");
	const headers = new Headers({
		"Document-Isolation-Policy": "isolate-and-credentialless",
		"X-Content-Type-Options": "nosniff",
		"Content-Security-Policy": csp,
		"Cache-Control":
			kind === "bundle" || kind === "runtime"
				? "public, max-age=31536000, immutable"
				: "no-cache",
	});
	return headers;
}

/// CSP every app response carries: no other site may frame the app.
export const APP_CSP = "frame-ancestors 'self'";
