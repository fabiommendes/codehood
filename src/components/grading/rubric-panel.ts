import { topLevelGroup } from "@/services/rubric";
import type { GraderItem } from "@/utils/grader-state";

/// An item the grader may choose in the panel.
export interface PanelLeaf {
	item: GraderItem;
	/// The letter that chooses it within its group, absent for a retired item.
	letter: string | null;
	/// The group path below the top-level group, or `null`.
	subgroup: string | null;
}

/// One entry of the panel: a top-level group, one choice among its leaves, or an item on its own.
export type PanelUnit =
	| {
			kind: "group";
			name: string;
			/// The digit that selects the group, absent past the ninth entry.
			digit: string | null;
			leaves: PanelLeaf[];
	  }
	| { kind: "loose"; item: GraderItem; digit: string | null };

/// The letters that choose an option inside a group, in order.
const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/**
 * The panel's entries, in the order of each one's first item, with the shortcuts they answer to.
 *
 * Digits go to the entries that can still be chosen; letters go to the active
 * leaves of a group in position order. A retired item is shown only when its
 * key is in `shownRetired`, and never has a shortcut.
 */
export function panelUnits(
	items: GraderItem[],
	shownRetired: ReadonlySet<string>,
): PanelUnit[] {
	const units: PanelUnit[] = [];
	const groups = new Map<string, Extract<PanelUnit, { kind: "group" }>>();
	for (const item of [...items].sort((a, b) => a.position - b.position)) {
		if (item.retired && !shownRetired.has(item.key)) continue;
		const top = topLevelGroup(item.group);
		if (top === null) {
			units.push({ kind: "loose", item, digit: null });
			continue;
		}
		let unit = groups.get(top);
		if (!unit) {
			unit = { kind: "group", name: top, digit: null, leaves: [] };
			groups.set(top, unit);
			units.push(unit);
		}
		const rest = (item.group as string).slice(top.length + 1);
		unit.leaves.push({
			item,
			letter: null,
			subgroup: rest === "" ? null : rest,
		});
	}

	let digit = 0;
	for (const unit of units) {
		const active =
			unit.kind === "group"
				? unit.leaves.some((leaf) => !leaf.item.retired)
				: !unit.item.retired;
		if (active && digit < 9) unit.digit = String(++digit);
		if (unit.kind === "group") {
			let letter = 0;
			for (const leaf of unit.leaves) {
				if (!leaf.item.retired && letter < LETTERS.length) {
					leaf.letter = LETTERS[letter++] as string;
				}
			}
		}
	}
	return units;
}

/**
 * The keys applied after the grader chooses `key`.
 *
 * Choosing an item of a top-level group replaces the group's other choice;
 * choosing the item already applied removes it.
 */
export function choose(
	applied: string[],
	items: GraderItem[],
	key: string,
): string[] {
	if (applied.includes(key)) return applied.filter((entry) => entry !== key);
	const group = topLevelGroup(
		items.find((item) => item.key === key)?.group ?? null,
	);
	if (group === null) return [...applied, key];
	const sameGroup = new Set(
		items
			.filter((item) => topLevelGroup(item.group) === group)
			.map((item) => item.key),
	);
	return [...applied.filter((entry) => !sameGroup.has(entry)), key];
}

/// The distinct group paths of `items`, ancestors included, sorted.
export function groupPaths(items: GraderItem[]): string[] {
	const paths = new Set<string>();
	for (const item of items) {
		if (item.group === null) continue;
		const segments = item.group.split("/");
		for (let end = 1; end <= segments.length; end++) {
			paths.add(segments.slice(0, end).join("/"));
		}
	}
	return [...paths].sort();
}
