import { For, type JSX, Show } from "solid-js";
import { m } from "@/i18n";
import type { GraderItem } from "@/utils/grader-state";
import { signedPercent } from "./AppliedItems";
import type { PanelUnit } from "./rubric-panel";

export interface RubricPanelProps {
	units: PanelUnit[];
	/// The keys of the items applied to the answer being graded.
	applied: string[];
	/// The name of the group whose letters are listened to, if any.
	armed: string | null;
	onChoose: (key: string) => void;
}

/**
 * The rubric as a grader picks from it: each top-level group is a radio group, each loose item a checkbox.
 *
 * A retired item shows only when the answer applies it, can be unchecked, and
 * cannot be checked again.
 */
export default function RubricPanel(props: RubricPanelProps): JSX.Element {
	return (
		<div class="flex flex-col gap-3">
			<Show when={props.units.length === 0}>
				<p class="text-sm text-muted">{m.grades_grader_empty_rubric()}</p>
			</Show>
			<For each={props.units}>
				{(unit) =>
					unit.kind === "group" ? (
						<Group unit={unit} {...props} />
					) : (
						<Loose item={unit.item} digit={unit.digit} {...props} />
					)
				}
			</For>
		</div>
	);
}

/// The digit, letter or value hint next to an option.
function Key(props: { children: string }): JSX.Element {
	return (
		<span aria-hidden="true" class="kbd kbd-xs">
			{props.children}
		</span>
	);
}

/// The text of an item with its value and, when split, a retired mark.
function Label(props: { item: GraderItem }): JSX.Element {
	return (
		<>
			<span>{props.item.text}</span>
			<span class="text-muted">{signedPercent(props.item.value)}</span>
			<Show when={props.item.retired}>
				<span class="badge badge-warning badge-sm">
					{m.grades_grader_retired()}
				</span>
			</Show>
		</>
	);
}

/// Whether `item` can be clicked: a retired item only while it is applied.
function locked(props: RubricPanelProps, item: GraderItem): boolean {
	return item.retired && !props.applied.includes(item.key);
}

function Group(
	props: RubricPanelProps & { unit: Extract<PanelUnit, { kind: "group" }> },
): JSX.Element {
	const titleId = `rubric-group-${props.unit.name.replace(/\W+/g, "-")}`;
	return (
		<div
			role="radiogroup"
			aria-labelledby={titleId}
			aria-keyshortcuts={props.unit.digit ?? undefined}
			class="rounded-box border p-2"
			classList={{
				"border-primary": props.armed === props.unit.name,
				"border-base-300": props.armed !== props.unit.name,
			}}
		>
			<p id={titleId} class="flex items-center gap-2 text-sm font-semibold">
				<Show when={props.unit.digit}>{(digit) => <Key>{digit()}</Key>}</Show>
				{props.unit.name}
			</p>
			<For each={props.unit.leaves}>
				{(leaf, index) => (
					<>
						<Show
							when={
								leaf.subgroup !== null &&
								leaf.subgroup !== props.unit.leaves[index() - 1]?.subgroup
							}
						>
							<p class="mt-1 text-xs font-medium text-muted">{leaf.subgroup}</p>
						</Show>
						<label class="flex cursor-pointer items-center gap-2 py-1 text-sm">
							<input
								type="radio"
								name={titleId}
								class="radio radio-sm"
								checked={props.applied.includes(leaf.item.key)}
								disabled={locked(props, leaf.item)}
								aria-keyshortcuts={leaf.letter ?? undefined}
								onClick={() => props.onChoose(leaf.item.key)}
							/>
							<Show when={leaf.letter}>
								{(letter) => <Key>{letter()}</Key>}
							</Show>
							<Label item={leaf.item} />
						</label>
					</>
				)}
			</For>
		</div>
	);
}

function Loose(
	props: RubricPanelProps & { item: GraderItem; digit: string | null },
): JSX.Element {
	return (
		<label class="flex cursor-pointer items-center gap-2 rounded-box border border-base-300 p-2 text-sm">
			<input
				type="checkbox"
				class="checkbox checkbox-sm"
				checked={props.applied.includes(props.item.key)}
				disabled={locked(props, props.item)}
				aria-keyshortcuts={props.digit ?? undefined}
				onChange={() => props.onChoose(props.item.key)}
			/>
			<Show when={props.digit}>{(digit) => <Key>{digit()}</Key>}</Show>
			<Label item={props.item} />
		</label>
	);
}
