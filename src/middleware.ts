import { defineMiddleware, sequence } from "astro:middleware";
import { canManageUsers } from "@/auth/permissions";
import { apiKeyService } from "@/db/services/api-key.service";
import { sessionService } from "@/db/services/session.service";
import * as env from "./core/constants";
import type { UserId } from "./core/schemas";
import { ensureDemoCourses, ensureDevAdmin } from "./db/bootstrap";

export const SESSION_COOKIE = "session";

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

	const session = await sessionService.validate(token);
	if (!session) {
		context.cookies.delete(SESSION_COOKIE, { path: "/" });
		return next();
	}
	const { id, role, name, username } = session.user;
	// FIXME: make the session type the user object correctly so that this cast is not necessary
	context.locals.actor = { id: id as UserId, role, name, username };

	// Re-stamp the cookie so its lifetime tracks the (possibly just-refreshed) sliding expiry.
	context.cookies.set(SESSION_COOKIE, token, {
		httpOnly: true,
		secure: import.meta.env.PROD,
		sameSite: "lax",
		path: "/",
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
	if (!context.url.pathname.startsWith("/admin")) return next();

	if (!context.locals.actor) return context.redirect("/login");
	if (!canManageUsers(context.locals.actor)) return context.redirect("/403");

	return next();
});

export const apiKeyMiddleware = defineMiddleware(async (context, next) => {
	if (context.locals.actor) return next(); // already authenticated via session cookie

	const header = context.request.headers.get("authorization");
	const token = header?.startsWith("Bearer ")
		? header.slice("Bearer ".length)
		: null;
	if (!token) return next();

	const apiKey = await apiKeyService.validate(token);
	if (apiKey) {
		context.locals.actor = {
			id: apiKey.user.id as UserId, // FIXME: this cast should not be necessary if the service typed the user correctly
			role: apiKey.user.role,
			username: apiKey.user.username,
			name: apiKey.user.name,
		};
		context.locals.apiKey = { id: apiKey.id, kind: apiKey.kind };
	}

	return next();
});

const devBootstrapMiddleware = defineMiddleware(async (_context, next) => {
	// Order matters: ensureDemoCourses creates its own users, and ensureDevAdmin
	// only seeds the admin account while the database has none yet.
	await ensureDevAdmin();
	await ensureDemoCourses();
	return next();
});

const COMMON_MIDDLEWARES = [
	sessionMiddleware,
	apiKeyMiddleware,
	adminMiddleware,
] as const;

const DEVELOPMENT_MIDDLEWARES = [devBootstrapMiddleware] as const;

// The Bootstrap middleware is only run in development mode, so that the demo
// courses and dev admin account are not created in production.
export const onRequest =
	env.ENVIRONMENT === "dev"
		? sequence(...DEVELOPMENT_MIDDLEWARES, ...COMMON_MIDDLEWARES)
		: sequence(...COMMON_MIDDLEWARES);
