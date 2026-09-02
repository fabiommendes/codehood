import { defineMiddleware, sequence } from "astro:middleware";
import { canManageUsers } from "@/auth/permissions";
import { apiKeyService } from "@/db/api-key.service";
import { sessionService } from "@/db/session.service";
import { ensureDemoCourses, ensureDevAdmin } from "./auth/bootstrap";
import * as env from "./constants";

export const SESSION_COOKIE = "session";

export const sessionMiddleware = defineMiddleware(async (context, next) => {
	const token = context.cookies.get(SESSION_COOKIE)?.value;
	if (!token) return next();

	const session = await sessionService.validate(token);
	if (!session) {
		context.cookies.delete(SESSION_COOKIE, { path: "/" });
		return next();
	}

	context.locals.user = { id: session.user.id, role: session.user.role };
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

	if (!context.locals.user) return context.redirect("/login");
	if (!canManageUsers(context.locals.user)) return context.redirect("/403");

	return next();
});

export const apiKeyMiddleware = defineMiddleware(async (context, next) => {
	if (context.locals.user) return next(); // already authenticated via session cookie

	const header = context.request.headers.get("authorization");
	const token = header?.startsWith("Bearer ")
		? header.slice("Bearer ".length)
		: null;
	if (!token) return next();

	const apiKey = await apiKeyService.validate(token);
	if (apiKey) {
		context.locals.user = { id: apiKey.user.id, role: apiKey.user.role };
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
