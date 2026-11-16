/// Fixtures shared by the theme pages of the component catalogue.

/**
 * Returns the current time and helpers that offset it, so a fixture is relative to the moment of the request.
 *
 * @example
 * const { minutes } = clock();
 * minutes(-25); // 25 minutes ago
 */
export function clock() {
	const now = new Date();
	return {
		now,
		seconds: (n: number) => new Date(now.getTime() + n * 1000),
		minutes: (n: number) => new Date(now.getTime() + n * 60_000),
		hours: (n: number) => new Date(now.getTime() + n * 3_600_000),
	};
}

/// The course segments every island takes; none of them is ever sent anywhere.
export const target = { discipline: "algorithms", course: "ada_2026-2" };

/// The segments of an exam of `target`.
export const examTarget = { ...target, exam: "midterm" };

/// The variants of a catalogue entry that is either open or closed.
export const openClosed = [
	{ key: "open", label: "Open" },
	{ key: "closed", label: "Closed" },
];

/// The variants of a catalogue entry that is either filled or empty.
export const someNone = [
	{ key: "some", label: "With rows" },
	{ key: "none", label: "Empty" },
];

/**
 * Picks, for each group of variants, the key the query string asks for, or the first.
 *
 * The group name is the query parameter `VariantPicker` writes.
 */
export function selectVariants<
	G extends Record<string, readonly { key: string }[]>,
>(url: URL, groups: G): Record<keyof G, string> {
	return Object.fromEntries(
		Object.entries(groups).map(([group, variants]) => {
			const asked = url.searchParams.get(group);
			const shown = variants.find((v) => v.key === asked) ?? variants[0];
			return [group, shown?.key ?? ""];
		}),
	) as Record<keyof G, string>;
}
