import { defineMiddleware, sequence } from "astro:middleware";
import { hasPerm } from "@/auth/permissions";
import { db } from "@/db";
import * as env from "./core/constants";
import { SESSION_COOKIE } from "./core/constants";

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
		context.cookies.delete(SESSION_COOKIE, { path: "/" });
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
 * A bearer token replaces whatever actor the session cookie resolved, and an
 * invalid token leaves the request unauthenticated rather than falling back to
 * the cookie.
 */
export const apiKeyMiddleware = defineMiddleware(async (context, next) => {
	const header = context.request.headers.get("authorization");
	const token = header?.startsWith("Bearer ")
		? header.slice("Bearer ".length)
		: null;
	if (!token) return next();

	context.locals.actor = undefined;
	const apiKey = await db.apiKey.validate(token);
	if (apiKey) {
		context.locals.actor = {
			role: apiKey.createdBy.role,
			username: apiKey.createdBy.username,
			name: apiKey.createdBy.name,
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
 * Refuses a cross-site form submission: an unsafe request whose `Origin`
 * differs from the server's and whose content type a browser form can send.
 *
 * This is Astro's own `checkOrigin` rule, minus the requests authenticated by
 * an API key. A page cannot set `Authorization` on a form post, so a bearer
 * request is not a forged one, and the CLI sends no `Origin` at all.
 */
export const originMiddleware = defineMiddleware((context, next) => {
	const { request } = context;
	if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();
	if (context.locals.apiKey) return next();
	if (request.headers.get("origin") === context.url.origin) return next();

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

const COMMON_MIDDLEWARES = [
	sessionMiddleware,
	apiKeyMiddleware,
	originMiddleware,
	adminMiddleware,
] as const;

// No request ever creates a user. Demo accounts and demo courses are seeded
// by `pnpm run db:seed` and by the test runner, never on the way in: a
// self-healing seed in the request chain means a deployment that boots
// against an empty database hands out its own default accounts.
export const onRequest = sequence(...COMMON_MIDDLEWARES);
