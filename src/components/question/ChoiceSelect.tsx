import {
	createEffect,
	createSignal,
	createUniqueId,
	For,
	type JSX,
	onCleanup,
	Show,
} from "solid-js";
import type { PublicChoice } from "@/mdq/public";
import Markdown from "./Markdown";

export interface ChoiceSelectProps {
	choices: readonly PublicChoice[];
	/** The id of the picked choice, or `""` for none. */
	value: string;
	onChange: (id: string) => void;
	disabled?: boolean;
	/** Shown when nothing is picked. */
	placeholder?: string;
	ariaLabel?: string;
	class?: string;
}

/**
 * A one-of-many picker that renders each choice as inline Markdown.
 *
 * A native `<select>` cannot do this. An `<option>`'s content model is text:
 * markup written into it lands in the DOM and generates no layout boxes at all,
 * so `` `O(n)` `` shows its backticks and there is no property to set that
 * changes it. Rendering a choice the way every other view renders one means
 * giving up the native control, which is the whole reason this component
 * exists.
 *
 * What that costs is what is rebuilt here: the listbox keyboard contract
 * (arrows, Home/End, Enter, Escape), the ARIA the browser supplied for free,
 * and closing on an outside click. What it buys is a choice that reads the same
 * inside a sentence as it does in `MultipleChoiceView`.
 */
export default function ChoiceSelect(props: ChoiceSelectProps): JSX.Element {
	const [open, setOpen] = createSignal(false);
	const [active, setActive] = createSignal(-1);

	const name = createUniqueId();
	const listId = `${name}-list`;
	// -1 names the "no choice" row, which is why this is not an array index.
	const optionId = (index: number) => `${name}-option-${index + 1}`;

	let root: HTMLSpanElement | undefined;
	let button: HTMLButtonElement | undefined;

	const picked = () =>
		props.choices.find((choice) => choice.id === props.value);

	/** Where the highlight starts: on what is picked, or at the top. */
	const pickedIndex = () =>
		props.choices.findIndex((choice) => choice.id === props.value);

	function show(): void {
		if (props.disabled) return;
		// -1 is the "no choice" row, which is also where an unanswered blank
		// starts — `pickedIndex()` is already -1 when nothing is picked.
		setActive(pickedIndex());
		setOpen(true);
	}

	function hide(focus = true): void {
		setOpen(false);
		if (focus) button?.focus();
	}

	function choose(index: number): void {
		props.onChange(props.choices[index]?.id ?? "");
		hide();
	}

	// An outside click closes it. Registered only while open, so a page full of
	// these does not carry a listener each.
	createEffect(() => {
		if (!open()) return;

		const onPointerDown = (event: PointerEvent) => {
			if (!root?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		onCleanup(() => document.removeEventListener("pointerdown", onPointerDown));
	});

	function onKeyDown(event: KeyboardEvent): void {
		const last = props.choices.length - 1;

		switch (event.key) {
			case "Escape":
				if (open()) {
					event.preventDefault();
					hide();
				}
				return;
			case "ArrowDown":
			case "ArrowUp": {
				event.preventDefault();
				if (!open()) {
					show();
					return;
				}
				const step = event.key === "ArrowDown" ? 1 : -1;
				setActive((current) => Math.min(last, Math.max(-1, current + step)));
				return;
			}
			case "Home":
				if (open()) {
					event.preventDefault();
					setActive(-1);
				}
				return;
			case "End":
				if (open()) {
					event.preventDefault();
					setActive(last);
				}
				return;
			case "Enter":
			case " ":
				event.preventDefault();
				if (open()) choose(active());
				else show();
				return;
			default:
		}
	}

	return (
		<span
			ref={root}
			class={`dropdown inline-block align-middle ${open() ? "dropdown-open" : ""}`}
		>
			<button
				ref={button}
				type="button"
				// The APG's select-only combobox: the button *is* the combobox, keeps
				// focus the whole time, and points at the highlighted option with
				// `aria-activedescendant`. A plain button does not support that
				// attribute, and a listbox is values to choose between rather than
				// commands to run, which a screen reader announces differently.
				role="combobox"
				aria-haspopup="listbox"
				aria-expanded={open()}
				aria-controls={open() ? listId : undefined}
				aria-activedescendant={open() ? optionId(active()) : undefined}
				aria-label={props.ariaLabel}
				disabled={props.disabled}
				onClick={() => (open() ? hide() : show())}
				onKeyDown={onKeyDown}
				class={`select select-sm inline-flex w-auto items-center gap-1 text-left disabled:text-base-content ${props.class ?? ""}`}
			>
				<Show
					when={picked()}
					fallback={
						<span class="text-base-content/50">{props.placeholder ?? "—"}</span>
					}
				>
					{(choice) => <Markdown inline text={choice().text} />}
				</Show>
			</button>

			<Show when={open()}>
				{/*
				 * A `<div role="listbox">` of `<div role="option">`, not a `<ul>` of
				 * `<li><button>`: an option is a leaf in the accessibility tree and
				 * must not contain an interactive element of its own. Focus never
				 * moves here — the button owns it and drives the highlight through
				 * `aria-activedescendant`, which is what the listbox pattern asks
				 * for — so these need no tabindex and no key handlers.
				 */}
				<div
					id={listId}
					role="listbox"
					aria-label={props.ariaLabel}
					class="dropdown-content z-10 mt-1 flex w-max min-w-40 flex-col rounded-box border border-base-300 bg-base-100 p-1 shadow-lg"
				>
					<Option
						id={optionId(-1)}
						selected={props.value === ""}
						highlighted={active() === -1}
						onPick={() => {
							props.onChange("");
							hide();
						}}
						onHover={() => setActive(-1)}
					>
						<span class="text-base-content/50">{props.placeholder ?? "—"}</span>
					</Option>

					<For each={props.choices}>
						{(choice, index) => (
							<Option
								id={optionId(index())}
								selected={choice.id === props.value}
								highlighted={active() === index()}
								onPick={() => choose(index())}
								onHover={() => setActive(index())}
							>
								<Markdown inline text={choice.text} />
							</Option>
						)}
					</For>
				</div>
			</Show>
		</span>
	);
}

interface OptionProps {
	id: string;
	selected: boolean;
	highlighted: boolean;
	onPick: () => void;
	onHover: () => void;
	children: JSX.Element;
}

/** One row of the listbox. Inert to the keyboard by design — see above. */
function Option(props: OptionProps): JSX.Element {
	return (
		// Focus stays on the combobox button, which carries the whole keyboard
		// contract and names the highlighted row with `aria-activedescendant`. An
		// option here is deliberately not focusable: giving it a tabindex would
		// break the listbox pattern rather than improve it.
		// biome-ignore lint/a11y/useFocusableInteractive: see above
		<div
			id={props.id}
			role="option"
			aria-selected={props.selected}
			class={`cursor-pointer rounded-field px-3 py-1.5 text-sm ${
				props.highlighted ? "bg-base-200" : ""
			} ${props.selected ? "font-semibold" : ""}`}
			// `onPointerDown` rather than `onClick`: the outside-click listener runs
			// on pointerdown, and a click that lands after the list has closed never
			// arrives.
			onPointerDown={(event) => {
				event.preventDefault();
				props.onPick();
			}}
			onPointerEnter={props.onHover}
		>
			{props.children}
		</div>
	);
}
