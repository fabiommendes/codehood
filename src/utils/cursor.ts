/**
 * Cursors of paginated lists: the key of the last row of a page, as the opaque
 * text a client sends back to ask for the next one.
 *
 * A numeric id is masked by an affine map modulo 2^64, a bijection that hides
 * the row count from a casual reader. It is not a secret: a leaked id is harmless.
 */
import { z } from "zod";
import { InvalidData } from "@/core/error";

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
export function decodeCursor(cursor: string): number {
	if (/^[0-9a-z]{1,13}$/.test(cursor)) {
		let masked = 0n;
		for (const digit of cursor)
			masked = masked * 36n + BigInt(Number.parseInt(digit, 36));
		if (masked < MODULUS) {
			const id = (((masked - INCREMENT) & MASK) * INVERSE) & MASK;
			if (id <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(id);
		}
	}
	throw invalidCursor();
}

/** The error a list answers to an `after` it cannot read. */
export function invalidCursor(): InvalidData {
	return InvalidData.fromZodError(
		new z.ZodError([
			{ code: "custom", path: ["after"], message: "Invalid cursor" },
		]),
	);
}

/**
 * Cuts `rows`, read one past the page size, into a page and the cursor of the next.
 *
 * @example
 * const rows = await tx.thing.findMany({ take: limit + 1, orderBy: { id: "asc" } });
 * const { page, next } = cutPage(rows, limit, (row) => encodeCursor(row.id));
 */
export function cutPage<Row>(
	rows: Row[],
	limit: number,
	cursorOf: (last: Row) => string,
): { page: Row[]; next: string | null } {
	if (rows.length <= limit) return { page: rows, next: null };
	const page = rows.slice(0, limit);
	return { page, next: cursorOf(page[page.length - 1] as Row) };
}
