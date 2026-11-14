/**
 * One line in the log per request: route pattern, status, duration, time in
 * the database and who asked. Never the URL, the body or a credential.
 */
import type { APIContext } from "astro";
import { logEvent } from "@/utils/log";
import { PERF } from "./config";
import { type RequestPerf, round, runAsRequest, totals } from "./state";

/// Prefix of the ids this process hands out.
const boot = Date.now().toString(36);
let sequence = 0;

/// The id the proxy gave the request, or a new one.
function requestId(request: Request): string {
	const given = request.headers.get("x-request-id");
	if (given && /^[\w-]{1,64}$/.test(given)) return given;
	return `${boot}-${(++sequence).toString(36)}`;
}

/// The method and route pattern; an action is named, since they all share one pattern.
function routeOf(context: APIContext): string {
	const { pathname } = context.url;
	const path = pathname.startsWith("/_actions/")
		? pathname.replace(/\/+$/, "").slice(0, 120)
		: context.routePattern;
	return `${context.request.method} ${path}`;
}

/// `bot` or `cli` for an API key, `session` for a cookie, else `anon`.
function credentialOf(locals: App.Locals): string {
	if (locals.apiKey) return locals.apiKey.kind.toLowerCase();
	return locals.actor ? "session" : "anon";
}

function logRequest(
	context: APIContext,
	perf: RequestPerf,
	status: number,
	ms: number,
): void {
	totals.requests++;
	if (status >= 500) totals.errors++;
	logEvent("request", {
		id: perf.id,
		route: perf.route,
		...(perf.rpc ? { rpc: perf.rpc, rpcCalls: perf.rpcCalls } : {}),
		status,
		ms: round(ms),
		db: round(perf.dbMs),
		queries: perf.queries,
		txWait: round(perf.txWaitMs),
		services: perf.services,
		...(perf.slowest
			? { slowest: perf.slowest, slowestMs: round(perf.slowestMs) }
			: {}),
		auth: credentialOf(context.locals),
		user: context.locals.actor?.username ?? null,
		inFlight: totals.inFlight,
	});
}

/**
 * Runs the rest of the request under a performance context, logs its line and
 * answers with the request id in `X-Request-Id`.
 *
 * The duration is wall time up to the response object: it includes the wait
 * for a busy event loop, so read it next to `db` and to the loop delay of the
 * periodic line.
 */
export function measureRequest(
	context: APIContext,
	next: () => Promise<Response>,
): Promise<Response> {
	if (!PERF.enabled) return next();
	return runAsRequest(
		requestId(context.request),
		routeOf(context),
		async (perf) => {
			const start = performance.now();
			let status = 500;
			totals.inFlight++;
			try {
				const response = await next();
				status = response.status;
				try {
					response.headers.set("X-Request-Id", perf.id);
				} catch {
					// Headers of a `fetch()` or redirect response are immutable.
				}
				return response;
			} finally {
				totals.inFlight--;
				logRequest(context, perf, status, performance.now() - start);
			}
		},
	);
}
