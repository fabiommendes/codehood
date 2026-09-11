/**
 * Types and utilities to work with branded types
 */

type WithField<F extends string> = Record<F, unknown>;

export type BrandField<
	Brand,
	F extends string,
	T extends WithField<F>,
> = Brand extends T[F] ? { [K in keyof T]: K extends F ? Brand : T[K] } : never;

export type Brand<B, T extends WithField<"id">> = BrandField<B, "id", T>;

export type BrandIdAtField<
	B,
	Path extends string,
	T extends Record<Path, WithField<"id">>,
> = { [K in keyof T]: K extends Path ? Brand<B, T[K]> : T[K] };

/**
 * Brand a value.
 *
 * This is a type-transformation function and a NO-OP in the runtime.
 *
 * WARNING: This function is design to violate the type safety and introduce
 * brands to objects ids. This is necessary to brand values comming from the
 * database, since Prisma do not use branded ids.
 *
 * DO NOT USE OUTSIDE A PRISMA QUERY CONTEXT!
 */
export function unsafeBrand<B, Id = number | string>(
	id: Id,
): B extends Id ? B : never {
	return id as unknown as B extends Id ? B : never;
}

/**
 * Brand the "id" field with the given brand Id.
 *
 * This is a type-transformation function and a NO-OP in the runtime.
 *
 * WARNING: This function is design to violate the type safety and introduce
 * brands to objects ids. This is necessary to brand values comming from the
 * database, since Prisma do not use branded ids.
 *
 * DO NOT USE OUTSIDE A PRISMA QUERY!
 */
export function unsafeBrandId<B, T extends WithField<"id">>(
	obj: T,
): Brand<B, T> {
	return obj as unknown as Brand<B, T>;
}

/**
 * Like {@link unsafeBrandId}, but brands a type inside another field.
 *
 * WARNING: The same safety rules as unsafeBrandId apply here.
 */
export function unsafeBrandIdAtField<
	Brand,
	Path extends string,
	T extends Record<Path, WithField<"id">>,
>(obj: T): BrandIdAtField<Brand, Path, T> {
	return obj as unknown as BrandIdAtField<Brand, Path, T>;
}
