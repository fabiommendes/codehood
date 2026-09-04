import type { ActionAPIContext } from "astro:actions";
import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import type { APIContext } from "astro";
import { type ZodObject, type ZodType, z } from "zod";
import type { UserActor as User } from "@/core/actor";
import { InvalidData } from "@/core/error";
import type { Crud } from "@/db/base-service";
import { coerceForSchema, collectSearchParams } from "@/utils/query-coerce";

/// Actor = User? or User depending if API is public or not.
type MaybeActor<IsPublic> = IsPublic extends false ? User : User | undefined;

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
	tags: string[];
	errors?: {
		[status: number]: { description: string; schema: ZodType<unknown> };
	};
	handler: HandlerFunction<
		In extends { [key: string]: unknown } ? In : undefined,
		Out,
		MaybeActor<IsPublic>
	>;
};

/// Arguments for the handler function
type HandlerArgs<In, Actor> = Actor extends Actor
	? { actor: Actor; body: In; params: Record<string, string> }
	: { actor?: Actor; body: In; params: Record<string, string> };

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
): Route<In, Out, MaybeActor<IsPublic>> {
	const action = options.handler;

	// GET and DELETE never carry a body, so their input travels as a query
	// string instead; POST/PUT/PATCH keep documenting a JSON request body.
	const readsQueryString = method === "get" || method === "delete";

	const requestOpts = options.in
		? readsQueryString
			? { request: { query: options.in as unknown as ZodObject } }
			: {
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
	const safeAction = async (thunk: () => Promise<Out>) => {
		try {
			const value = await thunk();
			return { value, isError: false };
		} catch (error) {
			return { error: errorToJSON(error), isError: true };
		}
	};

	result.action = async (_input: In, _context: ActionAPIContext) => {
		throw new Error("not implemented");
	};

	// This is the exported view function used by astro when routing
	// API requests
	result.view = async ({ locals, request, params }: APIContext) => {
		const user = locals.actor as User | undefined;

		const result = await safeAction(async () => {
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
			return action({
				actor: user,
				body: validated?.data,
				params: params as Record<string, string>,
			} as any);
			// biome-ignore-end lint/suspicious/noExplicitAny: ...
		});

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

export type CrudRouteOptions<
	Entity,
	Create extends object,
	Filter,
	PkFilter,
	Update extends object,
> = {
	pk?: string;
	name: string;
	plural?: string;
	entity: ZodType<Entity>;
	create: ZodType<Create>;
	update: ZodType<Update>;
	filter: ZodType<Filter>;
	filterPk: ZodType<PkFilter>;
	tags: string[];
	errors?: {
		[status: number]: { description: string; schema: ZodType<unknown> };
	};
	service: Crud<{
		entity: Entity;
		create: Create;
		filter: Filter;
		pkFilter: PkFilter;
		update: Update;
	}>;
	extra?: Record<string, Route<unknown, unknown, User>>;
};

/**
 * RESTful CRUD interface
 */
export function CRUD<
	Entity,
	Create extends object,
	Filter,
	PkFilter,
	Update extends object,
>(
	path: `/api/${string}`,
	options: CrudRouteOptions<Entity, Create, Filter, PkFilter, Update>,
) {
	// The dynamic segment is always literally `[id]`, because `hook.ts` injects
	// exactly `/api/<resource>/[id]` into Astro and `ROUTES` is keyed by the
	// pattern Astro hands back. `options.pk` names the FIELD that segment
	// carries (e.g. a discipline is addressed by `slug`), not the segment.
	const pathWithId = `${path}/[id]`;
	const pkField = options.pk ?? "id";
	const slug =
		path.split("/").findLast((segment) => segment.length > 0) ?? path;
	const slugTitle = slug?.charAt(0).toUpperCase() + slug?.slice(1);
	const name = options.name;
	const namePlural = options.plural ?? `${name}s`;
	const service = options.service;
	const operationId = (action: string) => `${action}${slugTitle}`;
	const hasUpdate = !isZodNeverScheme(options.update) || undefined;

	// `findOne`/`update`/`delete` all key off the dynamic route segment
	// (`pathWithId`), never off a body or query string — but that segment is
	// still just as untrusted as either, so it goes through `filterPk` here
	// exactly like a parsed body would, before any service ever sees it.
	const parsePk = (params: Record<string, string>): PkFilter => {
		// Rename the `[id]` segment to whatever field `filterPk` actually wants.
		// The stale `id` is dropped, not just shadowed: a union PK like
		// `coursePK` would otherwise match its `{ id }` branch off a value that
		// was never an id.
		const raw: Record<string, string> = { ...params };
		if (pkField !== "id" && raw.id !== undefined) {
			raw[pkField] = raw.id;
			delete raw.id;
		}
		const validated = options.filterPk.safeParse(
			coerceForSchema(options.filterPk, raw),
		);
		if (validated.error)
			throw InvalidData.fromZodError(validated.error, validated.data);
		return validated.data;
	};

	return {
		create: POST(path, {
			operationId: operationId("create"),
			in: options.create,
			out: options.entity,
			summary: `Creates a new ${name}.`,
			tags: options.tags,
			errors: options.errors,
			handler: async ({ actor, body }) => {
				return service.create(body as Create, { actor });
			},
		}),
		findOne: GET(pathWithId, {
			operationId: operationId("read"),
			out: options.entity,
			summary: `Find a single ${name} by ${options.pk ?? "id"}.`,
			tags: options.tags,
			errors: options.errors,
			handler: async ({ actor, params }) => {
				return service.findOne(parsePk(params), { actor });
			},
		}),
		findMany: GET(path, {
			operationId: operationId("list"),
			in: options.filter,
			out: options.entity.array(),
			summary: `Find multiple ${namePlural}.`,
			tags: options.tags,
			errors: options.errors,
			handler: async ({ actor, body }) => {
				return service.findMany(body as Filter, { actor });
			},
		}),
		update:
			hasUpdate &&
			PATCH(pathWithId, {
				operationId: operationId("update"),
				in: options.update,
				out: options.entity,
				summary: `Update a single ${name} by ${options.pk ?? "id"}.`,
				tags: options.tags,
				errors: options.errors,
				handler: async ({ actor, body, params }) => {
					return service.update(parsePk(params), body as Update, { actor });
				},
			}),
		delete: DELETE(pathWithId, {
			operationId: operationId("delete"),
			// TOOD: maybe return the deleted entity.
			out: z
				.object({ success: z.boolean(), message: z.string() })
				.openapi("Deleted"),
			summary: `Delete a single ${name} by primary key.`,
			tags: options.tags,
			errors: options.errors,
			handler: async ({ actor, params }) => {
				await service.delete(parsePk(params), { actor });
				return { success: true, message: `${name} deleted successfully` };
			},
		}),
	};
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

function isZodNeverScheme(schema: ZodType<unknown>): boolean {
	// biome-ignore lint/suspicious/noExplicitAny: ZodType has no way to narrow the type to be correct in all possiblilities.
	return (schema as any)._def.typeName === "ZodNever";
}
