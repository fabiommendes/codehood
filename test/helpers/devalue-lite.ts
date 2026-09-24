/**
 * Decodes the wire format Astro Actions serialize a successful RPC result in.
 *
 * `POST /_actions/<name>` returns its body as `devalue`-stringified JSON
 * (`content-type: application/json+devalue`, see
 * `astro/dist/actions/runtime/server.js`'s `serializeActionResult`), not
 * plain JSON — `devalue` flattens the payload into an array of parts so it
 * can express cycles and non-JSON types (`Date`, `Map`, ...). `devalue`
 * itself isn't a project dependency (only `astro` pulls it in transitively),
 * so this is a minimal, test-only reimplementation of its `unflatten`
 * algorithm, covering exactly the shapes these action results can carry:
 * primitives, plain objects, arrays, and `Date`. Anything more exotic
 * (`RegExp`, `Map`, typed arrays, ...) is left as its raw tagged tuple rather
 * than rejected — irrelevant here, since the scanner these results feed only
 * cares about plain-object key names.
 */

const UNDEFINED = -1;
const NAN = -3;
const POSITIVE_INFINITY = -4;
const NEGATIVE_INFINITY = -5;
const NEGATIVE_ZERO = -6;

function isSentinel(index: number): boolean {
	return (
		index === UNDEFINED ||
		index === NAN ||
		index === POSITIVE_INFINITY ||
		index === NEGATIVE_INFINITY ||
		index === NEGATIVE_ZERO
	);
}

function fromSentinel(index: number): unknown {
	switch (index) {
		case UNDEFINED:
			return undefined;
		case NAN:
			return Number.NaN;
		case POSITIVE_INFINITY:
			return Number.POSITIVE_INFINITY;
		case NEGATIVE_INFINITY:
			return Number.NEGATIVE_INFINITY;
		case NEGATIVE_ZERO:
			return -0;
		default:
			throw new Error(`Not a devalue sentinel index: ${index}`);
	}
}

/// Revives the flat array `devalue.stringify` produces (`JSON.parse`d, not
/// yet unflattened) back into the value it represents.
function unflatten(parsed: unknown): unknown {
	if (typeof parsed === "number") return fromSentinel(parsed);
	if (!Array.isArray(parsed) || parsed.length === 0) {
		throw new Error("Invalid devalue payload");
	}
	const values = parsed;
	const hydrated: unknown[] = [];

	function hydrate(index: number): unknown {
		if (isSentinel(index)) return fromSentinel(index);
		if (index in hydrated) return hydrated[index];

		const value = values[index];

		if (!value || typeof value !== "object") {
			hydrated[index] = value;
		} else if (Array.isArray(value)) {
			if (typeof value[0] === "string") {
				switch (value[0]) {
					case "Date":
						hydrated[index] = new Date(value[1] as string);
						break;
					case "Set": {
						const set = new Set<unknown>();
						hydrated[index] = set;
						for (let i = 1; i < value.length; i++) set.add(hydrate(value[i]));
						break;
					}
					case "Map": {
						const map = new Map<unknown, unknown>();
						hydrated[index] = map;
						for (let i = 1; i < value.length; i += 2) {
							map.set(hydrate(value[i]), hydrate(value[i + 1]));
						}
						break;
					}
					case "BigInt":
						hydrated[index] = BigInt(value[1] as string);
						break;
					default:
						// Exotic type this reimplementation doesn't cover — kept as
						// its raw tagged tuple rather than decoded.
						hydrated[index] = value;
				}
			} else {
				const array: unknown[] = [];
				hydrated[index] = array;
				value.forEach((n, i) => {
					if (typeof n === "number") array[i] = hydrate(n);
				});
			}
		} else {
			const object: Record<string, unknown> = {};
			hydrated[index] = object;
			for (const [key, ref] of Object.entries(value)) {
				object[key] = hydrate(ref as number);
			}
		}

		return hydrated[index];
	}

	return hydrate(0);
}

/** Revives a `devalue`-stringified action result body into a plain value. */
export function parseDevalue(serialized: string): unknown {
	return unflatten(JSON.parse(serialized));
}
