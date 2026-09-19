/**
 * Type-level machinery behind the permission table in `permissions.ts`.
 *
 * Turns a table of `"a | b"` keyed permission definitions into per-permission
 * signatures, so `hasPerm` knows each permission's target type and whether the
 * target is required for a given actor.
 */

// biome-ignore-all lint/suspicious/noExplicitAny: `PermDef<any>` is how these types accept a definition of any target type.

import type { Actor, SYSTEM, UserActor } from "@/auth/actor";
import type { Pretty } from "@/typing";
import type { JSONValue } from "@/typing/concrete-types";

export type PermDef<T> = {
	system?: ((target: T) => boolean) | boolean;
	admin?: ((actor: UserActor, target: T) => boolean) | boolean;
	instructor?: ((actor: UserActor, target: T) => boolean) | boolean;
	student?: ((actor: UserActor, target: T) => boolean) | boolean;
	other?: ((actor: UserActor, target: T) => boolean) | boolean;
	/// Reduces the target to the fields worth recording when the check is audited or fails.
	audit?: (target: T) => JSONValue;
};

export type PermDefExpanded<T> = {
	system: ((target: T) => boolean) | boolean;
	admin: ((actor: UserActor, target: T) => boolean) | boolean;
	instructor: ((actor: UserActor, target: T) => boolean) | boolean;
	student: ((actor: UserActor, target: T) => boolean) | boolean;
};

export type ExpandPermDefs<T extends { [key: string]: PermDef<any> }> = {
	[K in keyof T]: Pretty<PermDefExpansion<T[K]>>;
};

type PermDefExpansion<T extends PermDef<any>> = {
	system: T extends { system: infer V } ? V : true;
	admin: RoleValue<T, "admin">;
	instructor: RoleValue<T, "instructor">;
	student: RoleValue<T, "student">;
};

/// Value of `Role` in a permission definition, falling back to `other`, then `false`.
type RoleValue<T, Role extends string> = T extends { [K in Role]: infer V }
	? V
	: T extends { other: infer V }
		? V
		: false;

type AnyFn = (...args: any[]) => unknown;

/// `true` if any member of `T` is a check function, i.e. the check needs a target.
type HasFn<T> = [Extract<T, AnyFn>] extends [never] ? false : true;

/// Target type taken from the check functions of a definition, `never` if all are booleans.
type TargetOf<Def> = Def extends { system: (target: infer T) => boolean }
	? T
	: Def[Exclude<keyof Def, "system" | "audit">] extends infer V
		? V extends (actor: UserActor, target: infer T) => boolean
			? T
			: never
		: never;

/// Trailing `on` argument: absent without a target, required if some check needs it.
type OnArgs<Target, Required> = [Target] extends [never]
	? []
	: Required extends true
		? [on: Target]
		: [on?: Target];

/// Checks of `Def` that may run for actor `A`: only `system` for SYSTEM, only roles for users, all for `Actor`.
type ChecksFor<A, Def extends PermDef<any>> = A extends typeof SYSTEM
	? PermDefExpansion<Def>["system"]
	: typeof SYSTEM extends A
		? PermDefExpansion<Def>[keyof PermDefExpanded<any>]
		: PermDefExpansion<Def>["admin" | "instructor" | "student"];

/// Signature of a permission check where `perm` picks the type and optionality of `on`.
///
/// When `P` is every key, `perm` was either invalid (inference fell back to the
/// constraint) or a variable of the full key union. `on` is optional then, so
/// the arity check passes and TypeScript reports the invalid `perm` instead.
export type PermOverloads<Defs, R> = <A extends Actor, P extends keyof Defs>(
	actor: A,
	perm: P,
	...on: [keyof Defs] extends [P]
		? [on?: TargetOf<Defs[P]>]
		: OnArgs<TargetOf<Defs[P]>, HasFn<ChecksFor<A, Defs[P] & PermDef<any>>>>
) => R;

/// Signature of `simplifyTarget`: the target is required exactly when `perm` takes one.
export type TargetSimplifier<Defs> = <P extends keyof Defs>(
	perm: P,
	...target: [TargetOf<Defs[P]>] extends [never]
		? []
		: [target: TargetOf<Defs[P]>]
) => JSONValue | undefined;

/// Keys of `Defs` that take a target but have no `audit` to reduce it.
export type MissingAudit<Defs> = {
	[K in keyof Defs]: [TargetOf<Defs[K]>] extends [never]
		? never
		: Defs[K] extends { audit: AnyFn }
			? never
			: K;
}[keyof Defs];

/// Splits `"a | b | c"` into the union `"a" | "b" | "c"`.
type SplitKeys<S extends string> = S extends `${infer Head} | ${infer Tail}`
	? Head | SplitKeys<Tail>
	: S;

/// Expands `{ "a | b": V }` into `{ a: V; b: V }`, keeping single keys as-is.
export type ExpandKeys<T> = {
	[K in keyof T as K extends string ? SplitKeys<K> : K]: T[K];
};

/// Sub-keys of `T` that appear in more than one of its `"a | b"` keys.
export type DuplicateKeys<T> = {
	[K in keyof T & string]: SplitKeys<K> &
		SplitKeys<Exclude<keyof T & string, K>>;
}[keyof T & string];
