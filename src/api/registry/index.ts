import type { ActionAPIContext } from "astro:actions";
import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import type { APIContext } from "astro";
import { type ZodObject, type ZodType, z } from "zod";
import type { UserActor as User } from "@/core/actor";
import { InvalidData, NotFound, responseFromException } from "@/core/error";
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

export type CrudRouteOptions<
	Entity,
	Create extends object,
	Filter,
	PkFilter,
	Update extends object,
> = {
	pk?: string;

	/**
	 * The dynamic part of the path that addresses one entity, appended to
	 * `path` for `findOne`/`update`/`delete`.
	 *
	 * Defaults to `/[id]`. A resource whose natural key spans several segments
	 * (a course is `/[discipline]/[course]`) sets this and `parsePk` together.
	 */
	pkPath?: string;

	/**
	 * Turns the dynamic segments into the primary-key filter the service wants.
	 *
	 * Defaults to renaming the `[id]` segment to `pk` and validating against
	 * `filterPk`. A multi-segment `pkPath` needs its own, and is responsible
	 * for its own validation.
	 */
	parsePk?: (params: Record<string, string>) => PkFilter;

	/**
	 * Turns the dynamic segments of a scoped collection path into the fields
	 * that path owns.
	 *
	 * A resource nested under its course
	 * (`/api/course/[discipline]/[course]/resource`) names the course in the
	 * path, so the result is merged over the query filter and the request body.
	 * The path wins, and `filter`/`create` omit those fields so the OpenAPI
	 * document never offers them, which is also why the result is not typed
	 * against either.
	 */
	parseScope?: (params: Record<string, string>) => Record<string, unknown>;

	name: string;
	plural?: string;
	entity: ZodType<Entity>;
	create: ZodType<Create>;
	/**
	 * The `PUT` body, when the address carries part of the upsert input.
	 *
	 * Defaults to `create`. When set, `parseScope`'s fields and every `pkPath`
	 * segment (by name) are merged over the body, so this schema omits them.
	 */
	upsert?: ZodType<object>;
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
	// `ROUTES` is keyed by the pattern Astro hands back, so the segments here
	// are written in Astro's `[name]` spelling. By default a resource is
	// addressed by a single `[id]` segment, and `options.pk` names the FIELD
	// that segment carries (e.g. a discipline is addressed by `slug`), not the
	// segment. `options.pkPath` overrides the shape for a natural key that
	// needs more than one segment.
	const itemPath = options.pkPath ?? "/[id]";
	const pathWithId = `${path}${itemPath}`;
	const pkField = options.pk ?? "id";
	// What the summary line calls the key: the field name for a single segment,
	// the segment names themselves for a multi-segment natural key.
	const pkLabel = options.pkPath
		? segmentNames(options.pkPath).join("/")
		: pkField;
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
	const parsePk =
		options.parsePk ??
		((params: Record<string, string>): PkFilter => {
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
		});
	const parseScope = options.parseScope ?? (() => ({}));

	return {
		create: POST(path, {
			operationId: operationId("create"),
			in: options.create,
			out: options.entity,
			summary: `Creates a new ${name}.`,
			tags: options.tags,
			errors: options.errors,
			handler: async ({ actor, body, params }) => {
				const input = { ...body, ...parseScope(params) } as Create;
				return service.create(input, { actor });
			},
		}),
		findOne: GET(pathWithId, {
			operationId: operationId("read"),
			out: options.entity,
			summary: `Find a single ${name} by ${pkLabel}.`,
			tags: options.tags,
			errors: options.errors,
			// A primary key that names no row is a 404. The service reports it as
			// `null`, which would otherwise be serialized as a 200 carrying
			// `null` — a body that satisfies no entity schema and that a client
			// has to special-case.
			handler: async ({ actor, params }) => {
				const found = await service.findOne(parsePk(params), { actor });
				if (!found) throw new NotFound(slug, { context: `GET ${pathWithId}` });
				return found;
			},
		}),
		findMany: GET(path, {
			operationId: operationId("list"),
			in: options.filter,
			out: options.entity.array(),
			summary: `Find multiple ${namePlural}.`,
			tags: options.tags,
			errors: options.errors,
			handler: async ({ actor, body, params }) => {
				const filter = { ...body, ...parseScope(params) } as Filter;
				return service.findMany(filter, { actor });
			},
		}),
		update:
			hasUpdate &&
			PATCH(pathWithId, {
				operationId: operationId("update"),
				in: options.update,
				out: options.entity,
				summary: `Update a single ${name} by ${pkLabel}.`,
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
		upsert: PUT(pathWithId, {
			operationId: operationId("upsert"),
			in: options.upsert ?? options.create,
			out: options.entity,
			summary: `Upsert a single ${name}. Creates if it does not exist, update otherwise.`,
			tags: options.tags,
			errors: options.errors,
			handler: async ({ actor, body, params }) => {
				// With an explicit `upsert` body, the address supplies the rest: the
				// scope's fields and each `pkPath` segment under its own name.
				const addressed = options.upsert
					? {
							...parseScope(params),
							...Object.fromEntries(
								segmentNames(itemPath).map((name) => [name, params[name]]),
							),
						}
					: {};
				const input = {
					...(body as unknown as object),
					...addressed,
				} as Create;
				return service.upsert(input, { actor });
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
/** The names of every `[segment]` in an Astro route pattern, in order. */
function segmentNames(pattern: string): string[] {
	return [...pattern.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]);
}

/** Rewrites an Astro route pattern (`/api/x/[id]`) as an OpenAPI one. */
function toOpenApiPath(pattern: string): string {
	return pattern.replace(/\[([^\]]+)\]/g, "{$1}");
}

function isZodNeverScheme(schema: ZodType<unknown>): boolean {
	// biome-ignore lint/suspicious/noExplicitAny: ZodType has no way to narrow the type to be correct in all possiblilities.
	return (schema as any)._def.typeName === "ZodNever";
}
