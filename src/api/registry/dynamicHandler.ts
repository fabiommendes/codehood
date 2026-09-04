import type { APIRoute } from "astro";
import { NotFound, responseFromException } from "@/core/error";
import { type HttpMethods, readPattern } from ".";

// We must force the imports here to ensure that all routes are registered
// before the dynamic handler is invoked.
export * as api from "..";
export * as auth from "../auth";
export * as health from "../health";

/**
 * The main dynamic handler is a thin wrapper over the registered routes.
 *
 * It runs the routes, catches errors, and returns a JSON response either with
 * success or with the error message and status code.
 */
function handler(method: keyof HttpMethods) {
	const route: APIRoute = async (context) => {
		try {
			const methods = readPattern(context.routePattern);
			const route = methods?.[method];
			if (!route)
				throw new NotFound({
					resource: "url-pattern",
					context: `${method.toUpperCase()} ${context.routePattern}`,
				});
			// `await` inside the `try` on purpose: returning the promise
			// unawaited would let a rejected `view()` sail straight past this
			// catch, and Astro would render a 500 HTML page instead of the
			// JSON error `responseFromException` builds.
			return await route.view(context);
		} catch (err) {
			const response = responseFromException(err);
			return Response.json(response, { status: response.status });
		}
	};
	return route;
}

//
// The astro config hook expects one handler per HTTP method, so we export them all here.
//
export const GET: APIRoute = handler("get");
export const POST: APIRoute = handler("post");
export const PUT: APIRoute = handler("put");
export const DELETE: APIRoute = handler("delete");
export const PATCH: APIRoute = handler("patch");
