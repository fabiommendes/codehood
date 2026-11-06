import { createSignal, For, type JSX, onMount, Show } from "solid-js";

/// The theme colours a tuned variable can take, as named in `global.css`.
const TOKENS = [
	"base-100",
	"base-200",
	"base-300",
	"base-content",
	"muted",
	"neutral",
	"primary",
	"secondary",
	"accent",
	"info",
	"success",
	"warning",
	"error",
] as const;

/** A CSS variable the tuner sets on `:root`, with the theme colour and opacity it starts from. */
export interface TunedColor {
	/// The variable, e.g. `--question-head-bg`.
	name: string;
	label: string;
	/// The Tailwind utility prefix the chosen colour turns into, e.g. `bg`.
	utility: string;
	token: (typeof TOKENS)[number];
	/// Opacity in percent.
	opacity: number;
}

interface Choice {
	token: string;
	opacity: number;
}

const STORAGE_KEY = "codehood:color-tuner";

/// The CSS value of a theme colour at an opacity.
function cssValue(choice: Choice): string {
	return choice.opacity >= 100
		? `var(--color-${choice.token})`
		: `color-mix(in oklab, var(--color-${choice.token}) ${choice.opacity}%, transparent)`;
}

/// The Tailwind class the choice amounts to, e.g. `bg-primary/10`.
function utilityClass(utility: string, choice: Choice): string {
	return choice.opacity >= 100
		? `${utility}-${choice.token}`
		: `${utility}-${choice.token}/${choice.opacity}`;
}

/**
 * A floating panel for picking theme colours live, by setting CSS variables on the page.
 *
 * A development aid: the page reads each variable with its current colour as
 * the fallback, the panel overrides it, and shows the Tailwind class that
 * would replace the variable. Choices persist in `localStorage`.
 */
export default function ColorTuner(props: {
	colors: TunedColor[];
}): JSX.Element {
	const initial = Object.fromEntries(
		props.colors.map((color) => [
			color.name,
			{ token: color.token, opacity: color.opacity },
		]),
	) as Record<string, Choice>;
	const [choices, setChoices] = createSignal<Record<string, Choice>>(initial);
	const [open, setOpen] = createSignal(true);

	function apply(next: Record<string, Choice>): void {
		setChoices(next);
		for (const [name, choice] of Object.entries(next)) {
			document.documentElement.style.setProperty(name, cssValue(choice));
		}
		localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
	}

	function update(name: string, patch: Partial<Choice>): void {
		const current = choices()[name] ?? { token: "base-200", opacity: 100 };
		apply({ ...choices(), [name]: { ...current, ...patch } });
	}

	onMount(() => {
		const stored = localStorage.getItem(STORAGE_KEY);
		const saved = stored ? (JSON.parse(stored) as Record<string, Choice>) : {};
		apply({ ...initial, ...saved });
	});

	const summary = () =>
		props.colors
			.map((color) => {
				const choice = choices()[color.name];
				return choice ? utilityClass(color.utility, choice) : "";
			})
			.join(" ");

	return (
		<div class="fixed right-4 bottom-4 z-50 w-80 rounded-box border border-base-300 bg-base-100 text-sm shadow-xl">
			<button
				type="button"
				class="flex w-full items-center justify-between px-4 py-2 font-semibold"
				onClick={() => setOpen(!open())}
			>
				Color tuner <span class="text-muted">{open() ? "−" : "+"}</span>
			</button>
			<Show when={open()}>
				<div class="flex flex-col gap-3 border-t border-base-300 px-4 py-3">
					<For each={props.colors}>
						{(color) => (
							<div class="flex flex-col gap-1">
								<span class="text-xs text-muted">{color.label}</span>
								<div class="flex items-center gap-2">
									<span
										class="size-5 shrink-0 rounded border border-base-300"
										style={{ background: `var(${color.name})` }}
									/>
									<select
										class="select select-xs w-32"
										value={choices()[color.name]?.token}
										onChange={(event) =>
											update(color.name, { token: event.currentTarget.value })
										}
									>
										<For each={TOKENS}>
											{(token) => <option value={token}>{token}</option>}
										</For>
									</select>
									<input
										type="range"
										class="range range-xs flex-1"
										min="0"
										max="100"
										step="5"
										value={choices()[color.name]?.opacity}
										onInput={(event) =>
											update(color.name, {
												opacity: Number(event.currentTarget.value),
											})
										}
									/>
									<span class="w-9 text-right font-mono text-xs tabular-nums">
										{choices()[color.name]?.opacity}%
									</span>
								</div>
							</div>
						)}
					</For>
					<code class="rounded bg-base-200 px-2 py-1 font-mono text-xs break-all">
						{summary()}
					</code>
					<button
						type="button"
						class="btn btn-ghost btn-xs self-end"
						onClick={() => {
							localStorage.removeItem(STORAGE_KEY);
							apply(initial);
						}}
					>
						Reset
					</button>
				</div>
			</Show>
		</div>
	);
}
