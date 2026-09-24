/**
 * Shared by every "nothing leaks a raw id or secret" guard: the REST OpenAPI
 * walk (`api-no-raw-ids.spec.ts`), the public-reference bodies
 * (`api-public-refs.spec.ts`), the hydrated-island props
 * (`islands-no-raw-ids.spec.ts`), and the Astro Action results
 * (`action-results-no-raw-ids.spec.ts`).
 */

/**
 * Exemptions the ruling on these specs' ambiguities carved out:
 *
 * - `publicId` is the rule's own stated exception.
 * - `githubId`/`schoolId` are external identity-provider ids, not raw
 *   database ids.
 */
export const EXEMPT_KEYS = new Set(["publicId", "githubId", "schoolId"]);

/// Schema-based scanners (the OpenAPI walk) see no value, only a property
/// name — `SKIP_SUBTREE_KEYS` is their only way to carve out the `question`
/// entity's MDQ document, whose choices carry author-chosen `id`s. A
/// value-based scanner doesn't need it: see {@link isRawIdValue}.
export const SKIP_SUBTREE_KEYS = new Set(["question"]);

/** `true` for `id` itself, or anything ending in `Id` — except {@link EXEMPT_KEYS}. */
export function isRawId(key: string): boolean {
	if (EXEMPT_KEYS.has(key)) return false;
	return key === "id" || /Id$/.test(key);
}

/** `true` for a key ending in `Hash` (`passwordHash`, `keyHash`, `tokenHash`, ...). */
export function isHashKey(key: string): boolean {
	return /Hash$/.test(key);
}

/**
 * `id`/`*Id` check for a scanner that sees actual values, not just a schema.
 *
 * Every raw database id in this project is a number; every MDQ-authored id
 * (a question's own `id`, a choice's `id`, ...) is a string — so `id` only
 * offends when its value is a number, and no subtree needs to be carved out
 * by property name the way {@link SKIP_SUBTREE_KEYS} does for the schema-based
 * walk. `*Id` still always offends, except {@link EXEMPT_KEYS}.
 */
export function isRawIdValue(key: string, value: unknown): boolean {
	if (EXEMPT_KEYS.has(key)) return false;
	if (key === "id") return typeof value === "number";
	return /Id$/.test(key);
}

/**
 * Every `"a.b.c"`-style path to a key `isOffender` flags, anywhere in `value`.
 *
 * Value-based — `isOffender` sees both the key and its value, and every
 * subtree is walked (no `SKIP_SUBTREE_KEYS`-style carve-out; see
 * {@link isRawIdValue} for why one isn't needed here).
 */
export function findOffendingValueKeys(
	value: unknown,
	isOffender: (key: string, value: unknown) => boolean,
	path = "",
): string[] {
	if (Array.isArray(value)) {
		return value.flatMap((item, i) =>
			findOffendingValueKeys(item, isOffender, `${path}[${i}]`),
		);
	}
	if (value && typeof value === "object") {
		return Object.entries(value as Record<string, unknown>).flatMap(
			([key, v]) => {
				const here = path ? `${path}.${key}` : key;
				const hit = isOffender(key, v) ? [here] : [];
				return [...hit, ...findOffendingValueKeys(v, isOffender, here)];
			},
		);
	}
	return [];
}

/** {@link findOffendingValueKeys} restricted to id-shaped keys — see {@link isRawIdValue}. */
export function findRawIdKeys(value: unknown, path = ""): string[] {
	return findOffendingValueKeys(value, isRawIdValue, path);
}

/** {@link findOffendingValueKeys} for id-shaped keys and any key ending in `Hash`. */
export function findRawIdOrHashKeys(value: unknown, path = ""): string[] {
	return findOffendingValueKeys(
		value,
		(key, v) => isRawIdValue(key, v) || isHashKey(key),
		path,
	);
}
