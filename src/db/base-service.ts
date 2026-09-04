import type { Actor } from "@/core/actor";
import type { PrismaTx } from "./client";

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
> = {
	entity: Entity;
	filter: Filter;
	create?: Create;
	pkFilter?: PkFilter;
	update?: Update;
};

/**
 * Expected composition of interfaces for a CRUD based service. Declare `never`
 * as the type of some operation to omit it from the service.
 */
export interface Crud<T extends CrudT<unknown, unknown>>
	extends Create<T["create"], T["entity"]>,
		FindMany<T["filter"], T["entity"]>,
		FindOne<T["pkFilter"], T["entity"]>,
		Update<T["pkFilter"], T["update"], T["entity"]>,
		Delete<T["pkFilter"]> {}
