import { defineMiddleware, sequence } from "astro:middleware";
import { hasPerm } from "@/auth/permissions";
import { clearSessionCookie } from "@/auth/session-cookie";
import { db } from "@/db";
import * as env from "./core/constants";
import { RUNNER_ORIGIN, SESSION_COOKIE } from "./core/constants";
import { APP_CSP, requestSide } from "./runner/server/routing";

/**
 * Answers 404 for `/runner/` paths on the app origin and for anything but
 * `/runner/` on the runner origin, and adds `APP_CSP` to app responses.
 */
export const runnerOriginMiddleware = defineMiddleware(
	async (context, next) => {
		const side = requestSide(context.url, RUNNER_ORIGIN);
		if (side === "not-found") return new Response("Not found", { status: 404 });
		if (side === "runner") return next();

		const response = await next();
		try {
			response.headers.set("Content-Security-Policy", APP_CSP);
			return response;
		} catch {
			// Headers of a `fetch()` or redirect response are immutable.
			const headers = new Headers(response.headers);
			headers.set("Content-Security-Policy", APP_CSP);
			return new Response(response.body, {
				status: response.status,
				statusText: response.statusText,
				headers,
			});
		}
	},
);

/**
 * Rejects ambiguous credentials before either credential is validated.
 */
export const credentialConflictMiddleware = defineMiddleware(
	(context, next) => {
		const authorization = context.request.headers.get("authorization") ?? "";
		const hasBearer = /^Bearer(?:\s|$)/i.test(authorization);
		const hasSession = (context.request.headers.get("cookie") ?? "")
			.split(";")
			.some((cookie) => cookie.split("=", 1)[0]?.trim() === SESSION_COOKIE);
		if (hasBearer && hasSession)
			return Response.json(
				{
					code: "ambiguous-credentials",
					status: 400,
					message: "Use a session cookie or Bearer, not both.",
				},
				{ status: 400 },
			);
		return next();
	},
);

/**
 * The session middleware is responsible for validating the session cookie and populating
 * `context.locals.actor`.
 *
 * `context.locals.actor` is populated with a stripped down version of the
 * authenticated user when the session is valid, or undefined.
 */
export const sessionMiddleware = defineMiddleware(async (context, next) => {
	const token = context.cookies.get(SESSION_COOKIE)?.value;
	if (!token) return next();

	const session = await db.session.validate(token);
	if (!session) {
		clearSessionCookie(context.cookies);
		return next();
	}
	const { role, name, username } = session.user;
	context.locals.actor = { role, name, username };

	// Re-stamp the cookie so its lifetime tracks the (possibly just-refreshed) sliding expiry.
	context.cookies.set(SESSION_COOKIE, token, {
		...env.SESSION_COOKIE_OPTIONS,
		expires: session.expiresAt,
	});

	return next();
});

/**
 * Guards `/admin` and everything under it in one place instead of two lines
 * repeated at the top of every admin page — the failure mode of forgetting
 * those two lines on a new page is an open admin page that looks correct.
 * Runs after `sessionMiddleware`, which is what populates `locals.user`.
 */
export const adminMiddleware = defineMiddleware((context, next) => {
	const { pathname } = context.url;
	if (pathname !== "/admin" && !pathname.startsWith("/admin/")) return next();

	if (!context.locals.actor) return context.redirect("/login");
	if (!hasPerm(context.locals.actor, "system.manage"))
		return context.redirect("/403");

	return next();
});

/**
 * Authenticates a request from its `Authorization: Bearer` API key.
 *
 * Conflicting session credentials have already been rejected; an invalid key
 * leaves the request unauthenticated.
 */
export const apiKeyMiddleware = defineMiddleware(async (context, next) => {
	const header = context.request.headers.get("authorization");
	const token = header?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
	if (!token) return next();

	context.locals.actor = undefined;
	const apiKey = await db.apiKey.validate(token);
	if (apiKey) {
		context.locals.actor = {
			role: apiKey.createdBy.role,
			username: apiKey.createdBy.username,
			name: apiKey.createdBy.name,
			...(apiKey.kind === "BOT" ? { bot: apiKey.name } : {}),
		};
		context.locals.apiKey = { id: apiKey.id, kind: apiKey.kind };
	}

	return next();
});

/// Content types an HTML form can send without a CORS preflight.
const FORM_CONTENT_TYPES = [
	"application/x-www-form-urlencoded",
	"multipart/form-data",
	"text/plain",
];

/**
 * Refuses unsafe cross-site forms and explicitly foreign-Origin API mutations.
 *
 * Validated Bearer requests are exempt because forms cannot set Authorization.
 * JSON without Origin remains available to non-browser clients; browser JSON
 * requests require preflight. REST and RPC share this rule so tunneling a verb
 * through an RPC envelope cannot weaken the origin check.
 */
export const originMiddleware = defineMiddleware((context, next) => {
	const { request } = context;
	if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();
	if (context.locals.apiKey) return next();
	if (request.headers.get("origin") === context.url.origin) return next();

	const origin = request.headers.get("origin");
	const isApi =
		/^\/rpc\/*$/.test(context.url.pathname) ||
		context.url.pathname.startsWith("/api/");
	if (isApi && origin !== null)
		return new Response("Cross-site API mutations are forbidden", {
			status: 403,
		});

	const type = request.headers.get("content-type");
	const formLike =
		type === null ||
		FORM_CONTENT_TYPES.some((t) => type.toLowerCase().startsWith(t));
	if (!formLike) return next();
	return new Response(
		`Cross-site ${request.method} form submissions are forbidden`,
		{ status: 403 },
	);
});

/**
 * Renders an HTML page in full before sending it, so an error thrown while
 * rendering answers with the error page.
 *
 * A streamed page has its status and first chunks on the wire before an
 * island further down throws; the Node adapter then cuts the connection and
 * the browser waits on a document that never completes. Reading the body here
 * turns that error into a throw Astro answers with `500.astro`. The node
 * adapter's `experimentalDisableStreaming` does the same, but only for the
 * built server, not for `astro dev`.
 */
export const bufferHtmlMiddleware = defineMiddleware(async (_context, next) => {
	const response = await next();
	const type = response.headers.get("content-type") ?? "";
	if (!response.body || !type.startsWith("text/html")) return response;

	const html = await response.text();
	return new Response(html, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
});

const COMMON_MIDDLEWARES = [
	runnerOriginMiddleware,
	credentialConflictMiddleware,
	sessionMiddleware,
	apiKeyMiddleware,
	originMiddleware,
	adminMiddleware,
	bufferHtmlMiddleware,
] as const;

// No request ever creates a user. Demo accounts and demo courses are seeded
// by `pnpm run db:seed` and by the test runner, never on the way in: a
// self-healing seed in the request chain means a deployment that boots
// against an empty database hands out its own default accounts.
export const onRequest = sequence(...COMMON_MIDDLEWARES);
