/**
 * Pure rules of grading rubrics: group paths, exact scores, review and keys.
 *
 * Nothing here reads the database. Scores are rational numbers kept as
 * `bigint` fractions, so a third stays a third and a sum of decimals carries
 * no float noise.
 */

/// An exact fraction with a positive denominator.
interface Rational {
	n: bigint;
	d: bigint;
}

/// A decimal or `n/d` number, either form signed.
const NUMBER_RE = /^(-?)(\d+(?:\.\d+)?|\d+\/\d+)$/;

/// A key of the generated `i<n>` form.
const GENERATED_KEY_RE = /^i(\d+)$/;

function gcd(a: bigint, b: bigint): bigint {
	let x = a < 0n ? -a : a;
	let y = b < 0n ? -b : b;
	while (y !== 0n) [x, y] = [y, x % y];
	return x;
}

/// The reduced fraction `n/d`, with `d > 0`.
function rational(n: bigint, d: bigint): Rational {
	const divisor = gcd(n, d) || 1n;
	const sign = d < 0n ? -1n : 1n;
	return { n: (sign * n) / divisor, d: (sign * d) / divisor };
}

function add(a: Rational, b: Rational): Rational {
	return rational(a.n * b.d + b.n * a.d, a.d * b.d);
}

/// Reads a decimal or `n/d` text, or `null` when it is neither or divides by zero.
function parseRational(text: string): Rational | null {
	const match = NUMBER_RE.exec(text.trim());
	if (!match) return null;
	const negative = match[1] === "-";
	const body = match[2] as string;

	let value: Rational;
	const slashAt = body.indexOf("/");
	if (slashAt >= 0) {
		const d = BigInt(body.slice(slashAt + 1));
		if (d === 0n) return null;
		value = rational(BigInt(body.slice(0, slashAt)), d);
	} else {
		const dot = body.indexOf(".");
		if (dot < 0) {
			value = { n: BigInt(body), d: 1n };
		} else {
			const decimals = body.length - dot - 1;
			value = rational(
				BigInt(body.slice(0, dot) + body.slice(dot + 1)),
				10n ** BigInt(decimals),
			);
		}
	}
	return negative ? { n: -value.n, d: value.d } : value;
}

/// The text of a fraction in `[0, 1]`: a decimal when it terminates, else a reduced `n/d`.
function formatUnit({ n, d }: Rational): string {
	if (n <= 0n) return "0";
	if (n >= d) return "1";

	let twos = 0n;
	let fives = 0n;
	let rest = d;
	while (rest % 2n === 0n) {
		rest /= 2n;
		twos++;
	}
	while (rest % 5n === 0n) {
		rest /= 5n;
		fives++;
	}
	if (rest !== 1n) return `${n}/${d}`;

	const places = Number(twos > fives ? twos : fives);
	const digits = ((n * 10n ** BigInt(places)) / d)
		.toString()
		.padStart(places + 1, "0");
	const whole = digits.slice(0, digits.length - places);
	return `${whole}.${digits.slice(digits.length - places)}`;
}

/**
 * Splits a group path on `/` into trimmed segments, or `null` when a segment
 * is empty or holds a `:`.
 */
export function parseGroupPath(text: string): string[] | null {
	const segments = text.split("/").map((segment) => segment.trim());
	if (segments.some((segment) => segment === "" || segment.includes(":"))) {
		return null;
	}
	return segments;
}

/** The stored form of a group path: its segments joined by `/`. */
export function joinGroupPath(segments: string[]): string {
	return segments.join("/");
}

/** The first segment of a stored group path, or `null` for an ungrouped item. */
export function topLevelGroup(group: string | null): string | null {
	if (group === null) return null;
	return group.split("/")[0] ?? null;
}

/**
 * The top-level groups in the order of their first item by `position`.
 *
 * The order of the array is irrelevant, and ungrouped items add nothing.
 */
export function groupOrder(
	items: { group: string | null; position: number }[],
): string[] {
	const order: string[] = [];
	for (const item of [...items].sort((a, b) => a.position - b.position)) {
		const top = topLevelGroup(item.group);
		if (top !== null && !order.includes(top)) order.push(top);
	}
	return order;
}

/** The first top-level group applied more than once, with the keys that apply it, or `null`. */
export function findGroupConflict(
	items: { key: string; group: string | null }[],
): { group: string; keys: string[] } | null {
	const byGroup = new Map<string, string[]>();
	for (const item of items) {
		const top = topLevelGroup(item.group);
		if (top === null) continue;
		const keys = byGroup.get(top);
		if (keys) keys.push(item.key);
		else byGroup.set(top, [item.key]);
	}
	for (const [group, keys] of byGroup) {
		if (keys.length > 1) return { group, keys };
	}
	return null;
}

/**
 * The score of a pass: `min(1, max(0, base + sum of values + adjustment))`.
 *
 * Exact in rational arithmetic and clamped only at the end. The result is a
 * decimal when the reduced denominator has only factors 2 and 5, and a
 * reduced `n/d` otherwise.
 *
 * @throws {Error} If a number is neither a decimal nor an `n/d` fraction.
 */
export function rubricScore(input: {
	base: string;
	items: { value: string; retiredAt?: Date | null }[];
	adjustment?: string | null;
}): string {
	const terms = [
		input.base,
		...input.items.map((item) => item.value),
		...(input.adjustment ? [input.adjustment] : []),
	];
	let total: Rational = { n: 0n, d: 1n };
	for (const term of terms) {
		const value = parseRational(term);
		if (value === null) throw new Error(`not a number: ${term}`);
		total = add(total, value);
	}
	return formatUnit(total);
}

/** Whether `text` is a decimal or `n/d` number with a value in `[min, max]`, both whole numbers. */
export function isNumberInRange(
	text: string,
	min: number,
	max: number,
): boolean {
	const value = parseRational(text);
	if (value === null) return false;
	return value.n >= BigInt(min) * value.d && value.n <= BigInt(max) * value.d;
}

/** Whether any applied item is retired, which marks the pass for review. */
export function needsReview(applied: { retiredAt: Date | null }[]): boolean {
	return applied.some((item) => item.retiredAt !== null);
}

/** The key `i<n+1>` for the highest `i<n>` among `keys`, or `i1` when there is none. */
export function nextItemKey(keys: string[]): string {
	let highest = 0;
	for (const key of keys) {
		const match = GENERATED_KEY_RE.exec(key);
		if (match) highest = Math.max(highest, Number(match[1]));
	}
	return `i${highest + 1}`;
}

/// An item of a question's initial rubric.
export interface InitialItem {
	key: string;
	group: string | null;
	text: string;
	value: string;
	comment: string | null;
	feedback: string | null;
}

/**
 * Reads the initial rubric of a question (`privatePayload.rubric`).
 *
 * The key of an entry is its `id`, else its 1-based position. A value that is
 * not a list, and every entry that is not usable, is skipped with a warning
 * message; nothing throws.
 */
export function parseInitialRubric(raw: unknown): {
	items: InitialItem[];
	warnings: string[];
} {
	if (raw === undefined) return { items: [], warnings: [] };
	if (!Array.isArray(raw)) {
		return { items: [], warnings: ["the rubric is not a list"] };
	}

	const items: InitialItem[] = [];
	const warnings: string[] = [];
	const seen = new Set<string>();
	for (const [index, entry] of raw.entries()) {
		const position = index + 1;
		const item = readEntry(entry, position);
		if (typeof item === "string")
			warnings.push(`rubric entry ${position}: ${item}`);
		else if (seen.has(item.key)) {
			warnings.push(`rubric entry ${position}: repeated key "${item.key}"`);
		} else {
			seen.add(item.key);
			items.push(item);
		}
	}
	return { items, warnings };
}

/// The item an initial rubric entry describes, or the reason it is unusable.
function readEntry(entry: unknown, position: number): InitialItem | string {
	if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
		return "not an object";
	}
	const fields = entry as Record<string, unknown>;
	if (typeof fields.text !== "string") return "missing text";
	if (typeof fields.value !== "string") return "missing value";
	if (!isNumberInRange(fields.value, -1, 1)) return "value out of range";

	let group: string | null = null;
	if (fields.path !== undefined && fields.path !== null) {
		const segments =
			typeof fields.path === "string" ? parseGroupPath(fields.path) : null;
		if (segments === null) return "bad path";
		group = joinGroupPath(segments);
	}

	const key =
		typeof fields.id === "string" && fields.id.trim() !== ""
			? fields.id.trim()
			: String(position);
	return {
		key,
		group,
		text: fields.text,
		value: fields.value,
		comment: typeof fields.comment === "string" ? fields.comment : null,
		feedback: typeof fields.feedback === "string" ? fields.feedback : null,
	};
}
