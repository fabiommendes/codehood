import { createSignal, type JSX } from "solid-js";

export interface TextInputProps {
	value?: string;
	onChange?: (text: string) => void;
	disabled?: boolean;
	/** Sizing is the caller's: a box in a sentence is not a box on its own line. */
	class?: string;
	id?: string;
	placeholder?: string;
	ariaLabel?: string;
	ariaDescribedBy?: string;
}

/**
 * One line of text, controlled or not.
 *
 * Thin, and extracted anyway: it is what makes a fill-in sentence three
 * sibling controls rather than two components and a loose `<input>`.
 * Pre-validation stays with `ShortAnswerView`, since a blank carries no
 * `preAccept` or `preReject` to validate against.
 */
export default function TextInput(props: TextInputProps): JSX.Element {
	// Uncontrolled fallback: seeded from `value` once, then tracked locally so
	// the box works even when the caller passes no `onChange`.
	const [internal, setInternal] = createSignal(props.value ?? "");
	const text = () => (props.value !== undefined ? props.value : internal());

	function edit(next: string): void {
		setInternal(next);
		props.onChange?.(next);
	}

	return (
		<input
			id={props.id}
			type="text"
			class={`input disabled:text-base-content ${props.class ?? ""}`}
			placeholder={props.placeholder ?? "Your answer"}
			disabled={props.disabled}
			value={text()}
			onInput={(event) => edit(event.currentTarget.value)}
			aria-label={props.ariaLabel}
			aria-describedby={props.ariaDescribedBy}
		/>
	);
}
