import { defineMiddleware } from "astro:middleware";
import { apiKeyService } from "@/db/api-key.service";

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
