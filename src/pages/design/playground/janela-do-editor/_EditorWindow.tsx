/**
 * Prototype of the editor window: daisyUI's code mockup whose three dots put
 * the editor inline, collapsed to a bar or maximized over the content area of
 * the app shell. Playground only; the real one goes into the runner.
 */

import type { LanguageId } from "@codehood/runner/protocol";
import {
	createSignal,
	For,
	type JSX,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { createEditor, type RunnerEditor } from "@/components/runner/editor";
import "./_window.css";

type WindowState = "inline" | "collapsed" | "maximized";

export interface EditorWindowProps {
	filename: string;
	language: LanguageId;
	code: string;
	/// HTML of the question stem, shown in a side panel when maximized.
	stemHtml?: string;
	/// Exam answer: Run pretests, Submit, its status and the "saved at" footer.
	exam?: boolean;
}

/// The dots, in order: the state each one leads to, its color and its name.
/// Red and green toggle: clicking the one of the current state goes back inline.
const DOTS: { state: WindowState; color: string; label: string }[] = [
	{ state: "inline", color: "bg-base-content/35", label: "Restaurar" },
	{ state: "collapsed", color: "bg-error", label: "Recolher editor" },
	{ state: "maximized", color: "bg-success", label: "Maximizar" },
];

/// A sticky bar pinned where it sticks while a window is maximized, so the
/// page scroll does not decide how much room the window gets.
interface Pinned {
	element: HTMLElement;
	style: string;
}

let windows = 0;

/// The sticky bars of the shell, which a bar declares with `data-shell-bar`.
/// The breadcrumb is listed by its own attribute until it carries this one.
function shellBars(): HTMLElement[] {
	return [
		...document.querySelectorAll<HTMLElement>(
			"[data-shell-bar], [data-breadcrumbs]",
		),
	];
}

/** A code editor in a window frame with three working dots. */
export default function EditorWindow(props: EditorWindowProps): JSX.Element {
	const id = ++windows;
	const [state, setState] = createSignal<WindowState>("inline");
	const [box, setBox] = createSignal({ top: 0, left: 0 });
	const [held, setHeld] = createSignal(0);
	const [stemOpen, setStemOpen] = createSignal(true);
	const [output, setOutput] = createSignal<string[] | null>(null);
	const [running, setRunning] = createSignal(false);
	const [sent, setSent] = createSignal(0);
	const [savedAt, setSavedAt] = createSignal<string | null>(null);
	let section!: HTMLElement;
	let editorParent!: HTMLDivElement;
	const dots: HTMLButtonElement[] = [];
	const [focusDot, setFocusDot] = createSignal(0);
	let editor: RunnerEditor | null = null;
	let pinned: Pinned[] = [];

	/// Pins each sticky bar of the shell where it sticks, as if the page had
	/// been scrolled past it, stretched over the whole content area. The
	/// padding grows by what the box grew, so the bar's content stays put and
	/// only its background and borders widen.
	const pin = () => {
		const content = document.getElementById("content")?.getBoundingClientRect();
		const left = content?.left ?? 0;
		// The viewport's edge without the scrollbar, which goes away once the
		// page stops scrolling: the window ends there too (`right: 0`).
		const right = innerWidth;
		for (const element of shellBars()) {
			const css = getComputedStyle(element);
			if (css.position !== "sticky") continue;
			const rect = element.getBoundingClientRect();
			pinned.push({ element, style: element.getAttribute("style") ?? "" });
			Object.assign(element.style, {
				position: "fixed",
				top: css.top,
				left: `${left}px`,
				right: "0",
				width: "auto",
				margin: "0",
				paddingLeft: `${Number.parseFloat(css.paddingLeft) + rect.left - left}px`,
				paddingRight: `${Number.parseFloat(css.paddingRight) + right - rect.right}px`,
			});
		}
	};

	const unpin = () => {
		for (const { element, style } of pinned)
			element.setAttribute("style", style);
		pinned = [];
	};

	/// The content area: below the navbar and the lowest pinned bar, right of the sidebar.
	const measure = () => {
		const bars = [
			document.querySelector(".navbar"),
			...pinned.map((p) => p.element),
		];
		const bottoms = bars.map((bar) => bar?.getBoundingClientRect().bottom ?? 0);
		const content = document.getElementById("content");
		setBox({
			top: Math.max(0, ...bottoms),
			left: content?.getBoundingClientRect().left ?? 0,
		});
	};

	const onResize = () => {
		if (state() !== "maximized") return;
		unpin();
		pin();
		measure();
	};

	const apply = (next: WindowState) => {
		if (next === "maximized") {
			setHeld(section.offsetHeight);
			pin();
			measure();
			document.dispatchEvent(
				new CustomEvent("editor-window:maximize", { detail: id }),
			);
		}
		if (state() === "maximized") unpin();
		setState(next);
		// The page behind does not scroll while a window is maximized.
		document.documentElement.classList.toggle(
			"editor-window-open",
			document.querySelector("[data-window-state=maximized]") !== null,
		);
	};

	const go = (next: WindowState, focusAfter = true) => {
		if (next === state()) return;
		const viaMax = next === "maximized" || state() === "maximized";
		const settle = () => {
			if (!focusAfter) return;
			if (next === "maximized") editor?.focus();
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
		const transition = document.startViewTransition(() => apply(next));
		void transition.finished.finally(() => {
			section.style.removeProperty("view-transition-name");
			section.style.removeProperty("view-transition-class");
			settle();
		});
	};

	const onOtherMaximized = (event: Event) => {
		if ((event as CustomEvent<number>).detail !== id && state() === "maximized")
			apply("inline");
	};

	/// Red and green toggle between their state and inline; gray goes inline.
	const press = (target: WindowState) =>
		go(target === state() ? "inline" : target);

	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key !== "Escape" || state() !== "maximized") return;
		// Esc inside the editor belongs to the editor (completion, search, Esc+Tab).
		if ((event.target as Element).closest(".cm-editor")) return;
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

	const run = (pretests = false) => {
		setRunning(true);
		setOutput(null);
		setTimeout(() => {
			setRunning(false);
			setOutput(
				pretests
					? [
							"✓ soma([1, 2, 3]) == 6",
							"✓ soma([]) == 0",
							"✗ soma([-1, 1]) == 0: devolveu 2",
						]
					: props.exam
						? ["6"]
						: ["Olá, mundo!", "3 linhas lidas"],
			);
		}, 500);
	};

	onMount(() => {
		void createEditor({
			parent: editorParent,
			doc: props.code,
			language: props.language,
			readOnly: false,
			label: props.filename,
			tabHint: "Tab indenta. Para sair do editor, pressione Esc e depois Tab.",
			onChange: () =>
				setSavedAt(
					new Date().toLocaleTimeString("pt-BR", {
						hour: "2-digit",
						minute: "2-digit",
					}),
				),
			onRun: () => run(),
			onFocus: () => {},
		}).then((created) => {
			editor = created;
		});
		document.addEventListener("editor-window:maximize", onOtherMaximized);
		addEventListener("resize", onResize);
		onCleanup(() => {
			editor?.destroy();
			unpin();
			document.removeEventListener("editor-window:maximize", onOtherMaximized);
			removeEventListener("resize", onResize);
		});
	});

	const maximized = () => state() === "maximized";

	return (
		<>
			<Show when={maximized()}>
				<div aria-hidden="true" style={{ height: `${held()}px` }} />
			</Show>
			<section
				ref={section}
				aria-label={props.filename}
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
					<div role="toolbar" aria-label="Janela do editor" class="flex">
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
									aria-label={dot.label}
									title={dot.label}
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
					<span class="text-xs text-(--code-muted)">{props.language}</span>
					<Show when={props.stemHtml && maximized()}>
						<button
							type="button"
							class="btn btn-ghost btn-xs text-(--code-fg)"
							aria-expanded={stemOpen()}
							onClick={() => setStemOpen(!stemOpen())}
						>
							{stemOpen() ? "Esconder enunciado" : "Enunciado"}
						</button>
					</Show>
					<div class="ml-auto flex items-center gap-1.5">
						<button
							type="button"
							class="btn btn-ghost btn-sm btn-square text-success hover:bg-(--code-selection)"
							data-action="run"
							aria-label="Rodar"
							title="Rodar (Ctrl+Enter)"
							onClick={() => run()}
							disabled={running()}
						>
							{running() ? (
								<span class="loading loading-spinner loading-xs" />
							) : (
								<svg
									viewBox="0 0 24 24"
									class="size-4 fill-current"
									aria-hidden="true"
								>
									<path d="M7 4.5v15l12-7.5z" />
								</svg>
							)}
						</button>
						<Show when={props.exam}>
							<button
								type="button"
								class="btn btn-ghost btn-xs text-(--code-fg) hover:bg-(--code-selection)"
								data-action="pretests"
								onClick={() => run(true)}
								disabled={running()}
							>
								Executar pré-testes
							</button>
						</Show>
						<Show when={props.exam}>
							<button
								type="button"
								class="btn btn-outline btn-xs border-(--code-border) text-(--code-fg)"
								onClick={() => setSent(sent() + 1)}
							>
								Enviar
							</button>
						</Show>
					</div>
				</header>

				{/* Collapsing animates the rows from 1fr to 0fr: the page below slides along. */}
				<div
					class={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
						maximized() ? "min-h-0 flex-1" : ""
					}`}
					style={{
						"grid-template-rows": state() === "collapsed" ? "0fr" : "1fr",
					}}
				>
					<div
						class={`flex min-h-0 overflow-hidden ${maximized() ? "flex-col lg:flex-row" : ""}`}
					>
						<Show when={props.stemHtml && maximized() && stemOpen()}>
							<aside
								aria-label="Enunciado"
								class="prose prose-sm max-h-[40%] shrink-0 overflow-auto border-b border-(--code-border) bg-base-100 p-4 text-base-content lg:max-h-none lg:w-[38%] lg:border-r lg:border-b-0"
								innerHTML={props.stemHtml}
							/>
						</Show>
						<div
							class={`min-w-0 flex-1 overflow-auto font-mono text-(length:--code-font-size) leading-5 ${
								maximized() ? "[&_.cm-editor]:h-full" : "max-h-96"
							}`}
						>
							<div ref={editorParent} class="h-full" />
						</div>
					</div>
				</div>

				<Show when={output()}>
					{(lines) => (
						<div
							class={`border-t border-(--code-border) bg-(--code-panel) px-3 py-2 font-mono text-xs ${
								maximized() ? "max-h-[30%] overflow-auto" : ""
							}`}
							data-window-output
						>
							<For each={lines()}>{(line) => <div>{line}</div>}</For>
						</div>
					)}
				</Show>

				<Show when={props.exam}>
					<footer class="flex flex-wrap items-baseline gap-x-3 border-t border-(--code-border) px-3 py-1.5 text-xs text-(--code-muted)">
						<span role="status">
							{sent() === 0
								? "Envios: 0 de 3. O próximo vale 100%."
								: `Envio ${sent()} de 3 recebido. Correção na fila.`}
						</span>
						<span class="ml-auto">
							{savedAt() ? `Salvo às ${savedAt()}` : "Nada alterado ainda"}
						</span>
					</footer>
				</Show>
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
