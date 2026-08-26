import { ActionError } from "astro:actions";
import type * as z from "zod";
import type { User as DbUser, PrismaTx } from "./client";

// biome-ignore lint/suspicious/noExplicitAny: Using 'any' for the 'this' context in the decorator.
type This = any;

//
// Types and interfaces
//
export type UserId = DbUser["id"]; // use brands? & { __brand: "UserId" };
export type User = Omit<DbUser, "id" | "createdAt"> & {
	privateId: UserId;
};

export type ServiceMethodOpts = {
	tx?: PrismaTx;
	asUser?: User;
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

//
// UTILITY FUNCTIONS
//

/**
 * Decorate a function to validate its first argument against a Zod schema.
 *
 * If the validation fails, an ActionError is thrown with a BAD_REQUEST code and
 * the validation error message.
 *
 * @param schema The Zod schema to validate against.
 * @returns A decorator function that validates the first argument of the decorated method.
 */
export function validate<T extends z.ZodTypeAny>(schema: T) {
	function decorator<R extends object[], U>(
		method: (first: z.infer<T>, ...args: R) => U,
	) {
		const originalMethod = method;
		function decorated(this: This, first: z.infer<T>, ...args: R): U {
			const result = schema.safeParse(first);
			if (!result.success) {
				throw new ActionError({
					code: "BAD_REQUEST",
					message: result.error.message,
				});
			}
			return originalMethod.apply(this, [result.data, ...args]);
		}
		return decorated;
	}

	return decorator;
}
