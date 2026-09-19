import type { ZodType } from "zod";

/**
 * The names of every `[segment]` in an Astro route pattern, in order.
 */
export function segmentNames(pattern: string): string[] {
	// biome-ignore lint/style/noNonNullAssertion: `([^\]]+)` is a mandatory capture group in a match matchAll already produced.
	return [...pattern.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]!);
}

/**
 * Rewrites an Astro route pattern (`/api/x/[id]`) as an OpenAPI one.
 */
export function toOpenApiPath(pattern: string): string {
	return pattern.replace(/\[([^\]]+)\]/g, "{$1}");
}

/**
 * True if the given Zod schema is a `ZodNever` schema.
 */
export function isZodNeverScheme(schema: ZodType<unknown>): boolean {
	// biome-ignore lint/suspicious/noExplicitAny: ZodType has no way to narrow the type to be correct in all possiblilities.
	return (schema as any)._def.typeName === "ZodNever";
}
