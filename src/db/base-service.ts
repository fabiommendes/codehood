import type { PrismaTx, Role } from "./client";

//
// Types and interfaces
//

/**
 * The shape of `Astro.locals.user`, and the identity every service call is
 * made on behalf of. Lives here (not `@/auth/permissions`, which needs
 * `Actor`/`SYSTEM` from this file) so the two modules don't import each
 * other.
 */
export interface AuthUser {
	id: number;
	role: Role;
}

/**
 * Sentinel actor for callers with no user behind them: seeds, `manage`
 * commands, `ensureDevAdmin`, and the inside of the invite-redemption
 * transaction, which enrolls an account that does not have a session yet.
 * A symbol so it can never arrive by accident from parsed JSON or a
 * forgotten variable — writing `SYSTEM` is a decision you can see in a diff.
 */
export const SYSTEM = Symbol("system");

export type Actor = AuthUser | typeof SYSTEM;

/**
 * Shorthand for `{ actor: SYSTEM }`, for trusted call sites with no
 * transaction. Frozen because it is a single object shared by every trusted
 * call site — one caller doing `FULL_ACCESS.tx = tx` to save a keystroke
 * would silently route unrelated queries through a finished transaction.
 */
export const FULL_ACCESS = Object.freeze({ actor: SYSTEM } as const);

export type ServiceMethodOpts = {
	tx?: PrismaTx;
	actor?: Actor;
};

export type ActingOpts = {
	tx?: PrismaTx;
	actor: Actor;
};

export interface Create<In, Out> {
	/**
	 * Create a single entity.
	 */
	create(input: In, opts?: ServiceMethodOpts): Promise<Out>;
}

export interface FindOne<FilterIn, Out> {
	/**
	 * Find the first entity that matches the input criteria, or null if none is found.
	 */
	findOne(filter: FilterIn, opts?: ServiceMethodOpts): Promise<Out | null>;
}

export interface FindMany<FilterIn, Out> {
	/**
	 * Find all entities that match the input filters.
	 */
	findMany(filter: FilterIn, opts?: ServiceMethodOpts): Promise<Out[]>;
}

export interface Delete<FilterIn> {
	/**
	 * Delete the first entity that matches the input criteria.
	 */
	delete(filter: FilterIn, opts?: ServiceMethodOpts): Promise<void>;
}

export interface Update<FilterIn, UpdateIn, Out> {
	/**
	 * Update the first entity that matches the input criteria.
	 */
	update(
		filter: FilterIn,
		update: UpdateIn,
		opts?: ServiceMethodOpts,
	): Promise<Out>;
}

/**
 * Access-controlled counterparts of the interfaces above: `opts` and
 * `opts.actor` are required, so a call site that forgets the actor fails to
 * compile instead of silently getting system-level access. Trusted callers
 * running as `SYSTEM` pass `FULL_ACCESS` rather than nothing.
 */
export interface FindOneAs<FilterIn, Out> {
	findOne(filter: FilterIn, opts: ActingOpts): Promise<Out | null>;
}

export interface FindManyAs<FilterIn, Out> {
	findMany(filter: FilterIn, opts: ActingOpts): Promise<Out[]>;
}

export interface CreateAs<In, Out> {
	create(input: In, opts: ActingOpts): Promise<Out>;
}

export interface UpdateAs<FilterIn, UpdateIn, Out> {
	update(filter: FilterIn, update: UpdateIn, opts: ActingOpts): Promise<Out>;
}

export interface DeleteAs<FilterIn> {
	delete(filter: FilterIn, opts: ActingOpts): Promise<void>;
}

/**
 * Thrown by a service when `opts.actor` may not perform the requested
 * operation. Framework-agnostic on purpose: services are imported directly by
 * unit tests (outside Astro's Vite pipeline), so this file cannot depend on
 * `astro:actions`, which only resolves inside it. The Astro Actions/API
 * layer is what turns this into an `ActionError({ code: "FORBIDDEN" })` —
 * see `src/actions/helpers.ts`.
 */
export class ForbiddenError extends Error {
	constructor(message = "Forbidden") {
		super(message);
		this.name = "ForbiddenError";
	}
}
