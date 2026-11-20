import type { JSX } from "solid-js";
import { For } from "solid-js";
import Link from "@/components/Link";
import type { Href } from "@/urls";

/// One choice of a toggle group.
export interface ToggleOption<V extends string> {
	value: V;
	label: JSX.Element;
	/// Makes the choice a link that navigates, for filters kept in the query string.
	href?: Href;
	/// Extra `data-*` attributes for the choice's element, such as `{ "data-status": "OPEN" }`.
	attrs?: Record<`data-${string}`, string>;
}

interface CommonProps<V extends string> {
	options: readonly ToggleOption<V>[];
	/// Accessible name of the group.
	label: string;
	class?: string;
}

interface SingleProps<V extends string> extends CommonProps<V> {
	mode?: "single";
	/// The chosen value; `null` when none is chosen.
	value: V | null;
	onChange?: (value: V) => void;
}

interface MultipleProps<V extends string> extends CommonProps<V> {
	mode: "multiple";
	value: readonly V[];
	/// Receives the whole selection after the clicked choice is added or removed.
	onChange?: (value: V[]) => void;
}

export type ToggleGroupProps<V extends string> =
	| SingleProps<V>
	| MultipleProps<V>;

/// Whether `option` is part of the current selection.
function isSelected<V extends string>(
	props: ToggleGroupProps<V>,
	option: V,
): boolean {
	return props.mode === "multiple"
		? props.value.includes(option)
		: props.value === option;
}

/// Reports the selection that results from clicking `option`.
function choose<V extends string>(props: ToggleGroupProps<V>, option: V): void {
	if (props.mode === "multiple") {
		props.onChange?.(
			props.value.includes(option)
				? props.value.filter((value) => value !== option)
				: [...props.value, option],
		);
	} else {
		props.onChange?.(option);
	}
}

/**
 * A row of joined buttons that picks one value (`single`) or several (`multiple`).
 *
 * The chosen buttons are solid `primary` and bold, the others plain, so the
 * state shows without relying on hue. A choice with `href` renders a link and
 * marks the current one with `aria-current`; the others render a button with
 * `aria-pressed`.
 */
export default function ToggleGroup<V extends string>(
	props: ToggleGroupProps<V>,
): JSX.Element {
	const classes = (option: V) =>
		`btn btn-sm join-item ${isSelected(props, option) ? "btn-primary" : ""}`;

	return (
		// biome-ignore lint/a11y/useSemanticElements: a fieldset would not lay out as a `join`.
		<div
			role="group"
			aria-label={props.label}
			class={`join ${props.class ?? ""}`}
		>
			<For each={props.options}>
				{(option) =>
					option.href !== undefined ? (
						<Link
							href={option.href}
							class={classes(option.value)}
							aria-current={
								isSelected(props, option.value) ? "true" : undefined
							}
							{...option.attrs}
						>
							{option.label}
						</Link>
					) : (
						<button
							type="button"
							class={classes(option.value)}
							aria-pressed={isSelected(props, option.value)}
							onClick={() => choose(props, option.value)}
							{...option.attrs}
						>
							{option.label}
						</button>
					)
				}
			</For>
		</div>
	);
}
