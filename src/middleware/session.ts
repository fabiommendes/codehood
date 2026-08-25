import { defineMiddleware } from "astro:middleware";
import { sessionService } from "@/db/session.service";

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
