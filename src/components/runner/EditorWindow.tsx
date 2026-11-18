/**
 * The editor window: a frame with three working dots and a title bar around
 * an editor and the controls and output that go with it.
 *
 * The dots put the window inline, collapsed to its title bar, or maximized
 * over the content area of the app shell. The component knows nothing about
 * what it frames: the host passes the actions, the editor and the output.
 *
 * The `inline` dot is grey, not red: red promises "close" and `inline`
 * closes nothing; red and green toggle back to `inline` when clicked again.
 * Maximizing keeps the node where it is in the DOM (no portal), since moving
 * it would remount CodeMirror and xterm and lose their state. The shell bars
 * declare themselves with `data-shell-bar` instead of the window taking
 * selectors, so the window depends neither on the exam nor on the layout.
 * Bars and `#content` are measured in JS on maximize and on every `resize`,
 * because their height follows scrolling and line wrapping, which fixed CSS
 * variables cannot track.
 */

import {
	createSignal,
	For,
	type JSX,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { m } from "@/i18n";
import { pinGeometry, windowTop } from "./editor-window-bars";
import "./editor-window.css";

/** Where the window is: in the page flow, reduced to its title bar, or over the content area. */
export type WindowState = "inline" | "collapsed" | "maximized";

export interface EditorWindowProps {
	/// Shown in the title bar and names the window.
	filename: string;
	/// Language label in the title bar.
	language: string;
	/// Tooltip of the language label (e.g. the note on how a run restarts).
	languageTitle?: string;
	/// Controls at the right of the title bar.
	actions?: JSX.Element;
	/// Renders the question stem; shown in a side panel while maximized, with a toggle in the title bar.
	stem?: () => JSX.Element;
	/// What goes under the editor (output, status, footer). Hidden while collapsed, unless `peek`.
	below?: JSX.Element;
	/// Shows `below` while the window is collapsed (a run produced output).
	peek?: boolean;
	/// The state the window starts in. Maximized is not allowed: it pins the shell bars, so it is reached by a click.
	initialState?: Exclude<WindowState, "maximized">;
	/// Called once the window is maximized, to move the focus into the host's editor.
	onFocusEditor?: () => void;
	/// Called after every change of state.
	onStateChange?: (state: WindowState) => void;
	/// The editor. The element that holds it carries `data-editor`: Esc inside it is the editor's, not the window's.
	children: JSX.Element;
}

/// The dots in order: the state each leads to, its color and its label.
const DOTS: {
	state: WindowState;
	color: string;
	label: () => string;
}[] = [
	{
		state: "inline",
		color: "bg-base-content/35",
		label: () => m.runner_window_inline(),
	},
	{
		state: "collapsed",
		color: "bg-error",
		label: () => m.runner_window_collapse(),
	},
	{
		state: "maximized",
		color: "bg-success",
		label: () => m.runner_window_maximize(),
	},
];

/// A bar of the shell pinned in place, with the `style` to give back.
interface Pinned {
	element: HTMLElement;
	style: string;
	/// Holds the bar's place in the flow, so pinning does not move the page.
	placeholder: HTMLElement;
}

/// Counts the windows of the page, for unique view transition names.
let windows = 0;

/** A code editor in a window frame whose dots work. */
export default function EditorWindow(props: EditorWindowProps): JSX.Element {
	const id = ++windows;
	const [state, setState] = createSignal<WindowState>(
		props.initialState ?? "inline",
	);
	const [box, setBox] = createSignal({ top: 0, left: 0 });
	const [held, setHeld] = createSignal(0);
	const [stemOpen, setStemOpen] = createSignal(true);
	const [focusDot, setFocusDot] = createSignal(0);
	const dots: HTMLButtonElement[] = [];
	let section!: HTMLElement;
	let pinned: Pinned[] = [];
	/// What the content outside the window had for `inert` before it was maximized.
	let inerted: { element: HTMLElement; was: boolean }[] = [];
	/// The state the last `go` asked for, which `state()` reaches only once a view transition runs its update.
	let wanted: WindowState = "inline";
	/// The view transition in progress, if any.
	let transition: ViewTransition | null = null;

	/// Pins each sticky `[data-shell-bar]` where it sticks, as if the page had
	/// been scrolled past it, stretched over the content area. The padding
	/// grows by what the box grew, so the content stays put and only the
	/// background and borders widen.
	const pin = () => {
		const contentLeft =
			document.getElementById("content")?.getBoundingClientRect().left ?? 0;
		for (const element of document.querySelectorAll<HTMLElement>(
			"[data-shell-bar]",
		)) {
			const css = getComputedStyle(element);
			if (css.position !== "sticky") continue;
			const geometry = pinGeometry({
				paddingLeft: Number.parseFloat(css.paddingLeft),
				paddingRight: Number.parseFloat(css.paddingRight),
				rect: element.getBoundingClientRect(),
				contentLeft,
				// The viewport without the scrollbar, which goes away once the page stops scrolling.
				viewportRight: innerWidth,
			});
			const placeholder = document.createElement("div");
			placeholder.setAttribute("aria-hidden", "true");
			Object.assign(placeholder.style, {
				height: `${element.offsetHeight}px`,
				marginTop: css.marginTop,
				marginBottom: css.marginBottom,
				flexShrink: "0",
			});
			element.before(placeholder);
			pinned.push({
				element,
				style: element.getAttribute("style") ?? "",
				placeholder,
			});
			Object.assign(element.style, {
				position: "fixed",
				top: css.top,
				left: `${geometry.left}px`,
				right: "0",
				width: "auto",
				margin: "0",
				paddingLeft: `${geometry.paddingLeft}px`,
				paddingRight: `${geometry.paddingRight}px`,
			});
		}
	};

	const unpin = () => {
		for (const { element, style, placeholder } of pinned) {
			element.setAttribute("style", style);
			placeholder.remove();
		}
		pinned = [];
	};

	/// Makes inert whatever is in `#content` outside the window, except the
	/// shell bars and the ancestors of the window, so Tab does not reach what
	/// is hidden behind it.
	const isolate = () => {
		const content = document.getElementById("content");
		if (!content?.contains(section)) return;
		const path = new Set<Element>();
		for (
			let up = section.parentElement;
			up && up !== content;
			up = up.parentElement
		)
			path.add(up);
		const visit = (parent: Element) => {
			for (const child of parent.children) {
				if (!(child instanceof HTMLElement) || child === section) continue;
				if (child.matches("[data-shell-bar]")) continue;
				if (path.has(child) || child.querySelector("[data-shell-bar]"))
					visit(child);
				else {
					inerted.push({ element: child, was: child.inert });
					child.inert = true;
				}
			}
		};
		visit(content);
	};

	const restore = () => {
		for (const { element, was } of inerted) element.inert = was;
		inerted = [];
	};

	/// The page behind does not scroll while some other window than `except` is maximized.
	const syncOpenClass = (except?: Element) => {
		const others = [
			...document.querySelectorAll("[data-window-state=maximized]"),
		].filter((window) => window !== except);
		document.documentElement.classList.toggle(
			"editor-window-open",
			others.length > 0,
		);
	};

	/// The content area: below the navbar and the lowest pinned bar, right of the sidebar.
	const measure = () => {
		const bars = [
			document.querySelector(".navbar"),
			...pinned.map((p) => p.element),
		];
		setBox({
			top: windowTop(
				bars.map((bar) => bar?.getBoundingClientRect().bottom ?? 0),
			),
			left:
				document.getElementById("content")?.getBoundingClientRect().left ?? 0,
		});
	};

	const onResize = () => {
		if (state() !== "maximized") return;
		unpin();
		pin();
		measure();
	};

	const apply = (next: WindowState) => {
		wanted = next;
		if (next === state()) return;
		if (next === "maximized") {
			// Another maximized window goes back first, so its bars are free to pin.
			document.dispatchEvent(
				new CustomEvent("editor-window:maximize", { detail: id }),
			);
			setHeld(section.offsetHeight);
			pin();
			measure();
			isolate();
		}
		if (state() === "maximized") {
			unpin();
			restore();
		}
		setState(next);
		syncOpenClass();
		props.onStateChange?.(next);
	};

	const go = (next: WindowState) => {
		if (next === wanted) return;
		wanted = next;
		const viaMax = next === "maximized" || state() === "maximized";
		const settle = () => {
			if (next !== wanted) return;
			if (next === "maximized") props.onFocusEditor?.();
			else dots[DOTS.findIndex((dot) => dot.state === next)]?.focus();
		};
		const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
		// Inline and collapsed animate with CSS (the page below slides along);
		// whatever goes through maximized morphs with a view transition.
		if (!viaMax || reduced || !document.startViewTransition) {
			apply(next);
			settle();
			return;
		}
		section.style.setProperty("view-transition-name", `editor-window-${id}`);
		section.style.setProperty("view-transition-class", "editor-window");
		document.documentElement.classList.add("editor-window-morph");
		const mine = document.startViewTransition(() => apply(next));
		transition = mine;
		void mine.finished.finally(() => {
			// A later transition owns the name now.
			if (transition !== mine) return;
			transition = null;
			document.documentElement.classList.remove("editor-window-morph");
			section.style.removeProperty("view-transition-name");
			section.style.removeProperty("view-transition-class");
			settle();
		});
	};

	const onOtherMaximized = (event: Event) => {
		if (
			(event as CustomEvent<number>).detail !== id &&
			state() === "maximized"
		) {
			apply("inline");
		}
	};

	/// Red and green toggle between their state and inline; gray goes inline.
	const press = (target: WindowState) =>
		go(target === state() ? "inline" : target);

	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key !== "Escape" || state() !== "maximized") return;
		// Esc inside the editor belongs to the editor (completion, search, Esc+Tab).
		if ((event.target as Element).closest("[data-editor]")) return;
		go("inline");
	};

	/// Arrow keys move the focus along the dots, as in any toolbar.
	const onDotKey = (event: KeyboardEvent, index: number) => {
		const step =
			event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
		if (!step) return;
		event.preventDefault();
		const next = (index + step + DOTS.length) % DOTS.length;
		setFocusDot(next);
		dots[next]?.focus();
	};

	onMount(() => {
		document.addEventListener("editor-window:maximize", onOtherMaximized);
		addEventListener("resize", onResize);
		// Registered here, not at the top: cleanups also run in server rendering, where there is no DOM.
		onCleanup(() => {
			if (state() === "maximized") {
				unpin();
				restore();
				syncOpenClass(section);
			}
			document.removeEventListener("editor-window:maximize", onOtherMaximized);
			removeEventListener("resize", onResize);
		});
	});

	const maximized = () => state() === "maximized";
	const hidden = () => state() === "collapsed";
	const stem = () => (maximized() ? props.stem : undefined);

	return (
		<>
			<Show when={maximized()}>
				<div aria-hidden="true" style={{ height: `${held()}px` }} />
			</Show>
			<section
				ref={section}
				aria-label={props.filename}
				data-editor-window
				data-window-state={state()}
				onKeyDown={onKeyDown}
				class={`code-surface flex flex-col overflow-hidden bg-(--code-bg) text-(--code-fg) ${
					maximized()
						? "fixed right-0 bottom-0 z-[25] shadow-2xl"
						: "relative rounded-box border border-(--code-border)"
				}`}
				style={
					maximized() ? { top: `${box().top}px`, left: `${box().left}px` } : {}
				}
			>
				<header class="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-b border-(--code-border) bg-(--code-panel) px-2 py-1">
					<div role="toolbar" aria-label={m.runner_window_label()} class="flex">
						<For each={DOTS}>
							{(dot, index) => (
								<button
									ref={(el) => {
										dots[index()] = el;
									}}
									type="button"
									aria-pressed={
										dot.state === "inline" ? undefined : state() === dot.state
									}
									aria-label={dot.label()}
									title={dot.label()}
									tabindex={focusDot() === index() ? 0 : -1}
									data-action={`window-${dot.state}`}
									class="group grid size-6 place-items-center rounded-full outline-offset-0"
									onFocus={() => setFocusDot(index())}
									onClick={() => press(dot.state)}
									onKeyDown={(event) => onDotKey(event, index())}
								>
									<span
										class={`grid size-3 place-items-center rounded-full ${dot.color} ${
											state() === dot.state
												? "ring-2 ring-(--code-fg)/60 ring-offset-1 ring-offset-(--code-bg)"
												: ""
										}`}
									>
										<DotGlyph state={dot.state} />
									</span>
								</button>
							)}
						</For>
					</div>
					<span class="font-mono text-xs">{props.filename}</span>
					<span class="text-xs text-(--code-muted)" title={props.languageTitle}>
						{props.language}
					</span>
					<Show when={stem()}>
						<button
							type="button"
							class="btn btn-ghost btn-xs text-(--code-fg)"
							data-action="window-stem"
							aria-expanded={stemOpen()}
							onClick={() => setStemOpen(!stemOpen())}
						>
							{stemOpen()
								? m.runner_window_stem_hide()
								: m.runner_window_stem_show()}
						</button>
					</Show>
					<div class="ml-auto flex items-center gap-1.5">{props.actions}</div>
				</header>

				<div
					class={
						maximized()
							? "flex min-h-0 flex-1 flex-col lg:flex-row"
							: "contents"
					}
				>
					<Show when={stem()}>
						{(render) => (
							<Show when={stemOpen()}>
								<aside
									aria-label={m.runner_window_stem_show()}
									data-window-stem
									class="prose prose-sm max-h-[40%] max-w-none shrink-0 overflow-auto border-b border-(--code-border) bg-base-100 p-4 text-base-content lg:max-h-none lg:w-[38%] lg:border-r lg:border-b-0"
								>
									{render()()}
								</aside>
							</Show>
						)}
					</Show>
					{/* The editor and what goes under it share a column, beside the stem. */}
					<div
						class={
							maximized() ? "flex min-h-0 min-w-0 flex-1 flex-col" : "contents"
						}
					>
						{/* Collapsing animates the rows from 1fr to 0fr: the page below slides along. */}
						<div
							class={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
								maximized() ? "min-h-0 flex-1" : ""
							}`}
							style={{ "grid-template-rows": hidden() ? "0fr" : "1fr" }}
							inert={hidden()}
						>
							<div class="min-h-0 min-w-0 overflow-hidden">
								<div class={maximized() ? "h-full" : ""}>{props.children}</div>
							</div>
						</div>

						{/* Maximized, the output takes at most 30% of the window. */}
						<div
							class={
								maximized()
									? "flex max-h-[30%] min-h-0 shrink-0 flex-col"
									: "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
							}
							style={
								maximized()
									? {}
									: {
											"grid-template-rows":
												hidden() && !props.peek ? "0fr" : "1fr",
										}
							}
							inert={hidden() && !props.peek}
							data-window-below
						>
							<div
								class={
									maximized()
										? "flex min-h-0 flex-col"
										: "min-h-0 overflow-hidden"
								}
							>
								{props.below}
							</div>
						</div>
					</div>
				</div>
			</section>
		</>
	);
}

/// The glyph inside a dot, shown on hover and focus as in macOS.
function DotGlyph(props: { state: WindowState }): JSX.Element {
	return (
		<svg
			viewBox="0 0 12 12"
			aria-hidden="true"
			class="size-2.5 fill-none stroke-black/70 stroke-[1.5] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
		>
			{props.state === "inline" ? (
				<rect x="3" y="3" width="6" height="6" rx="1" />
			) : props.state === "collapsed" ? (
				<path d="M3 6h6" />
			) : (
				<path d="M4 8 8 4M5 4h3v3" />
			)}
		</svg>
	);
}
