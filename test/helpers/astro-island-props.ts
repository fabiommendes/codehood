/**
 * Decodes an `<astro-island>` element's `props` attribute.
 *
 * Astro serializes hydrated-island props with its own scheme
 * (`astro/dist/runtime/server/serialize.js`'s `serializeProps`), not plain
 * JSON: every value is wrapped as a `[type, value]` tuple so the client can
 * revive `Date`s, `Map`s, etc. This mirrors that scheme's decode side (the
 * inline script `astro/dist/runtime/server/astro-island.prebuilt.js`
 * installs in the browser) so a test can read the same props the browser
 * would hydrate a component with.
 */

const PROP_TYPE = {
	Value: 0,
	Array: 1,
	RegExp: 2,
	Date: 3,
	Map: 4,
	Set: 5,
	BigInt: 6,
	URL: 7,
} as const;

function decodeTuple(tuple: unknown): unknown {
	if (!Array.isArray(tuple)) return undefined;
	const [type, raw] = tuple as [number, unknown];
	switch (type) {
		case PROP_TYPE.Value:
			if (raw === undefined) return undefined;
			if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
				return decodeObject(raw as Record<string, unknown>);
			}
			return raw;
		case PROP_TYPE.Array:
			return (raw as unknown[]).map(decodeTuple);
		case PROP_TYPE.Map:
			return new Map(
				(raw as unknown[]).map(decodeTuple) as [unknown, unknown][],
			);
		case PROP_TYPE.Set:
			return new Set((raw as unknown[]).map(decodeTuple));
		case PROP_TYPE.Date:
			return new Date(raw as string);
		case PROP_TYPE.RegExp:
			return new RegExp(raw as string);
		case PROP_TYPE.BigInt:
			return BigInt(raw as string);
		case PROP_TYPE.URL:
			return new URL(raw as string);
		default:
			return raw;
	}
}

function decodeObject(obj: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(obj).map(([key, tuple]) => [key, decodeTuple(tuple)]),
	);
}

/**
 * Decodes an `astro-island` `props` attribute's raw string into the plain
 * object it serializes.
 *
 * @example
 * ```ts
 * const raw = await island.getAttribute("props");
 * const props = decodeIslandProps(raw ?? "{}");
 * ```
 */
export function decodeIslandProps(propsAttr: string): Record<string, unknown> {
	return decodeObject(JSON.parse(propsAttr));
}
