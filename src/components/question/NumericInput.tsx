import { createEffect, createSignal, type JSX, Show } from "solid-js";
import {
	formatNumericInput as format,
	parseNumericInput as parse,
} from "@/mdq/numeric";

export interface NumericInputProps {
	/** Chooses the control: a `fraction` question cannot use a number input. */
	domain: "integer" | "decimal" | "fraction";
	/** Suffix shown inside the box, e.g. `g` or `m/s`. */
	unit?: string;
	decimalPlaces?: number;
	/** Controlled as a number, for a caller that stores the parsed value. */
	value?: number | null;
	/**
	 * Controlled as raw text, for a caller that stores what was typed.
	 *
	 * Wins over `value` when both are given. A fill-in blank uses this one: its
	 * answers travel as strings, and grading distinguishes an empty box from a
	 * box holding "about ten", which a parsed `null` cannot.
	 */
	text?: string;
	onChange?: (value: number | null, text: string) => void;
	disabled?: boolean;
	/** Sizing is the caller's: a box in a sentence is not a box on its own line. */
	class?: string;
	id?: string;
	placeholder?: string;
	ariaLabel?: string;
	ariaDescribedBy?: string;
}

/**
 * One numeric answer box, with its unit suffix and the control the domain asks
 * for.
 *
 * Knows nothing about stems, scores or feedback, so both the standalone
 * `NumericView` and every numeric blank of a `FillInView` render the same box.
 */
export default function NumericInput(props: NumericInputProps): JSX.Element {
	// The raw text, not the parsed number: a half-typed "3." or "-" is not a
	// number yet, and reformatting the box from the parsed value while someone
	// is still typing takes the caret with it.
	const [text, setText] = createSignal(
		props.text ?? format(props.value ?? null),
	);

	// Follows whichever controlled prop was given, and only that: with neither,
	// the caller passed none, so the box owns its own text and must not be
	// rewritten from a `null` that was never an answer. Even when controlled by
	// `value` the rewrite waits until the two disagree as *numbers*, so a
	// half-typed "3.50" is not snapped back to "3.5" with the caret in it.
	createEffect(() => {
		if (props.text !== undefined) {
			if (props.text !== text()) setText(props.text);
			return;
		}
		const incoming = props.value;
		if (incoming === undefined) return;
		if (parse(text()) !== incoming) setText(format(incoming));
	});

	// A number input rejects "1/3" outright, so a question that asks for a
	// fraction has to accept text or the domain means nothing.
	const isFraction = () => props.domain === "fraction";

	// `1` for whole numbers, `10⁻ᵈ` when the author fixed the decimals, and
	// otherwise no constraint at all.
	const step = (): string => {
		if (props.domain === "integer") return "1";
		const places = props.decimalPlaces;
		return places === undefined ? "any" : String(10 ** -places);
	};

	function edit(next: string): void {
		setText(next);
		props.onChange?.(parse(next), next);
	}

	return (
		<label
			class={`input disabled:text-base-content ${props.class ?? ""}`}
			for={props.id}
			aria-label={props.ariaLabel}
		>
			<input
				id={props.id}
				type={isFraction() ? "text" : "number"}
				step={isFraction() ? undefined : step()}
				inputmode={isFraction() ? "text" : "decimal"}
				class="grow disabled:text-base-content"
				placeholder={
					props.placeholder ?? (isFraction() ? "a/b" : "Your answer")
				}
				disabled={props.disabled}
				value={text()}
				onInput={(event) => edit(event.currentTarget.value)}
				aria-describedby={props.ariaDescribedBy}
			/>
			<Show when={props.unit}>
				{(unit) => <span class="label">{unit()}</span>}
			</Show>
		</label>
	);
}
