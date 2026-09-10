/**
 * Type-level string manipulation
 */

/**
 * Split a string literal into a tuple of substrings, using `Delim` as separator.
 *
 * Example:
 * ```ts
 * type Parts = Split<"a.b.c", ".">; // ["a", "b", "c"]
 * ```
 */
export type Split<S extends string, Delim extends string> = Delim extends ""
	? [S]
	: S extends `${infer Head}${Delim}${infer Tail}`
		? [Head, ...Split<Tail, Delim>]
		: [S];

/**
 * Join a tuple of strings into a single string literal, using `Delim` as separator.
 *
 * Example:
 * ```ts
 * type Joined = Join<["a", "b", "c"], ".">; // "a.b.c"
 * ```
 */
export type Join<
	Parts extends readonly string[],
	Delim extends string,
> = Parts extends readonly [
	infer Head extends string,
	...infer Tail extends string[],
]
	? Tail extends []
		? Head
		: `${Head}${Delim}${Join<Tail, Delim>}`
	: "";

/**
 * True if `S` starts with `Prefix`.
 */
export type StartsWith<
	S extends string,
	Prefix extends string,
> = S extends `${Prefix}${string}` ? true : false;

/**
 * True if `S` ends with `Suffix`.
 */
export type EndsWith<
	S extends string,
	Suffix extends string,
> = S extends `${string}${Suffix}` ? true : false;

/**
 * True if `S` contains `Sub` anywhere.
 */
export type Includes<
	S extends string,
	Sub extends string,
> = S extends `${string}${Sub}${string}` ? true : false;

/**
 * Replace the first occurrence of `From` in `S` with `To`.
 */
export type Replace<
	S extends string,
	From extends string,
	To extends string,
> = From extends ""
	? S
	: S extends `${infer Head}${From}${infer Tail}`
		? `${Head}${To}${Tail}`
		: S;

/**
 * Replace all occurrences of `From` in `S` with `To`.
 */
export type ReplaceAll<
	S extends string,
	From extends string,
	To extends string,
> = From extends ""
	? S
	: S extends `${infer Head}${From}${infer Tail}`
		? `${Head}${To}${ReplaceAll<Tail, From, To>}`
		: S;

type LowerAlphaNumChar =
	| "0"
	| "1"
	| "2"
	| "3"
	| "4"
	| "5"
	| "6"
	| "7"
	| "8"
	| "9"
	| "a"
	| "b"
	| "c"
	| "d"
	| "e"
	| "f"
	| "g"
	| "h"
	| "i"
	| "j"
	| "k"
	| "l"
	| "m"
	| "n"
	| "o"
	| "p"
	| "q"
	| "r"
	| "s"
	| "t"
	| "u"
	| "v"
	| "w"
	| "x"
	| "y"
	| "z";

type IsAlphaNum<S extends string> = S extends `${infer Head}${infer Tail}`
	? Head extends LowerAlphaNumChar
		? Tail extends ""
			? true
			: IsAlphaNum<Tail>
		: false
	: false;

type IsSlugSegments<Parts extends readonly string[]> = Parts extends readonly [
	infer Head extends string,
	...infer Tail extends string[],
]
	? IsAlphaNum<Head> extends true
		? IsSlugSegments<Tail>
		: false
	: true;

/**
 * True if `S` is a valid slug: lowercase letters and digits, with single hyphens
 * separating non-empty segments (no leading, trailing, or double hyphens).
 *
 * Example:
 * ```ts
 * type A = IsSlug<"hello-world">;  // true
 * type B = IsSlug<"Hello-World">;  // false (uppercase)
 * type C = IsSlug<"-hello">;       // false (leading hyphen)
 * type D = IsSlug<"hello--world">; // false (double hyphen)
 * ```
 */
export type IsSlug<S extends string> = S extends ""
	? false
	: IsSlugSegments<Split<S, "-">>;

/**
 * True if `S` is an Astro dynamic route param: a slug wrapped in square brackets.
 *
 * Example:
 * ```ts
 * type A = IsParam<"[discipline]">; // true
 * type B = IsParam<"discipline">;   // false
 * type C = IsParam<"[Discipline]">; // false (bracket contents must be a slug)
 * ```
 */
export type IsParam<S extends string> = S extends `[${infer Name}]`
	? IsSlug<Name>
	: false;

/**
 * Extract the slug name out of an Astro dynamic route param. Resolves to `never`
 * if `S` is not a valid param.
 *
 * Example:
 * ```ts
 * type A = ParamToSlug<"[discipline]">; // "discipline"
 * type B = ParamToSlug<"discipline">;   // never
 * ```
 */
export type ParamToSlug<S extends string> = S extends `[${infer Name}]`
	? IsSlug<Name> extends true
		? Name
		: never
	: never;

/**
 * Extract the union of param names out of an Astro route path (segments
 * wrapped in square brackets). Non-param segments are ignored.
 *
 * Example:
 * ```ts
 * type A = ExtractParams<"/foo/[id]/bar/[slug]/">; // "id" | "slug"
 * type B = ExtractParams<"/foo/bar">;               // never
 * ```
 */
export type ExtractParams<S extends string> = ParamToSlug<
	Split<S, "/">[number]
>;
