import { defineMiddleware, sequence } from "astro:middleware";
import { ensureDemoCourses, ensureDevAdmin } from "./auth/bootstrap";
import { apiKeyMiddleware } from "./middleware/api-key";
import { sessionMiddleware } from "./middleware/session";

const devBootstrapMiddleware = defineMiddleware(async (_context, next) => {
	// Order matters: ensureDemoCourses creates its own users, and ensureDevAdmin
	// only seeds the admin account while the database has none yet.
	await ensureDevAdmin();
	await ensureDemoCourses();
	return next();
});

export const onRequest = sequence(
	devBootstrapMiddleware,
	sessionMiddleware,
	apiKeyMiddleware,
);
