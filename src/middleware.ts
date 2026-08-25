import { defineMiddleware, sequence } from "astro:middleware";
import { ensureDevAdmin } from "./auth/bootstrap";
import { apiKeyMiddleware } from "./middleware/api-key";
import { sessionMiddleware } from "./middleware/session";

const devBootstrapMiddleware = defineMiddleware(async (_context, next) => {
	await ensureDevAdmin();
	return next();
});

export const onRequest = sequence(
	devBootstrapMiddleware,
	sessionMiddleware,
	apiKeyMiddleware,
);
