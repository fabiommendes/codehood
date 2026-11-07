/**
 * Pure rubric rules (spec `dev/specs/to-do/rubrica-de-correcao.md`, R5 to R7,
 * R11, R12, R13, R15, R19a), tested against `src/services/rubric.ts`.
 *
 * API the tests expect from `@/services/rubric` (no database, no I/O):
 *
 *   parseGroupPath(text: string): string[] | null
 *     Splits a group path on "/", trims each segment. `null` when a segment is
 *     empty or contains ":" (the whole path is rejected).
 *   joinGroupPath(segments: string[]): string
 *     The stored form: segments joined by "/".
 *   topLevelGroup(group: string | null): string | null
 *     First segment of a stored group path, `null` for no group.
 *   groupOrder(items: { group: string | null; position: number }[]): string[]
 *     Top-level groups in the order of their first item by `position`
 *     (array order is irrelevant). Ungrouped items add nothing.
 *   findGroupConflict(items: { key: string; group: string | null }[]):
 *     { group: string; keys: string[] } | null
 *     The first top-level group applied more than once, or `null`.
 *   rubricScore(input: {
 *     base: string;                                     // decimal or "n/d"
 *     items: { value: string; retiredAt?: Date | null }[]; // applied items
 *     adjustment?: string | null;
 *   }): string
 *     min(1, max(0, base + sum(values) + adjustment)) in exact rational
 *     arithmetic. Output is a decimal when the reduced denominator only has
 *     factors 2 and 5 ("0.35", "1", "0"), otherwise a reduced "n/d" ("2/3").
 *   needsReview(applied: { retiredAt: Date | null }[]): boolean
 *     True when any applied item is retired.
 *   nextItemKey(keys: string[]): string
 *     "i<n+1>" for the highest "i<n>" in `keys` (retired keys included, other
 *     keys ignored); "i1" when there is none.
 *   parseInitialRubric(raw: unknown): { items: InitialItem[]; warnings: string[] }
 *     Reads `privatePayload.rubric`. InitialItem is
 *     { key: string; group: string | null; text: string; value: string;
 *       comment: string | null; feedback: string | null }, in list order.
 *     Key is the entry's `id`, else its 1-based position in the list
 *     ("1", "2", ...). `path` becomes `group` (normalized). `undefined` is
 *     an empty rubric without warning. A non-list value, or an entry that is
 *     not an object, lacks a string `value` or `text`, or has a bad `path`,
 *     is skipped with one warning message; it never throws.
 */
import { expect, test } from "@playwright/test";
import fc from "fast-check";
import {
	findGroupConflict,
	groupOrder,
	joinGroupPath,
	needsReview,
	nextItemKey,
	parseGroupPath,
	parseInitialRubric,
	rubricScore,
	topLevelGroup,
} from "@/services/rubric";

/// Applied items carrying only a value, the shape `rubricScore` needs.
function values(...list: string[]) {
	return list.map((value) => ({ value }));
}

//
// R5: group paths
//

test("parseGroupPath trims the segments of a path and joinGroupPath stores them with '/'", () => {
	const segments = parseGroupPath(" Recursion / Wrong /Base case ");

	expect(segments).toEqual(["Recursion", "Wrong", "Base case"]);
	expect(joinGroupPath(segments ?? [])).toBe("Recursion/Wrong/Base case");
});

test("parseGroupPath keeps a one-segment path whole", () => {
	expect(parseGroupPath("  Style ")).toEqual(["Style"]);
});

for (const bad of ["A//B", "A/ /B", "/A", "A/", "A:B", "A/B:C", "A/ : /B"]) {
	test(`parseGroupPath rejects ${JSON.stringify(bad)}`, () => {
		expect(parseGroupPath(bad)).toBeNull();
	});
}

test("topLevelGroup is the first segment of a stored path, null without a group", () => {
	expect(topLevelGroup("Rec/Wrong/Base")).toBe("Rec");
	expect(topLevelGroup("Rec")).toBe("Rec");
	expect(topLevelGroup(null)).toBeNull();
});

test("groupOrder follows the first item of each group by position, not the alphabet or the array order", () => {
	const items = [
		{ group: "A/y", position: 1 },
		{ group: "B/z", position: 2 },
		{ group: "B/x", position: 0 },
	];

	expect(groupOrder(items)).toEqual(["B", "A"]);
});

test("groupOrder ignores ungrouped items and lists each group once", () => {
	const items = [
		{ group: null, position: 0 },
		{ group: "B", position: 1 },
		{ group: null, position: 2 },
		{ group: "B/deep/er", position: 3 },
		{ group: "A", position: 4 },
	];

	expect(groupOrder(items)).toEqual(["B", "A"]);
});

//
// R6: one item per top-level group
//

test("findGroupConflict reports two items under one top-level group at different depths", () => {
	const conflict = findGroupConflict([
		{ key: "a", group: "Rec/Wrong/Base" },
		{ key: "b", group: "Rec/Right" },
	]);

	expect(conflict?.group).toBe("Rec");
	expect([...(conflict?.keys ?? [])].sort()).toEqual(["a", "b"]);
});

test("findGroupConflict reports two items in exactly the same group", () => {
	const conflict = findGroupConflict([
		{ key: "a", group: "Rec" },
		{ key: "b", group: "Rec" },
	]);

	expect(conflict?.group).toBe("Rec");
});

test("findGroupConflict does not mistake a longer group name for a subgroup", () => {
	expect(
		findGroupConflict([
			{ key: "a", group: "Rec/x" },
			{ key: "b", group: "Recursion/y" },
		]),
	).toBeNull();
});

test("findGroupConflict treats ungrouped items as independent of each other and of groups", () => {
	expect(
		findGroupConflict([
			{ key: "a", group: null },
			{ key: "b", group: null },
			{ key: "c", group: "Rec/x" },
		]),
	).toBeNull();
});

test("findGroupConflict accepts one item per top-level group", () => {
	expect(
		findGroupConflict([
			{ key: "a", group: "A/x" },
			{ key: "b", group: "B/x" },
		]),
	).toBeNull();
	expect(findGroupConflict([])).toBeNull();
});

//
// R7, R19a: exact score
//

test("rubricScore sums decimals exactly, without float noise", () => {
	expect(
		rubricScore({ base: "0", items: values("0.1", "0.2"), adjustment: null }),
	).toBe("0.3");
});

test("rubricScore sums fractions exactly", () => {
	expect(rubricScore({ base: "0", items: values("1/3", "1/3", "1/3") })).toBe(
		"1",
	);
});

test("rubricScore mixes decimals, fractions and the adjustment in one exact sum", () => {
	expect(
		rubricScore({ base: "0.5", items: values("-1/4"), adjustment: "0.1" }),
	).toBe("0.35");
});

const formatCases: { label: string; vals: string[]; expected: string }[] = [
	{ label: "thirds stay a fraction", vals: ["1/3", "1/3"], expected: "2/3" },
	{ label: "a fraction is reduced", vals: ["1/6", "1/6"], expected: "1/3" },
	{
		label: "a fraction that is a decimal comes out as one",
		vals: ["1/4", "1/4"],
		expected: "0.5",
	},
	{ label: "eighths are decimal", vals: ["1/8"], expected: "0.125" },
	{ label: "fifths are decimal", vals: ["1/5"], expected: "0.2" },
	{ label: "sixths mixed to a half", vals: ["1/3", "1/6"], expected: "0.5" },
	{ label: "a sixth", vals: ["1/6"], expected: "1/6" },
	{ label: "a seventh", vals: ["1/7", "1/7"], expected: "2/7" },
	{ label: "trailing zeros are dropped", vals: ["0.50"], expected: "0.5" },
];

for (const { label, vals, expected } of formatCases) {
	test(`rubricScore formats ${label}`, () => {
		expect(rubricScore({ base: "0", items: values(...vals) })).toBe(expected);
	});
}

test("rubricScore clamps to 0 at the bottom and to 1 at the top", () => {
	expect(rubricScore({ base: "1", items: values("-0.75", "-0.5") })).toBe("0");
	expect(rubricScore({ base: "0.9", items: values("0.25") })).toBe("1");
});

test("rubricScore clamps only at the end, never between terms", () => {
	expect(rubricScore({ base: "1", items: values("0.5", "-0.5") })).toBe("1");
	expect(rubricScore({ base: "0", items: values("-0.5", "0.5") })).toBe("0");
});

test("rubricScore counts retired items that the pass still applies", () => {
	expect(
		rubricScore({
			base: "0",
			items: [
				{ value: "0.5", retiredAt: new Date("2026-01-01") },
				{ value: "0.25", retiredAt: null },
			],
		}),
	).toBe("0.75");
});

test("rubricScore with no items is the base plus the adjustment", () => {
	expect(rubricScore({ base: "0.2", items: [], adjustment: null })).toBe("0.2");
	expect(rubricScore({ base: "0.2", items: [], adjustment: "0.3" })).toBe(
		"0.5",
	);
	expect(rubricScore({ base: "0.2", items: [] })).toBe("0.2");
});

test("rubricScore adds a negative adjustment", () => {
	expect(
		rubricScore({ base: "0.5", items: values("0.25"), adjustment: "-0.5" }),
	).toBe("0.25");
});

test("rubricScore agrees with integer arithmetic on hundredths for any decimal input", () => {
	const cents = fc.integer({ min: -100, max: 100 });
	const centsAsDecimal = (n: number) => {
		const sign = n < 0 ? "-" : "";
		const abs = Math.abs(n);
		return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
	};
	const expectedText = (total: number) => {
		if (total === 0) return "0";
		if (total === 100) return "1";
		return `0.${String(total).padStart(2, "0")}`.replace(/0$/, "");
	};

	fc.assert(
		fc.property(
			fc.integer({ min: 0, max: 100 }),
			fc.array(cents, { maxLength: 8 }),
			cents,
			(base, list, adjustment) => {
				const total = Math.min(
					100,
					Math.max(0, base + list.reduce((a, b) => a + b, 0) + adjustment),
				);

				const score = rubricScore({
					base: centsAsDecimal(base),
					items: values(...list.map(centsAsDecimal)),
					adjustment: centsAsDecimal(adjustment),
				});

				expect(score).toBe(expectedText(total));
			},
		),
	);
});

//
// R11: review
//

test("needsReview is false with no retired applied item and true with one", () => {
	expect(needsReview([])).toBe(false);
	expect(needsReview([{ retiredAt: null }, { retiredAt: null }])).toBe(false);
	expect(
		needsReview([{ retiredAt: null }, { retiredAt: new Date("2026-01-01") }]),
	).toBe(true);
});

//
// R15: generated keys
//

test("nextItemKey goes one above the highest i<n>, ignoring other keys", () => {
	expect(nextItemKey(["i1", "i3", "2", "foo"])).toBe("i4");
});

test("nextItemKey counts a retired item's key like any other", () => {
	// The retired key is just one more key in the list the caller passes.
	expect(nextItemKey(["i1", "i2", "i3", "i4", "i5"])).toBe("i6");
});

test("nextItemKey starts at i1 when no key has the i<n> form", () => {
	expect(nextItemKey(["1", "2"])).toBe("i1");
	expect(nextItemKey([])).toBe("i1");
});

test("nextItemKey compares numerically, not as text", () => {
	expect(nextItemKey(["i9", "i10"])).toBe("i11");
});

test("nextItemKey does not read near-misses such as 'i' or 'i1x' as keys", () => {
	expect(nextItemKey(["i", "i1x", "xi7", "I8"])).toBe("i1");
});

//
// R12, R13: initial rubric
//

test("parseInitialRubric reads ids, paths, comments and feedback", () => {
	const { items, warnings } = parseInitialRubric([
		{
			id: "base-case",
			value: "0.5",
			path: " Rec / Right ",
			text: "Has a base case",
			comment: "check the guard",
			feedback: "Good base case",
		},
		{ id: "style", value: "-0.25", text: "Poor style" },
	]);

	expect(warnings).toEqual([]);
	expect(items).toEqual([
		{
			key: "base-case",
			group: "Rec/Right",
			text: "Has a base case",
			value: "0.5",
			comment: "check the guard",
			feedback: "Good base case",
		},
		{
			key: "style",
			group: null,
			text: "Poor style",
			value: "-0.25",
			comment: null,
			feedback: null,
		},
	]);
});

test("parseInitialRubric keys an entry without id by its 1-based position", () => {
	const { items } = parseInitialRubric([
		{ value: "0.5", text: "first" },
		{ id: "named", value: "0.25", text: "second" },
		{ value: "0.1", text: "third" },
	]);

	expect(items.map((item) => item.key)).toEqual(["1", "named", "3"]);
});

test("parseInitialRubric skips malformed entries with a warning each and keeps the rest", () => {
	const { items, warnings } = parseInitialRubric([
		{ value: "0.5", text: "ok" },
		{ text: "no value" },
		{ value: "0.5" },
		"not an object",
		{ value: "0.5", text: "bad path", path: "A//B" },
	]);

	expect(items.map((item) => item.text)).toEqual(["ok"]);
	expect(warnings).toHaveLength(4);
});

test("parseInitialRubric treats a value that is not a list as empty, with a warning", () => {
	for (const raw of [{ not: "a list" }, "text", 42]) {
		const { items, warnings } = parseInitialRubric(raw);

		expect(items).toEqual([]);
		expect(warnings).toHaveLength(1);
	}
});

test("parseInitialRubric treats a missing rubric as empty without a warning", () => {
	expect(parseInitialRubric(undefined)).toEqual({ items: [], warnings: [] });
	expect(parseInitialRubric([])).toEqual({ items: [], warnings: [] });
});
