/**
 * Cursors of paginated lists: the key of the last row of a page, as the opaque
 * text a client sends back to ask for the next one.
 *
 * A numeric id is masked by an affine map modulo 2^64, a bijection that hides
 * the row count from a casual reader. It is not a secret: a leaked id is harmless.
 */
import { z } from "zod";
import { InvalidData } from "@/core/error";
import { PAGE_LIMIT_DEFAULT, type PageParams } from "@/core/schemas";

const MODULUS = 1n << 64n;
const MASK = MODULUS - 1n;
/// Odd, so that it has an inverse modulo 2^64.
const MULTIPLIER = 0x9e3779b97f4a7c15n;
const INCREMENT = 0x6a09e667f3bcc909n;

/// The inverse of `MULTIPLIER` modulo 2^64, by Newton's iteration.
const INVERSE = (() => {
	let x = MULTIPLIER;
	for (let i = 0; i < 6; i++) x = (x * (2n - MULTIPLIER * x)) & MASK;
	return x;
})();

/** The cursor that stands for the row `id`. */
export function encodeCursor(id: number): string {
	return ((BigInt(id) * MULTIPLIER + INCREMENT) & MASK).toString(36);
}

/**
 * The row id a cursor stands for.
 *
 * @throws {@link InvalidData} When `cursor` was not made by {@link encodeCursor}.
 */
export function decodeCursor(
	cursor: string,
	param: "after" | "before" = "after",
): number {
	if (/^[0-9a-z]{1,13}$/.test(cursor)) {
		let masked = 0n;
		for (const digit of cursor)
			masked = masked * 36n + BigInt(Number.parseInt(digit, 36));
		if (masked < MODULUS) {
			const id = (((masked - INCREMENT) & MASK) * INVERSE) & MASK;
			if (id <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(id);
		}
	}
	throw invalidCursor(param);
}

/** The error a list answers to a cursor it cannot read, sent as `param`. */
export function invalidCursor(
	param: "after" | "before" = "after",
): InvalidData {
	return InvalidData.fromZodError(
		new z.ZodError([
			{ code: "custom", path: [param], message: "Invalid cursor" },
		]),
	);
}

/// The key of a row in a list ordered by a column and then by row id: the
/// value of that column and the id that breaks its ties.
export interface PairKey {
	value: string | number;
	id: number;
}

/**
 * The cursor that stands for the row of `key` in the list ordered as `order`.
 *
 * `order` names the column and the direction of the list, so that a cursor
 * is only read back by the list that made it.
 *
 * @example
 * encodeKeyCursor("status:asc", { value: "DRAFT", id: 12 });
 */
export function encodeKeyCursor(order: string, key: PairKey): string {
	const text = JSON.stringify([order, key.value, encodeCursor(key.id)]);
	return Buffer.from(text, "utf8").toString("base64url");
}

/**
 * The key a cursor of the list ordered as `order` stands for.
 *
 * @throws {@link InvalidData} When `cursor` was not made by
 * {@link encodeKeyCursor}, or was made for another order.
 */
export function decodeKeyCursor(
	cursor: string,
	order: string,
	param: "after" | "before" = "after",
): PairKey {
	let parts: unknown;
	try {
		parts = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
	} catch {
		throw invalidCursor(param);
	}
	if (!Array.isArray(parts) || parts.length !== 3) throw invalidCursor(param);
	const [madeFor, value, id] = parts;
	if (
		madeFor !== order ||
		(typeof value !== "string" && typeof value !== "number") ||
		typeof id !== "string"
	)
		throw invalidCursor(param);
	return { value, id: decodeCursor(id, param) };
}

/// How one side of a {@link pairWhere} compares a column to the cursor.
export type PairComparison<Value> =
	| { gt: Value }
	| { lt: Value }
	| { equals: Value };

/**
 * The Prisma `where` of the rows past `key`, in a scan ordered `direction` by
 * a column and then by `id`.
 *
 * Rows that repeat the value of the cursor are told apart by their id, so a
 * page never skips or repeats one of them.
 *
 * @example
 * const direction = scanDirection("desc", seek);
 * const rows = await tx.thing.findMany({
 *   where: key ? pairWhere(key.value, key.id, direction, (status) => ({ status })) : {},
 *   orderBy: [{ status: direction }, { id: direction }],
 *   take: seek.limit + 1,
 * });
 *
 * @param column Builds the condition that compares the ordered column.
 */
export function pairWhere<Value, Where>(
	value: Value,
	id: number,
	direction: "asc" | "desc",
	column: (comparison: PairComparison<Value>) => Where,
): { OR: [Where, { AND: [Where, { id: { gt: number } | { lt: number } }] }] } {
	const past = direction === "asc" ? { gt: value } : { lt: value };
	const pastId = direction === "asc" ? { gt: id } : { lt: id };
	return {
		OR: [column(past), { AND: [column({ equals: value }), { id: pastId }] }],
	};
}

/** The direction a query scans a list ordered `direction` to read the page of `seek`. */
export function scanDirection(
	direction: "asc" | "desc",
	seek: Seek,
): "asc" | "desc" {
	if (!seek.back) return direction;
	return direction === "asc" ? "desc" : "asc";
}

/// Where a page starts: past `cursor` going forward, or behind it when `back`.
export interface Seek {
	limit: number;
	back: boolean;
	cursor: string | undefined;
}

/**
 * Reads where the page asked by `params` starts.
 *
 * A service then reads `limit + 1` rows past the cursor, in the order of the
 * list, or behind it in reverse order when `back`, and hands them to {@link cutPage}.
 *
 * @throws {@link InvalidData} When `params` has both `after` and `before`.
 */
export function seekOf(params: PageParams): Seek {
	if (params.after !== undefined && params.before !== undefined)
		throw InvalidData.fromZodError(
			new z.ZodError([
				{
					code: "custom",
					path: ["before"],
					message: "Give either `after` or `before`, not both",
				},
			]),
		);
	return {
		limit: params.limit ?? PAGE_LIMIT_DEFAULT,
		back: params.before !== undefined,
		cursor: params.before ?? params.after,
	};
}

/**
 * Cuts `rows`, read one past the page size from `seek`, into a page in list
 * order and the cursors of its neighbours.
 *
 * @example
 * const seek = seekOf(filter);
 * const rows = await tx.thing.findMany({
 *   where: seek.cursor ? { id: seek.back ? { lt: id } : { gt: id } } : {},
 *   orderBy: { id: seek.back ? "desc" : "asc" },
 *   take: seek.limit + 1,
 * });
 * const { page, next, prev } = cutPage(rows, seek, (row) => encodeCursor(row.id));
 */
export function cutPage<Row>(
	rows: Row[],
	seek: Seek,
	cursorOf: (row: Row) => string,
): { page: Row[]; next: string | null; prev: string | null } {
	const more = rows.length > seek.limit;
	const page = rows.slice(0, seek.limit);
	if (seek.back) page.reverse();
	const first = page[0];
	const last = page[page.length - 1];
	if (first === undefined || last === undefined)
		return { page, next: null, prev: null };

	// The side the page was reached from has rows: the cursor came from one.
	const cameFrom = seek.cursor !== undefined;
	return seek.back
		? {
				page,
				next: cameFrom ? cursorOf(last) : null,
				prev: more ? cursorOf(first) : null,
			}
		: {
				page,
				next: more ? cursorOf(last) : null,
				prev: cameFrom ? cursorOf(first) : null,
			};
}
