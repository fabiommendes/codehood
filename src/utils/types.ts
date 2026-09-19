/** Type-level utilities with no runtime counterpart. */

/**
 * `true` when `A` and `B` are mutually assignable, and `never` otherwise.
 *
 * Used as `true satisfies AssertEqual<X, Y>` to pin a schema's inferred type
 * to a hand-written one, so the two fail to compile when they drift apart.
 */
export type AssertEqual<A, B> = [A] extends [B]
	? [B] extends [A]
		? true
		: never
	: never;
