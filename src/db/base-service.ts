import type { Actor } from "@/auth/actor";
import type { ActionCode } from "@/core/error";
import { NotAllowed } from "@/core/error";
import type { PrismaClient, PrismaTx } from "./client";

/**
 * Common set of options for service methods. `tx` is optional, but `actor` is required.
 */
// r2: adr-0005
export type ServiceOpts = {
	tx?: PrismaTx;
	actor: Actor;
	validate?: "both" | "none" | "input" | "output";
};
export type ServiceOptsWithoutTx = Omit<ServiceOpts, "tx">;

//
// Interface for common CRUD operations
//

export interface Create<In, Out> {
	/**
	 * Create a single entity.
	 */
	create<Opt extends ServiceOpts>(input: In, opts: Opt): Promise<Out>;
}

export interface FindOne<Pk, Out> {
	/**
	 * Find the first entity that matches the input criteria, or null if none is found.
	 */
	findOne<Opt extends ServiceOpts>(filter: Pk, opts: Opt): Promise<Out | null>;
}

export interface FindMany<Filter, Out> {
	/**
	 * Find all entities that match the input filters.
	 */
	findMany<Opt extends ServiceOpts>(filter: Filter, opts: Opt): Promise<Out[]>;
}

export interface Update<Pk, In, Out> {
	/**
	 * Update the first entity that matches the input criteria.
	 */
	update<Opt extends ServiceOpts>(
		filter: Pk,
		update: In,
		opts: Opt,
	): Promise<Out>;
}

export interface Upsert<In, Out> {
	/**
	 * Update an entity if it exists, or create it if it does not (upsert).
	 *
	 * PUT semantics: keyed on the entity's natural key, never on `id`, and
	 * taking the same input `create` does. Fields left `undefined` keep their
	 * stored value; send `null` to clear one.
	 */
	upsert<Opt extends ServiceOpts>(input: In, opts: Opt): Promise<Out>;
}

export interface Delete<Pk> {
	// TODO: should delete return a response? return the deleted object?
	/**
	 * Delete the first entity that matches the input criteria.
	 */
	delete<Opt extends ServiceOpts>(filter: Pk, opts: Opt): Promise<void>;
}

export type CrudT<
	Entity,
	Filter,
	Pk = Entity extends { id: unknown } ? { id: Entity["id"] } : unknown,
	Create = Omit<Entity, "id">,
	Update = Partial<Create>,
> = {
	entity: Entity;
	filter: Filter;
	create?: Create;
	pkFilter?: Pk;
	update?: Update;

	/// `false` switches `upsert` off, so calling it is a type error rather
	/// than a `Method not implemented` at run time. Defaults to on.
	upsert?: boolean;
};

/// `upsert` takes exactly what `create` takes, unless `T` switched it off.
export type UpsertIn<T extends { create?: unknown; upsert?: boolean }> =
	T["upsert"] extends false ? never : T["create"];

/**
 * Expected composition of interfaces for a CRUD based service. Declare `never`
 * as the type of some operation to omit it from the service.
 */
export interface Crud<
	T extends CrudT<unknown, unknown, unknown, unknown, unknown>,
> extends Create<T["create"], T["entity"]>,
		FindMany<T["filter"], T["entity"]>,
		FindOne<T["pkFilter"], T["entity"]>,
		Update<T["pkFilter"], T["update"], T["entity"]>,
		Delete<T["pkFilter"]>,
		Upsert<UpsertIn<T>, T["entity"]> {}

//
// Utilities and reusable logic
//

/**
 * Runs a `findOne`-then-`create`-or-`update` upsert in one transaction.
 *
 * The steps run on `opts.tx` when the caller passes one, and otherwise in a
 * transaction opened on `client`, so two upserts of the same new key cannot
 * both miss the row and both create it.
 */
export async function upsert<Entity, Filter, PkFilter, CreateIn, UpdateIn, In>(
	service: Crud<{
		entity: Entity;
		filter: Filter;
		pkFilter: PkFilter;
		create: CreateIn;
		update: UpdateIn;
	}>,
	input: In,
	args: ServiceOpts & {
		/// The service's client, used to open a transaction when `tx` is absent.
		client: PrismaClient | PrismaTx;

		// The natural key the upsert is keyed on. Never `id`.
		pk: (input: In) => PkFilter;

		/// Defaults to passing `input` through unchanged.

		create?: (input: In) => CreateIn;

		/// Defaults to passing `input` through unchanged.
		update?: (input: In) => UpdateIn;

		/**
		 * Runs on the update branch only, to enforce the create-side permission
		 * that `create()` would have enforced had the row been absent.
		 *
		 * An upsert is a PUT: the same request must be allowed or refused
		 * regardless of whether the row already exists.
		 */
		assertCreatable?: (input: In, opts: ServiceOpts) => void | Promise<void>;

		action: ActionCode;
	},
): Promise<Entity> {
	if (!args.tx && "$transaction" in args.client) {
		return args.client.$transaction((tx) =>
			upsert(service, input, { ...args, tx }),
		);
	}

	const scoped: ServiceOpts = {
		tx: args.tx,
		actor: args.actor,
		validate: args.validate,
	};

	const pkFilter = args.pk(input);

	let existing: Entity | null;
	try {
		existing = await service.findOne(pkFilter, scoped);
	} catch (error) {
		throw error instanceof NotAllowed ? error.as(args.action) : error;
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
}
