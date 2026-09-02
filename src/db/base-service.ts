import type { PrismaTx } from "./client";
import type { User } from "./user.service";

//
// Types and interfaces
//

/**
 * The type of authenticated users making a request.
 */
export interface AuthUser extends User { }
export interface BasicAuthUser extends Pick<User, "id" | "role"> { }

/**
 * Sentinel actor for callers with no user behind them.
 * 
 * Used on seeds, manage commands, etc.
 * 
 * A symbol so it can never arrive by accident from parsed JSON or a
 * forgotten variable — writing `SYSTEM` is a decision you can see in a diff.
 */
export const SYSTEM = Symbol("system");

export type Actor = AuthUser | typeof SYSTEM;

/**
 * Shorthand for `{ actor: SYSTEM }`, for trusted call sites with no transaction. 
 */
export const FULL_ACCESS = Object.freeze({ actor: SYSTEM } as const);


/** 
 * Common set of options for service methods. `tx` is optional, but `actor` is required.
 */
export type ServiceOpts = {
	tx?: PrismaTx;
	actor: Actor;
	skipValidation?: { input?: boolean; output?: boolean } | boolean;
};

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
	findOne<Opt extends ServiceOpts>(filter: FilterIn, opts: Opt): Promise<Out | null>;
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
	update<Opt extends ServiceOpts>(filter: Id, update: In, opts: Opt): Promise<Out>;
}

export interface Delete<FilterIn> {
	/**
	 * Delete the first entity that matches the input criteria.
	 */
	delete<Opt extends ServiceOpts>(filter: FilterIn, opts: Opt): Promise<void>;
}

// TODO: move it to the errors package, once it is defined.
/**
 * Thrown by a service when `opts.actor` may not perform the requested
 * operation. 
 * 
 * Framework-agnostic on purpose: services are imported directly by
 * unit tests (outside Astro's Vite pipeline), so this file cannot depend on
 * `astro:actions`, which only resolves inside it. The Astro Actions/API
 * layer is what turns this into an `ActionError({ code: "FORBIDDEN" })` —
 * see `src/actions/helpers.ts`.
 */
// TODO: errors. centralize and define the exception interface 
export class ForbiddenError extends Error {
	constructor(message = "Forbidden") {
		super(message);
		this.name = "ForbiddenError";
	}
}
