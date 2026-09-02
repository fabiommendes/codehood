import type { APIRoute } from "astro";
import { type HttpMethods, readPattern } from ".";

// We must force the imports here to ensure that all routes are registered
// before the dynamic handler is invoked.
export * as auth from "../auth";
// export * as courses from "../courses";
export * as health from "../health";

// export * as sessions from "../sessions";
// export * as users from "../users";

function handler(method: keyof HttpMethods) {
    const route: APIRoute = async (context) => {
        const methods = readPattern(context.routePattern);
        if (!methods) {
            return Response.json({ error: "Not found", pattern: context.routePattern, url: context.url }, { status: 404 });
        }
        const result = methods?.[method]?.view(context);
        if (!result) return Response.json({ error: "Not found" }, { status: 404 });
        return result;
    };
    return route;
}

//
// We export the handlers for each specific HTTP verb
//
export const GET: APIRoute = handler("get");
export const POST: APIRoute = handler("post");
export const PUT: APIRoute = handler("put");
export const DELETE: APIRoute = handler("delete");
export const PATCH: APIRoute = handler("patch");
