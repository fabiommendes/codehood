/** Folds text for searching: lower case, with accents and other marks removed. */
export function foldSearch(text: string): string {
	return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Keeps the rows whose text holds every word of `query`, in any order and
 * ignoring case and accents; a blank query keeps them all.
 *
 * @example
 * filterRows(students, "joao silva", (s) => `${s.name} ${s.email}`);
 */
export function filterRows<T>(
	rows: readonly T[],
	query: string,
	text: (row: T) => string,
): T[] {
	const words = foldSearch(query).split(/\s+/).filter(Boolean);
	if (words.length === 0) return [...rows];
	return rows.filter((row) => {
		const haystack = foldSearch(text(row));
		return words.every((word) => haystack.includes(word));
	});
}
