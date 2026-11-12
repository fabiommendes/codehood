import type { Actor } from "@/auth/actor";
import type { PrismaTx } from "./client";

/**
 * Common set of options for service methods. `tx` is optional, but `actor` is required.
 */
// r2: adr-0005
export type ServiceOpts = {
	tx?: PrismaTx;
	actor: Actor;
	validate?: "both" | "none" | "input" | "output";

	/**
	 * Makes `update`, `upsert` and `delete` conditional on the row's version
	 * (ADR 0013), see `src/db/conditional-write.ts`.
	 *
	 * - `Date`: the row must exist with exactly this `updatedAt`;
	 * - `null`: the row must not exist (only meaningful for `upsert`);
	 * - absent: unconditional write.
	 *
	 * A mismatch throws `PreconditionFailed` and writes nothing.
	 */
	expectedUpdatedAt?: Date | null;
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
