/**
 * Type-fu shenanigans: utility types for manipulating and reasoning about TypeScript types.
 *
 * We try to do as much type-level validation as possible. These functions help
 * write very precise/flexible types.
 */

/**
 * A valid key of an object type.
 */
export type Key = string | number | symbol;

/**
 * Expand a type to make it more readable in IDEs and error messages.
 */
export type Pretty<T> = T extends object ? { [K in keyof T]: T[K] } & {} : T;

/**
 * Collect all keys seen in a union.
 */
export type KeysOfUnion<T> = T extends { [key: Key]: unknown }
	? keyof T
	: never;

/**
 * Collect all keys that can be seen in a union, and create an object type with
 * those keys and `undefined` values.
 */
export type Undefine<T> = { [K in KeysOfUnion<T>]: undefined };

/**
 * Make the selected keys optional
 *
 * Example:
 * ```ts
 * type A = Optional<{ a: string; b: number; c: boolean }, "a" | "b">;
 * // A is { a?: string, b?: string, c: boolean }
 */
export type Optional<T extends object, K extends keyof T> = Pretty<
	Omit<T, K> & Partial<Pick<T, K>>
>;

/**
 * Given a union of object types, create a new type that has all the keys of the union,
 * with `undefined` values for keys that are not present in some members of the union.
 */
export type FillUndefineds<T> = Pretty<FillUndefinedsAux<T, KeysOfUnion<T>>>;
type FillUndefinedsAux<T, Ks extends Key> = T extends { [key: Key]: unknown }
	? Partial<{
			[K in Exclude<Ks, keyof T>]: K extends keyof T ? T[K] : undefined;
		}> & { [K in keyof T]: T[K] }
	: never;

type ValueOfKeyAcrossUnion<T, K extends Key> = T extends { [key: Key]: unknown }
	? K extends keyof T
		? T[K]
		: never
	: never;

type IsKeyInEveryMember<T, K extends Key> = [T] extends [{ [P in K]: unknown }]
	? true
	: false;

/**
 * Intersection of all types in a union: a single object type with every key seen across
 * the union. A key present in every member stays required, with its type the union of
 * that key's type across members; a key missing from some member becomes optional.
 *
 * Example:
 * ```ts
 * type A = { a: string; b: number; };
 * type B = { a: string; b: boolean; };
 * type C = { a: boolean; c: string; };
 *
 * type ABC = IntersectUnion<A | B | C>;
 * // ABC is { a: string | boolean; b?: number | boolean | undefined; c?: string | undefined; }
 * ```
 */
export type IntersectUnion<T> = Pretty<
	{
		[K in KeysOfUnion<T> as IsKeyInEveryMember<T, K> extends true
			? K
			: never]: ValueOfKeyAcrossUnion<T, K>;
	} & {
		[K in KeysOfUnion<T> as IsKeyInEveryMember<T, K> extends true ? never : K]?:
			| ValueOfKeyAcrossUnion<T, K>
			| undefined;
	}
>;

/**
 * Extract the keys from an static array of strings, and create a union type from them.
 */
export type ArrayToUnion<T extends readonly string[]> = T[number];

/**
 * Make all properties that accept `undefined` optional.
 */
export type ToOptional<T> = {
	[K in keyof T as undefined extends T[K] ? never : K]-?: T[K];
} & {
	[K in keyof T as undefined extends T[K] ? K : never]+?: Exclude<
		T[K],
		undefined
	>;
};

/**
 * Make all nullable properties optional.
 *
 * ```ts
 * type A = ToNullableOptional<{ x: string | null; y: number }>;
 * // A is { x?: string | undefined; y: number }
 * ```
 */
export type ToNullableOptional<T> = Pretty<
	{
		[K in keyof T as null extends T[K] ? never : K]-?: T[K];
	} & {
		[K in keyof T as null extends T[K] ? K : never]+?: Exclude<T[K], null>;
	}
>;

/**
 * Like Pick<T, K>, but keys in T not selected became optional.
 */
export type Require<T, K extends keyof T> = Pretty<
	{ [K2 in K]: T[K2] } & { [K2 in Exclude<keyof T, K>]?: T[K2] }
>;

/**
 * Like Pick<T, K>, but accept any extra optional keys.
 */
export type Impl<T, K extends keyof T> = { [K2 in K]: T[K2] } & {
	[key: string]: unknown;
};

/**
 * Constructor type.
 *
 * Used to declare class mixins functions.
 */
export type Constructor<T = Record<Key, unknown>> = new (
	...args: unknown[]
) => T;

/**
 * Checks if a type is not `never`.
 */
export type NotNever<T> = [T] extends [never] ? false : true;

/**
 * Assert type `T` is `true`. Usually used for compile-time checks.
 *
 * @example
 * ```ts
 * type A = Assert<NotNever<string>>; // OK
 * type B = Assert<NotNever<never>>;  // Error
 * ```
 *
 */
export type Assert<_T extends true> = undefined;

/**
 * Assert type `T` is `never`, reporting the offending members on failure.
 *
 * @example
 * ```ts
 * type A = AssertNever<Exclude<"a", "a">>; // OK
 * type B = AssertNever<Exclude<"a" | "b", "a">>; // Error: '"b"' does not satisfy 'never'
 * ```
 */
export type AssertNever<_T extends never> = undefined;
