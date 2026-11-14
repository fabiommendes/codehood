/// The page size of a table paginated in the browser, when the caller sets none.
export const DEFAULT_PAGE_SIZE = 50;

/// One slot of a page selector: a page number, or a gap standing for the pages it skips.
export type PageSlot = number | "gap";

/** Counts the pages needed to show `total` rows, `pageSize` at a time; an empty table still has one page. */
export function pageCount(total: number, pageSize: number): number {
	return Math.max(1, Math.ceil(total / pageSize));
}

/** Clamps `page` (1-based) into the pages that exist, so a table that shrank lands on its last page. */
export function clampPage(page: number, pages: number): number {
	return Math.min(Math.max(1, Math.trunc(page)), pages);
}

/**
 * Returns the 1-based range of rows shown on `page`, for "21–40 of 230".
 *
 * @example
 * pageRange(2, 20, 230); // { from: 21, to: 40 }
 * pageRange(1, 20, 0);   // { from: 0, to: 0 }
 */
export function pageRange(
	page: number,
	pageSize: number,
	total: number,
): { from: number; to: number } {
	if (total === 0) return { from: 0, to: 0 };
	const from = (page - 1) * pageSize + 1;
	return { from, to: Math.min(page * pageSize, total) };
}

/**
 * Lists the slots of a page selector: the first and last pages, the current
 * one and its neighbours, and a gap wherever pages are skipped.
 *
 * A gap never stands for a single page: that page is shown instead, so the
 * selector keeps the same width while the current page moves.
 *
 * @example
 * pageSlots(5, 20); // [1, "gap", 4, 5, 6, "gap", 20]
 * pageSlots(2, 5);  // [1, 2, 3, 4, 5]
 */
export function pageSlots(page: number, pages: number): PageSlot[] {
	const shown = new Set([1, pages, page - 1, page, page + 1]);
	// Near an end, widen the window so the number of slots stays constant.
	if (page <= 4) for (let p = 2; p <= 5; p++) shown.add(p);
	if (page >= pages - 3) for (let p = pages - 4; p < pages; p++) shown.add(p);
	const sorted = [...shown]
		.filter((p) => p >= 1 && p <= pages)
		.sort((a, b) => a - b);
	const slots: PageSlot[] = [];
	for (const p of sorted) {
		const previous = slots.at(-1);
		if (typeof previous === "number" && p - previous === 2) {
			slots.push(previous + 1);
		} else if (typeof previous === "number" && p - previous > 2) {
			slots.push("gap");
		}
		slots.push(p);
	}
	return slots;
}
