import type { ActionAPIContext } from "astro:actions";
import {
	extendZodWithOpenApi,
	OpenAPIRegistry,
} from "@asteasolutions/zod-to-openapi";
import type { APIContext } from "astro";
import { type ZodType, z } from "zod";
import type { user } from "@/db/user.service";

// Must run before any schema calls .openapi(...) — every route file imports
// this module first, so this is the one place that needs to call it.
extendZodWithOpenApi(z);

/// Actor = User? or User depending if API is public or not.
type Actor<IsPublic> = IsPublic extends false ? user : user | undefined;

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
	handler: HandlerFunction<
		In extends { [key: string]: unknown } ? In : undefined,
		Out,
		Actor<IsPublic>
	>;
};

/// Arguments for the handler function
type HandlerArgs<In, Actor> = Actor extends user
	? { actor: Actor; body: In }
	: { actor?: Actor; body: In };

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
function route<In, Out, IsPublic extends boolean = false>(
	method: keyof HttpMethods,
	path: string,
	options: RouteOptions<In, Out, IsPublic>,
): Route<In, Out, Actor<IsPublic>> {
	const action = options.handler;

	const requestOpts = options.in
		? {
			request: {
				body: { content: { "application/json": { schema: options.in } } },
			},
		}
		: {};

	registry.registerPath({
		method,
		path,
		operationId: options.operationId ?? action.name,
		summary: options.summary,
		description: options.description,
		tags: options.tags,
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
	const result = wrapper as unknown as Route<In, Out, Actor<IsPublic>>;

	// Catches some errors and return an object { value, error } instead of
	// throwing an exception.
	const safeAction = async (args: Parameters<typeof action>[0]) => {
		try {
			const value = await action(args);
			return { value, isError: false };
		} catch (error) {
			return { error: errorToJSON(error), isError: true };
		}
	};

	result.action = async (input: In, context: ActionAPIContext) => {
		throw new Error("not implemented");
	};

	result.view = async ({ locals, request }: APIContext) => {
		const user = locals.user as user | undefined;

		if (!request.headers.get("accept")?.includes("application/json")) {
			// TODO: declare proper error schemas and error codes.
			return Response.json(
				{
					error:
						"Not Accepting JSON, this request requires the 'Accept: application/json' header",
					isError: true,
				},
				{ status: 406 },
			);
		}

		const validated = options.in?.safeParse(await request.json());
		if (validated?.error) {
			return Response.json(
				// TODO: model the error responses. Is treeify good enough?
				{ error: z.treeifyError(validated.error), isError: true },
				{ status: 400 },
			);
		}

		// biome-ignore lint/suspicious/noExplicitAny: Typescript cannot narrow the type to be correct in all possiblities (Body, Actor) in terms of being nullable or not.
		const result = await safeAction({
			actor: user,
			body: validated?.data,
		} as any);

		if (result.isError) {
			const status = (result.error as { status?: number })?.status ?? 400;
			return Response.json(result, { status });
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
// Prepare the global registry
//
export type HttpMethods<T = unknown> = {
	get?: T;
	post?: T;
	put?: T;
	delete?: T;
	patch?: T;
};
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
		"An API key for the CLI or a grading bot. Issued by POST /api/auth/cli-login, or created on /profile.",
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

//
// Auxiliary functions
//
/**
 * Convert exceptions to JSON and show in the API.
 *
 * Codehood defines a few different types of user-facing errors. All other
 * errors should be treated as generic 500 internal server errors, and the
 * details of the exception should not be exposed to the user.
 *
 * The error API expects a .debug field that is only present in development
 * mode, and a .message field that is always present.
 */
function errorToJSON(error: unknown) {
	if (!(error instanceof Error)) return { message: String(error) };

	return {
		message: error.message,
		name: error.name,
		stack: error.stack,
	};
}
