/**
 * A valid key of an object type.
 */
export type Key = string | number | symbol;

/**
 * Expand a type to make it more readable in IDEs and error messages.
 */
export type Pretty<T> = T extends object
    ? { [K in keyof T]: Pretty<T[K]> }
    : T;

/** 
 * Collect all keys seen in a union.
 */
export type KeysOfUnion<T> = T extends { [key: Key]: unknown } ? keyof T : never;

/**
 * Collect all keys that can be seen in a union, and create an object type with 
 * those keys and `undefined` values.
 */
export type Undefineds<T> = { [K in KeysOfUnion<T>]: undefined };

/**
 * Given a union of object types, create a new type that has all the keys of the union,
 * with `undefined` values for keys that are not present in some members of the union.
 */
export type FillUndefineds<T> = Pretty<FillUndefinedsAux<T, KeysOfUnion<T>>>;
type FillUndefinedsAux<T, Ks extends Key> =
    T extends { [key: Key]: unknown }
    ? Partial<{ [K in Exclude<Ks, keyof T>]: K extends keyof T ? T[K] : undefined }> & { [K in keyof T]: T[K] }
    : never;

/**
 * Intersection of all types in a union.
 * 
 * Example:
 * ```ts
 * type A = { a: string; b: number; };
 * type B = { a: string; b: boolean; };
 * type C = { a: boolean; c: string; };
 * 
 * type ABC = IntersectUnion<A | B | C>;
 * // ABC is { a: string | boolean; b?: number | undefined; c?: string | undefined; }
 */
export type IntersectUnion<T> = never; // TODO: implement this!

