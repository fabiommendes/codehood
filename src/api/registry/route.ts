import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import type { APIContext, AstroCookies } from "astro";
import { type ZodObject, type ZodType, z } from "zod";
import type { UserActor } from "@/auth/actor";
import { InvalidData, NotAllowed, responseFromException } from "@/core/error";
import { coerceForSchema, collectSearchParams } from "@/utils/query-coerce";
import { segmentNames, toOpenApiPath } from "./util";

type ActionAPIContext = APIContext;

/// Actor = User? or User depending if API is public or not.
type MaybeActor<IsPublic> = IsPublic extends false
	? UserActor
	: UserActor | undefined;

export type HttpMethods<T = unknown> = {
	get?: T;
	post?: T;
	put?: T;
	delete?: T;
	patch?: T;
};

/**
 * Options for the route/get/post functions and friends.
 */
export type RouteOptions<In, Out, IsPublic extends boolean = false> = {
	isPublic?: IsPublic;
	operationId?: string;
	in?: ZodType<In>;
	out: ZodType<Out>;
	summary?: string;
	description?: string;
	tags?: string[];
	errors?: {
		[status: number]: { description: string; schema: ZodType<unknown> };
	};
	handler: HandlerFunction<In, Out, MaybeActor<IsPublic>>;
};

/// Arguments for the handler function
type HandlerArgs<In, Actor> = Actor extends Actor
	? {
			actor: Actor;
			body: In;
			params: Record<string, string>;
			cookies: AstroCookies;
		}
	: {
			actor?: Actor;
			body: In;
			params: Record<string, string>;
			cookies: AstroCookies;
		};

/// The Handler function itself
type HandlerFunction<In, Out, Actor> = (
	args: HandlerArgs<In, Actor>,
) => Promise<Out>;

/**
 * The return value of the route/get/post functions and friends.
 *
 * If is a regular function with the same signature as the handler, but also
 * has two additional methods:
 *
 * 	- `action`: returns a function that can be used as an action in Astro.
 *  - `view`: returns a function that can be used as a view in Astro.
 *
 */
export type Route<In, Out, Actor> = HandlerFunction<In, Out, Actor> & {
	action: (input: In, context: ActionAPIContext) => unknown;
	view: (ctx: APIContext) => Promise<Response>;
};

//
// Route registration
//
export function route<In, Out, IsPublic extends boolean = false>(
	method: keyof HttpMethods,
	path: string,
	options: RouteOptions<In, Out, IsPublic>,
): Route<In, Out, MaybeActor<IsPublic>> {
	const action = options.handler;

	// GET and DELETE never carry a body, so their input travels as a query
	// string instead; POST/PUT/PATCH keep documenting a JSON request body.
	const readsQueryString = method === "get" || method === "delete";

	const inputOpts = options.in
		? readsQueryString
			? { query: options.in as unknown as ZodObject }
			: {
					body: { content: { "application/json": { schema: options.in } } },
				}
		: {};

	// Astro spells a dynamic segment `[id]`; OpenAPI spells it `{id}`. The
	// registry is keyed by Astro's spelling because that is what
	// `context.routePattern` hands back, so the translation happens here, at
	// the one point where a pattern crosses into the document. Each segment
	// also has to be declared as a path parameter or the document describes an
	// endpoint nobody can call.
	const pathParams = segmentNames(path);
	const paramsOpts = pathParams.length
		? {
				params: z.object(
					Object.fromEntries(pathParams.map((name) => [name, z.string()])),
				),
			}
		: {};

	const requestOpts =
		options.in || pathParams.length
			? { request: { ...inputOpts, ...paramsOpts } }
			: {};

	registry.registerPath({
		method,
		path: toOpenApiPath(path),
		operationId: options.operationId ?? action.name,
		summary: options.summary,
		description: options.description,
		tags: options.tags,
		...(options.isPublic ? { security: [] } : {}),
		...requestOpts,
		responses: {
			200: {
				description: "Success",
				content: {
					"application/json": { schema: options.out },
				},
			},
			// Do it for non-public routes
			// 401: { schema: ApiError, description: "Invalid credentials" },
			...Object.fromEntries(
				Object.entries(options.errors ?? {}).map(
					([status, { description, schema }]) => [
						status,
						{ description, content: { "application/json": { schema } } },
					],
				),
			),
		},
	});

	// We make a unknown cast because typescript insists that In must be a
	// object, but route declares it as an arbitrary type parameter
	const wrapper = (args: Parameters<typeof action>[0]) => action(args);
	const result = wrapper as unknown as Route<In, Out, MaybeActor<IsPublic>>;

	// Catches some errors and return an object { value, error } instead of
	// throwing an exception.
	//
	// The error is serialized with `responseFromException`, the same function
	// `dynamicHandler.ts` uses for anything thrown outside the handler, so a
	// `NotFound` raised by a route reaches the client as a 404 with
	// `code: "not-found"` rather than as a stack trace under a blanket 400.
	const safeAction = async (thunk: () => Promise<Out>) => {
		try {
			const value = await thunk();
			return { value, isError: false };
		} catch (error) {
			return { error: responseFromException(error), isError: true };
		}
	};

	result.action = async (_input: In, _context: ActionAPIContext) => {
		throw new Error("not implemented");
	};

	// This is the exported view function used by astro when routing
	// API requests
	result.view = async ({ locals, request, params, cookies }: APIContext) => {
		const user = locals.actor as UserActor | undefined;

		const result = await safeAction(async () => {
			// A non-public route requires a logged-in actor. Without this check,
			// an unauthenticated request falls through to the handler with
			// `actor: undefined`, which typically blows up as an unhandled
			// TypeError deep in a service and surfaces as a bare 500 instead of
			// the 401 the client needs to distinguish "log in" from "we're broken".
			if (!options.isPublic && !user) {
				throw new NotAllowed("auth.authenticated", {
					message: "Authentication required",
					status: 401,
				});
			}

			const raw = options.in
				? readsQueryString
					? coerceForSchema(
							options.in,
							collectSearchParams(new URL(request.url).searchParams),
						)
					: await request.json()
				: undefined;
			const validated = options.in?.safeParse(raw);
			if (validated?.error)
				throw InvalidData.fromZodError(validated.error, validated.data);

			// biome-ignore-start lint/suspicious/noExplicitAny: Typescript cannot narrow the type to be correct in all possiblities (Body, Actor) in terms of being nullable or not.
			const value = await action({
				actor: user,
				body: validated?.data,
				params: params as Record<string, string>,
				cookies,
			} as any);
			// biome-ignore-end lint/suspicious/noExplicitAny: ...

			// `out` is not just documentation: parsing the handler's return value
			// through it strips anything the schema doesn't declare (e.g. a raw
			// Prisma row's FK columns) before it ever reaches `Response.json`, the
			// same way `options.in` already strips unknown request fields.
			return options.out.parse(value);
		});

		// The error response is returned flat, not wrapped in the internal
		// `{ error, isError }` envelope, so that an error raised inside a
		// handler is shaped exactly like one `dynamicHandler.ts` catches
		// outside it. Nothing reads `isError` past this line.
		if (result.isError) {
			const error = result.error as { status?: number };
			return Response.json(error, { status: error?.status ?? 400 });
		}
		return Response.json(result.value, { status: 200 });
	};

	// We register the route in the global ROUTES object for later use.
	if (!ROUTES[path]) {
		ROUTES[path] = {};
	}
	ROUTES[path][method] = result as Route<unknown, unknown, unknown>;

	return result;
}

/**
 * Convenience function that performs `route("get", ...)`.
 */
export function GET<In, Out, IsPublic extends boolean = false>(
	path: string,
	options: RouteOptions<In, Out, IsPublic>,
) {
	return route("get", path, options);
}

/**
 * Conveniece function that performs `route("post", ...)`.
 */
export function POST<In, Out, IsPublic extends boolean = false>(
	path: string,
	options: RouteOptions<In, Out, IsPublic>,
) {
	return route("post", path, options);
}

/**
 * Conveniece function that performs `route("put", ...)`.
 */
export function PUT<In, Out, IsPublic extends boolean = false>(
	path: string,
	options: RouteOptions<In, Out, IsPublic>,
) {
	return route("put", path, options);
}

/**
 * Conveniece function that performs `route("delete", ...)`.
 */
export function DELETE<In, Out, IsPublic extends boolean = false>(
	path: string,
	options: RouteOptions<In, Out, IsPublic>,
) {
	return route("delete", path, options);
}

/**
 * Conveniece function that performs `route("patch", ...)`.
 */
export function PATCH<In, Out, IsPublic extends boolean = false>(
	path: string,
	options: RouteOptions<In, Out, IsPublic>,
) {
	return route("patch", path, options);
}

//
// Route registry
//

const ROUTES: Record<
	string,
	HttpMethods<Route<unknown, unknown, unknown>>
> = {};

// Registry is used internally and to generate the OpenAPI document.
export const registry = new OpenAPIRegistry();

registry.registerComponent("securitySchemes", "BearerAuth", {
	type: "http",
	scheme: "bearer",
	description:
		"An API key for the CLI or a grading bot. Issued by POST /api/auth/login, or created on /profile.",
});

/**
 * Return an object mapping every registered route to its handler function. This is
 * used by the dynamic API router to dispatch requests to the correct handler.
 */
export function getRouteMapping() {
	return { ...ROUTES };
}

export function readPattern(pattern: string) {
	return ROUTES[pattern];
}
