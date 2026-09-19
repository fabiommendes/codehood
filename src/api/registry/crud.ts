import type { ZodObject } from "astro:schema";
import { type ZodType, z } from "zod";
import type { UserActor } from "@/auth/actor";
import {
	ImproperBehavior,
	InvalidData,
	type JSONValue,
	NotFound,
} from "@/core/error";
import type {
	Create,
	Delete,
	FindMany,
	FindOne,
	Update,
	Upsert,
} from "@/db/base-service";
import { coerceForSchema } from "@/utils/query-coerce";
import { slugify } from "@/utils/slugify";
import { DELETE, GET, PATCH, POST, PUT } from "./route";

export type CrudRouteOptions<
	EntityT,
	CreateT,
	FilterT,
	KeyT,
	UpdateT,
	UpsertT,
	ScopeT,
	CreateExtra = Record<string, unknown>,
	UpsertExtra = CreateExtra,
> = {
	/**
	 * The dynamic part of the path that addresses one entity. Defaults to `/[id]`,
	 * but can be overridden to implement natural keys or other schemes.
	 */
	keySegment?: string;

	/**
	 * Turns the dynamic segments into the primary-key filter the service wants.
	 */
	parseKeyParams?: (params: Record<string, string>) => KeyT;

	/// Get additional parameters to include when creating or upserting an entity from the path.
	parseCreateParams?: (params: Record<string, string>) => CreateExtra;

	/// Get additional parameters to include when upserting an entity from the path.
	parseUpsertParams?: (
		params: Record<string, string>,
	) => Record<string, unknown>;

	/// Turns the dynamic segments of a scoped collection path to.
	/// Useful for scoping list views to a parent resource.
	parseListParams?: (params: Record<string, string>) => Record<string, unknown>;

	/// Reused by Filter, Create and Upsert
	parseScopeParams?: (
		params: Record<string, string>,
	) => Record<string, unknown>;

	name: string;
	plural?: string;

	entity: ZodType<EntityT>;
	create: ZodType<CreateT> | null;
	upsert?: ZodType<UpsertT> | null;
	update: ZodType<UpdateT> | null;

	/// Filter type for list views
	filter: ZodType<FilterT> | null;
	scope?: (ZodType<ScopeT> & ZodObject) | null;

	/// Natural key or primary key for the entity.
	key: ZodType<KeyT> | null;

	/**
	 * Extra fields a single-item `GET` reads from the query string and merges
	 * into the key parsed from the path — e.g. a `public` flag that forces the
	 * restricted view even for an actor who could see more. `null` (the
	 * default) means the query string carries nothing for `findOne`.
	 */
	findOneQuery?: ZodType<Record<string, unknown>> | null;

	tags: string[];

	errors?: {
		[status: number]: { description: string; schema: ZodType<unknown> };
	};

	skipDelete?: boolean;
	skipFindOne?: boolean;

	service: FindOne<KeyT, EntityT> &
		FindMany<FilterT & ScopeT, EntityT> &
		Create<CreateT & CreateExtra, EntityT> &
		Update<KeyT, UpdateT, EntityT> &
		Delete<KeyT> &
		Upsert<UpsertT & UpsertExtra, EntityT>;
};

/**
 * RESTful CRUD interface.
 *
 * It receives a complex options object that specifies how the CRUD api endpoints
 * are built.
 *
 * Important notes:
 * 	- Define the entity, create, upsert, update and filter schemas. Thoese
 *    schemas can be subtypes of the underlying model.
 *  - The key schema usually maps to a subtype of entityPK schema that uses
 *    Natural Keys.
 *  - When using natural keys, you often need to set `parseKey` to read the
 *    path segments and return the expected natural key. `parseKey` is used
 *    by the findOne, update and delete operations.
 *
 */
export function CRUD<
	Entity,
	Create,
	Filter,
	Key,
	Update,
	Upsert,
	Scope,
	CreateExtra,
	UpsertExtra,
>(
	path: `/api/${string}`,
	options: CrudRouteOptions<
		Entity,
		Create,
		Filter,
		Key,
		Update,
		Upsert,
		Scope,
		CreateExtra,
		UpsertExtra
	>,
) {
	const api = new CRUDApi(path, options);
	return api.generate();
}

class CRUDApi<
	Entity,
	Create,
	Filter,
	Key,
	Update,
	Upsert,
	Scope,
	CreateExtra,
	UpsertExtra,
> {
	path: string;
	options: CrudRouteOptions<
		Entity,
		Create,
		Filter,
		Key,
		Update,
		Upsert,
		Scope,
		CreateExtra,
		UpsertExtra
	>;
	private name: string;
	private namePlural: string;
	private slug: string;
	private slugTitle: string;
	private pathWithKey: string;
	private has: { [key: string]: true | undefined };
	private filterSchema: ZodType<Filter & Scope> | null;

	// Properties
	get service() {
		return this.options.service;
	}

	constructor(
		path: string,
		options: CrudRouteOptions<
			Entity,
			Create,
			Filter,
			Key,
			Update,
			Upsert,
			Scope,
			CreateExtra,
			UpsertExtra
		>,
	) {
		this.path = path;
		this.options = options;

		this.name = options.name;
		this.namePlural = options.plural ?? `${this.name}s`;

		this.slug = slugify(this.name);
		this.slugTitle = this.slug?.charAt(0).toUpperCase() + this.slug?.slice(1);

		// By default a resource is addressed by a single `[id]` segment
		const itemPath = options.keySegment ?? "/[id]";
		this.pathWithKey = `${path}${itemPath}`;

		// Declare if methods exist
		this.has = {
			create: this.options.create !== null || undefined,
			findOne: !this.options.skipFindOne || undefined,
			findMany: this.options.filter !== null || undefined,
			upsert:
				(this.options.upsert !== null && this.options.update !== null) ||
				undefined,
			update: this.options.update !== null || undefined,
			delete: !this.options.skipDelete || undefined,
		};

		// Create schemas merging the scoped data in the URL with the
		// additional data required by the schema
		// biome-ignore lint/suspicious/noExplicitAny: type eventually lands in the correct one
		let filterSchema: any = this.options.filter;
		if (filterSchema && this.options.scope) {
			filterSchema = filterSchema.extend(this.options.scope?.shape);
		}
		this.filterSchema = filterSchema;
	}

	/**
	 * Parse url + query parameters to a primary key of type `Key`.
	 */
	parseKey(params: Record<string, string>): Key {
		if (this.options.parseKeyParams) return this.options.parseKeyParams(params);

		if (this.options.key === null) throw new ImproperBehavior();

		const validated = this.options.key.safeParse(
			coerceForSchema(this.options.key, params),
		);

		if (validated.error)
			throw InvalidData.fromZodError(validated.error, params);

		return validated.data;
	}

	/**
	 * We try options in the order:
	 *
	 * - parseFilterParams
	 * - parseScopedParams
	 * - empty object
	 */
	parseListUrlParams(params: Record<string, string>): Record<string, unknown> {
		return (
			this.options?.parseListParams?.(params) ??
			this.options?.parseScopeParams?.(params) ??
			{}
		);
	}

	/**
	 * We try options in the order:
	 *
	 * - parseCreateParams
	 * - parseScopedParams
	 * - empty object
	 */
	parseCreateUrlParams(
		params: Record<string, string>,
	): Record<string, unknown> {
		return (
			this.options?.parseCreateParams?.(params) ??
			this.options?.parseScopeParams?.(params) ??
			{}
		);
	}

	/**
	 * We try options in the order:
	 *
	 * - parseUpsertParams
	 * - parseCreateParams
	 * - parseScopedParams
	 * - empty object
	 */
	parseUpsertUrlParams(
		params: Record<string, string>,
	): Record<string, unknown> {
		return (
			this.options?.parseUpsertParams?.(params) ??
			this.options?.parseCreateParams?.(params) ??
			this.options?.parseScopeParams?.(params) ??
			{}
		);
	}

	errors(_method: string) {
		// TODO: insert errors for different methods, if needed
		return this.options.errors;
	}

	/**
	 * Generate all API methods and return the corresponding route handlers.
	 */
	generate() {
		const self = this;

		return {
			__factory: this,

			create:
				this.options.create &&
				POST(this.path, {
					operationId: this.operationId("create"),
					in: this.options.create.openapi(`${this.name}Create`),
					out: this.options.entity.openapi(this.name),
					summary: `Creates a new ${this.name}.`,
					tags: this.options.tags,
					errors: this.errors("create"),
					handler({ actor, body, params }) {
						return self.createHandler({ actor, body, params });
					},
				}),

			findOne:
				this.has.findOne &&
				GET(this.pathWithKey, {
					operationId: this.operationId("read"),
					in: this.options.findOneQuery ?? undefined,
					out: this.options.entity,
					summary: `Find a single ${this.name}.`,
					tags: this.options.tags,
					errors: this.errors("read"),
					handler: async ({ actor, body, params }) => {
						return self.findOneHandler({ actor, params, query: body });
					},
				}),

			findMany:
				this.options.filter &&
				GET(this.path, {
					operationId: this.operationId("list"),
					in: this.options.filter,
					out: this.options.entity.array(),
					summary: `Find multiple ${this.namePlural}.`,
					tags: this.options.tags,
					errors: this.errors("list"),
					handler: async ({ actor, body, params }) => {
						return self.findManyHandler({
							actor,
							body,
							params,
						});
					},
				}),

			update:
				this.options.update &&
				PATCH(this.pathWithKey, {
					operationId: this.operationId("update"),
					in: this.options.update,
					out: this.options.entity,
					summary: `Update a single ${this.name}.`,
					tags: this.options.tags,
					errors: this.errors("update"),
					handler: async ({ actor, body, params }) => {
						return self.updateHandler({ actor, body, params });
					},
				}),

			upsert:
				this.has.upsert &&
				PUT(this.path, {
					operationId: this.operationId("upsert"),
					in: (this.options.upsert ?? this.options.create) as ZodType<Upsert>,
					out: this.options.entity,
					summary: `Upsert a single ${this.name}. Creates if it does not exist, update otherwise.`,
					tags: this.options.tags,
					errors: this.errors("upsert"),
					handler: async ({ actor, body, params }) => {
						return self.upsertHandler({ actor, body, params });
					},
				}),

			delete:
				this.has.delete &&
				DELETE(this.pathWithKey, {
					operationId: this.operationId("delete"),
					out: z
						.object({
							success: z.boolean(),
							message: z.string(),
							deleted: z.boolean(),
						})
						.openapi("Deleted"),
					summary: `Delete a single ${this.name} by primary key.`,
					tags: this.options.tags,
					errors: this.errors("delete"),
					handler: async ({ actor, params }) => {
						return self.deleteHandler({ actor, params });
					},
				}),
		};
	}

	/**
	 * Handler method for the create method.
	 */
	async createHandler(args: {
		actor: UserActor;
		body: Partial<Create>;
		params: Record<string, string>;
	}): Promise<Entity> {
		const { actor, body, params } = args;
		const extra = this.parseCreateUrlParams(params);

		// Merge the request body with any extra fields derived from the route parameters.
		const input = { ...body, ...extra } as Create & CreateExtra;
		return this.service.create(input, { actor });
	}

	/**
	 * Handler method for the findOne method.
	 */
	async findOneHandler(args: {
		actor: UserActor;
		params: Record<string, string>;
		query?: Record<string, unknown>;
	}): Promise<Entity | null> {
		const { actor, params, query } = args;

		const key = { ...this.parseKey(params), ...query };
		const found = await this.service.findOne(key, { actor });

		// Service returns null when we should throw a 404.
		if (!found) throw new NotFound(this.slug, { context: key as JSONValue });

		return found;
	}

	/**
	 * Handle the findMany method.
	 *
	 * - body => the query params passed in the URL
	 * - params => extra params parsed from url fragments.
	 */
	async findManyHandler(args: {
		actor: UserActor;
		body: Filter;
		params: Record<string, string>;
	}): Promise<Entity[]> {
		const { actor, body, params } = args;

		const rawFilter = { ...body, ...this.parseListUrlParams(params) };

		if (this.filterSchema === null)
			throw new ImproperBehavior(
				"this should never be called if filter is not set",
			);

		const validated = InvalidData.zodValidate(
			this.filterSchema.safeParse(rawFilter),
		);

		return this.service.findMany(validated, { actor });
	}

	/**
	 * Handle the update method.
	 */
	async updateHandler(args: {
		actor: UserActor;
		body: Update;
		params: Record<string, string>;
	}): Promise<Entity> {
		const { actor, body, params } = args;

		const key = this.parseKey(params);
		return this.service.update(key, body as Update, { actor });
	}

	/**
	 * Handle the delete method.
	 */
	async deleteHandler(args: {
		actor: UserActor;
		params: Record<string, string>;
	}): Promise<{ success: boolean; message: string; deleted: boolean }> {
		const { actor, params } = args;
		const key = this.parseKey(params);
		let deleted = true;
		let message = `${this.name} deleted successfully`;

		try {
			await this.service.delete(key, { actor });
		} catch (error) {
			if (error instanceof NotFound) {
				deleted = false;
				message = `${this.name} was not present in the database`;
			} else throw error;
		}

		return {
			success: true,
			message,
			deleted,
		};
	}

	/**
	 * Handle the upsert method.
	 */
	async upsertHandler(args: {
		actor: UserActor;
		body: Upsert;
		params: Record<string, string>;
	}): Promise<Entity> {
		const { actor, body, params } = args;
		const extra = this.parseUpsertUrlParams(params);

		// Merge the request body with any extra fields derived from the route parameters.
		const input = { ...body, ...extra } as Upsert & UpsertExtra;

		return this.service.upsert(input, { actor });
	}

	// Private helpers
	private operationId(action: string) {
		return `${action}${this.slugTitle}`;
	}
}
