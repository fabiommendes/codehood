import type { Actor } from "@/core/actor";
import type { ActionCode } from "@/core/error";
import { NotAllowed } from "@/core/error";
import type { PrismaClient, PrismaTx } from "./client";

/**
 * Common set of options for service methods. `tx` is optional, but `actor` is required.
 */
export type ServiceOpts = {
	tx?: PrismaTx;
	actor: Actor;
	skipValidation?: { input?: boolean; output?: boolean } | boolean;
};

//
// Interface for common CRUD operations
//

export interface Create<In, Out> {
	/**
	 * Create a single entity.
	 */
	create<Opt extends ServiceOpts>(input: In, opts: Opt): Promise<Out>;
}

export interface FindOne<FilterIn, Out> {
	/**
	 * Find the first entity that matches the input criteria, or null if none is found.
	 */
	findOne<Opt extends ServiceOpts>(
		filter: FilterIn,
		opts: Opt,
	): Promise<Out | null>;
}

export interface FindMany<Filter, Out> {
	/**
	 * Find all entities that match the input filters.
	 */
	findMany<Opt extends ServiceOpts>(filter: Filter, opts: Opt): Promise<Out[]>;
}

export interface Update<Id, In, Out> {
	/**
	 * Update the first entity that matches the input criteria.
	 */
	update<Opt extends ServiceOpts>(
		filter: Id,
		update: In,
		opts: Opt,
	): Promise<Out>;
}

export interface Upsert<In, Out> {
	/**
	 * Update an entity if it exists, or create it if it does not (upsert).
	 *
	 * PUT semantics: keyed on the entity's natural key, never on `id`. Fields
	 * left `undefined` keep their stored value; send `null` to clear one.
	 */
	upsert<Opt extends ServiceOpts>(input: In, opts: Opt): Promise<Out>;
}

export interface Delete<FilterIn> {
	// TODO: should delete return a response? return the deleted object?
	/**
	 * Delete the first entity that matches the input criteria.
	 */
	delete<Opt extends ServiceOpts>(filter: FilterIn, opts: Opt): Promise<void>;
}

type CrudT<
	Entity,
	Filter,
	PkFilter = Entity extends { id: unknown } ? { id: Entity["id"] } : unknown,
	Create = Omit<Entity, "id">,
	Update = Partial<Entity>,
	Upsert = Create,
> = {
	entity: Entity;
	filter: Filter;
	create?: Create;
	pkFilter?: PkFilter;
	update?: Update;
	upsert?: Upsert;
};

/**
 * Expected composition of interfaces for a CRUD based service. Declare `never`
 * as the type of some operation to omit it from the service.
 */
export interface Crud<
	T extends CrudT<unknown, unknown, unknown, unknown, unknown, unknown>,
> extends Create<T["create"], T["entity"]>,
		FindMany<T["filter"], T["entity"]>,
		FindOne<T["pkFilter"], T["entity"]>,
		Update<T["pkFilter"], T["update"], T["entity"]>,
		Delete<T["pkFilter"]>,
		Upsert<T["upsert"], T["entity"]> {}

//
// Utilities and reusable logic
//

/** Maps an upsert input onto the pieces `findOne`/`create`/`update` need. */
export type UpsertArgs<In, PkFilter, CreateIn, UpdateIn> = {
	/** The natural key the upsert is keyed on. Never `id`. */
	pk: (input: In) => PkFilter;
	/** Defaults to passing `input` through unchanged. */
	create?: (input: In) => CreateIn;
	/** Defaults to passing `input` through unchanged. */
	update?: (input: In) => UpdateIn;
	/**
	 * Runs on the update branch only, to enforce the create-side permission
	 * that `create()` would have enforced had the row been absent.
	 *
	 * An upsert is a PUT: the same request must be allowed or refused
	 * regardless of whether the row already exists.
	 */
	assertCreatable?: (input: In, opts: ServiceOpts) => void | Promise<void>;
};

/**
 * Runs a `findOne`-then-`create`-or-`update` upsert inside a transaction.
 *
 * Reuses `opts.tx` when the caller already opened one, so an upsert nested in a
 * wider transaction does not open a second.
 */
export async function upsert<Entity, Filter, PkFilter, CreateIn, UpdateIn, In>(
	client: PrismaClient,
	service: Crud<{
		entity: Entity;
		filter: Filter;
		pkFilter: PkFilter;
		create: CreateIn;
		update: UpdateIn;
		upsert: In;
	}>,
	input: In,
	opts: ServiceOpts,
	args: UpsertArgs<In, PkFilter, CreateIn, UpdateIn>,
	/** Action code the probe's `NotAllowed` is re-tagged to, e.g. `upsert-user`. */
	action: ActionCode,
): Promise<Entity> {
	const run = async (tx: PrismaTx): Promise<Entity> => {
		const scoped: ServiceOpts = { ...opts, tx };
		const pkFilter = args.pk(input);

		let existing: Entity | null;
		try {
			existing = await service.findOne(pkFilter, scoped);
		} catch (error) {
			throw error instanceof NotAllowed ? error.as(action) : error;
		}

		if (existing) {
			await args.assertCreatable?.(input, scoped);
			const update = args.update
				? args.update(input)
				: (input as unknown as UpdateIn);
			return service.update(pkFilter, update, scoped);
		}
		const create = args.create
			? args.create(input)
			: (input as unknown as CreateIn);
		return service.create(create, scoped);
	};

	return opts.tx ? run(opts.tx) : client.$transaction((tx) => run(tx));
}
