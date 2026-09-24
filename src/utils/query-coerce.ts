import type { ZodType } from "zod";

/**
 * A raw value as read off a query string or a dynamic route segment: always
 * string(s), never the richer type the target schema actually wants.
 */
type RawValue = string | string[];

// biome-ignore-start lint/suspicious/noExplicitAny: zod v4 exposes the runtime shape of a schema through `_def.type`/`_def.shape`/etc, which its public types don't model.
type AnyDef = any;

/** Unwraps `optional`/`nullable`/`default`/`readonly` wrappers to the schema they carry. */
function unwrap(schema: ZodType): AnyDef {
	let s = schema as AnyDef;
	while (
		s._def.type === "optional" ||
		s._def.type === "nullable" ||
		s._def.type === "default" ||
		s._def.type === "readonly"
	) {
		s = s._def.innerType;
	}
	return s;
}

/**
 * Maps every field name a query object could carry to the schema that field
 * should be coerced against. Object schemas contribute their own shape;
 * unions (e.g. a primary-key schema that accepts `{ id }` or `{ ref }`)
 * contribute the merged shape of every branch, since we coerce before we
 * know which branch will end up matching.
 */
function fieldShapeMap(schema: ZodType): Record<string, ZodType> {
	const s = unwrap(schema);
	if (s._def.type === "object") return s.shape;
	if (s._def.type === "union") {
		const merged: Record<string, ZodType> = {};
		for (const option of s._def.options) {
			Object.assign(merged, fieldShapeMap(option));
		}
		return merged;
	}
	return {};
}

/** Coerces one string to the scalar type `schema` declares, leaving it as a string when the type isn't one we coerce (string, enum, literal, ...) or the value doesn't parse. */
function coerceScalar(schema: ZodType, value: string): unknown {
	const s = unwrap(schema);
	switch (s._def.type) {
		case "number": {
			const n = Number(value);
			return Number.isNaN(n) ? value : n;
		}
		case "boolean":
			// Exact string match only: `Boolean("false")` is `true`, which would
			// silently flip a `?flag=false` into "flag on".
			if (value === "true") return true;
			if (value === "false") return false;
			return value;
		case "date": {
			const d = new Date(value);
			return Number.isNaN(d.getTime()) ? value : d;
		}
		default:
			return value;
	}
}

/** Coerces one field's raw value(s), turning them into an array when `schema` declares an array field regardless of how many raw values arrived. */
function coerceField(schema: ZodType, raw: RawValue): unknown {
	const s = unwrap(schema);
	if (s._def.type === "array") {
		const values = Array.isArray(raw) ? raw : [raw];
		return values.map((v) => coerceScalar(s._def.element, v));
	}
	// A field that isn't declared as an array but received a repeated key: the
	// last value wins, the same way a repeated `application/x-www-form-urlencoded`
	// field would.
	// biome-ignore lint/style/noNonNullAssertion: every RawValue array reaching this function comes from collectSearchParams, which never produces an empty one.
	const value = Array.isArray(raw) ? raw[raw.length - 1]! : raw;
	return coerceScalar(s, value);
}
// biome-ignore-end lint/suspicious/noExplicitAny: see above.

/**
 * Splits a query key into its path: `"response[publicId]"` becomes
 * `["response", "publicId"]`, a key with no brackets stays a single-element
 * path. Supports arbitrary nesting (`"a[b][c]"`), though nothing in this
 * codebase currently goes deeper than one level.
 */
function parseKeyPath(key: string): [string, ...string[]] {
	const bracketAt = key.indexOf("[");
	if (bracketAt === -1) return [key];

	const base = key.slice(0, bracketAt);
	const subs = [...key.slice(bracketAt).matchAll(/\[([^[\]]*)\]/g)].map(
		(m) => m[1] ?? "",
	);
	return [base, ...subs];
}

/** Sets `path` on `target` to `value`, nesting plain objects with no coercion. */
function setRaw(
	target: Record<string, unknown>,
	path: readonly [string, ...string[]],
	value: RawValue,
): void {
	const [key, ...rest] = path;
	if (rest.length === 0) {
		target[key] = value;
		return;
	}
	target[key] ??= Object.create(null);
	// `rest` is non-empty, checked above.
	setRaw(
		target[key] as Record<string, unknown>,
		rest as [string, ...string[]],
		value,
	);
}

/**
 * Sets `path` on `target`, coercing the leaf value against whichever field
 * schema `schema` declares at each step — e.g. `["response", "publicId"]`
 * against a filter schema resolves `response`'s own object schema, then
 * `publicId` within it. A path segment `schema` does not declare falls back
 * to {@link setRaw}: there is nothing left to coerce against.
 */
function assign(
	target: Record<string, unknown>,
	schema: ZodType,
	path: readonly [string, ...string[]],
	value: RawValue,
): void {
	const [key, ...rest] = path;
	// Own keys only: a query key like `__proto__` must not resolve to an
	// inherited property.
	const shape = fieldShapeMap(schema);
	const fieldSchema = Object.hasOwn(shape, key) ? shape[key] : undefined;

	if (rest.length === 0) {
		target[key] = fieldSchema ? coerceField(fieldSchema, value) : value;
		return;
	}

	target[key] ??= Object.create(null);
	const nested = target[key] as Record<string, unknown>;
	// `rest` is non-empty, checked above.
	const restPath = rest as [string, ...string[]];
	if (fieldSchema) assign(nested, fieldSchema, restPath, value);
	else setRaw(nested, restPath, value);
}

/**
 * Coerces a flat map of raw string(s) — as read off a query string or a
 * dynamic route segment — into the types `schema` expects, using the
 * schema's own declared field types as the source of truth: numbers,
 * booleans, and dates become their real type, everything else (strings,
 * enums, ids that are branded numbers) passes through unchanged. A bracketed
 * key (`"response[publicId]"`) nests into an object the same way a JSON body
 * would carry it.
 *
 * This only prepares values that would otherwise always fail `schema`;
 * `schema.safeParse(...)` on the result is still what actually validates
 * them, exactly as it does on a JSON body.
 */
export function coerceForSchema(
	schema: ZodType,
	raw: Record<string, RawValue>,
): Record<string, unknown> {
	// Null-prototype for the same reason as `collectSearchParams`, plus one of
	// its own: `out.__proto__ = <a Date>` on a plain object would set the
	// prototype instead of adding a key.
	const out: Record<string, unknown> = Object.create(null);

	for (const [key, value] of Object.entries(raw)) {
		assign(out, schema, parseKeyPath(key), value);
	}

	return out;
}

/**
 * Reads a `URLSearchParams` into the flat raw shape {@link coerceForSchema}
 * expects. A key that repeats (`?tag=a&tag=b`) folds into a string array; a
 * key that appears once stays a plain string, present-but-empty (`?slug=`)
 * included — only a key that never appears is absent from the result.
 */
export function collectSearchParams(
	searchParams: URLSearchParams,
): Record<string, RawValue> {
	// Null-prototype: a caller controls these key names, and `key in {}` is true
	// for every `Object.prototype` member, so a `?constructor=`/`?toString=`
	// param would be silently dropped — and a dropped filter is a filter that
	// matches everything.
	const out: Record<string, RawValue> = Object.create(null);
	for (const key of searchParams.keys()) {
		if (Object.hasOwn(out, key)) continue;
		const values = searchParams.getAll(key);
		// biome-ignore lint/style/noNonNullAssertion: key came from searchParams.keys(), so getAll(key) always returns at least one value (possibly "").
		out[key] = values.length > 1 ? values : values[0]!;
	}
	return out;
}
