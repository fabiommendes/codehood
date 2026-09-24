/**
 * Column-header sort state shared by `Table`'s callers: the URL scheme
 * (`?sort=<field>&dir=asc|desc`, default omitted), the click-to-toggle
 * behavior, and comparators for the two shapes that keep coming up —
 * comparing by a displayed label, and comparing a possibly-missing value with
 * "missing sorts last regardless of direction".
 */

export type SortDirection = "asc" | "desc";

export interface SortState<Field extends string> {
	field: Field;
	direction: SortDirection;
}

/**
 * Reads `sort`/`dir` off `params`, falling back to `defaultSort` when `sort`
 * is missing or not one of `fields`. A recognized `sort` with a missing or
 * unrecognized `dir` defaults to ascending — the natural reading of "sort by
 * this column" absent any other signal.
 */
export function sortStateFromParams<Field extends string>(
	params: URLSearchParams,
	fields: readonly Field[],
	defaultSort: SortState<Field>,
): SortState<Field> {
	const field = params.get("sort");
	if (!field || !(fields as readonly string[]).includes(field)) {
		return defaultSort;
	}
	const direction: SortDirection =
		params.get("dir") === "desc" ? "desc" : "asc";
	return { field: field as Field, direction };
}

/** Sets `sort`/`dir` on `params`, unless `state` is `defaultSort` — the default stays out of the URL. */
export function applySortToParams<Field extends string>(
	params: URLSearchParams,
	state: SortState<Field>,
	defaultSort: SortState<Field>,
): void {
	if (
		state.field === defaultSort.field &&
		state.direction === defaultSort.direction
	) {
		return;
	}
	params.set("sort", state.field);
	params.set("dir", state.direction);
}

/**
 * Clicking the active column's header flips its direction; clicking a
 * different column switches to it, ascending.
 */
export function toggleSortState<Field extends string>(
	current: SortState<Field>,
	field: Field,
): SortState<Field> {
	return current.field === field
		? { field, direction: current.direction === "asc" ? "desc" : "asc" }
		: { field, direction: "asc" };
}

/**
 * Compares two values that may be missing, treating a missing value as
 * always sorting last — in both directions — and otherwise delegating to
 * `compare` and flipping it for `"desc"`.
 */
export function compareNullsLast<T>(
	a: T | null | undefined,
	b: T | null | undefined,
	direction: SortDirection,
	compare: (a: T, b: T) => number,
): number {
	const aMissing = a === null || a === undefined;
	const bMissing = b === null || b === undefined;
	if (aMissing && bMissing) return 0;
	if (aMissing) return 1;
	if (bMissing) return -1;
	const cmp = compare(a, b);
	return direction === "asc" ? cmp : -cmp;
}
