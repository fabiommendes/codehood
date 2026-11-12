/**
 * Code runner widget: editor, Run/Stop, terminal, status line.
 *
 * One component for the three modes; the differences are in the props and
 * in the `toolbar`/`footer` slots each mode's page fills. All widgets of a
 * page share one runner iframe through `RunnerHost.shared(runnerOrigin)`.
 */

import {
	type RunExit,
	type RunHandle,
	type RunHandlers,
	RunnerHost,
	RunnerUnavailable,
} from "@codehood/runner/host";
import type { LanguageId, RunMode } from "@codehood/runner/protocol";
import {
	createEffect,
	createSignal,
	For,
	type JSX,
	on,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { isServer } from "solid-js/web";
import { m } from "@/i18n";
import {
	defaultFilename,
	defaultRunMode,
	languageLabel,
	restartNote as languageRestartNote,
} from "@/runner/languages";
import { createEditor, type RunnerEditor } from "./editor";
import {
	canRun,
	type IdeEvent,
	type IdePhase,
	initialIdeState,
	isBusy,
	reduceIde,
} from "./ide-state";
import { runForSubmission } from "./review-host";
import { createTerminal, type RunnerTerminal } from "./terminal";

/**
 * Where the widget is used.
 *
 * `snippet`: course material; read-only until "Edit", "Reset" brings the
 * original back, nothing is saved. `answer`: an exam answer; always editable,
 * every edit goes to `onChange`, running may be off (`runDisabled`).
 * `review`: a submission seen by the instructor; read-only until "Edit copy",
 * the copy lives in memory only and its output is marked "modified".
 */
export type CodeRunnerMode = "snippet" | "answer" | "review";

export interface CodeRunnerProps {
	mode: CodeRunnerMode;
	language: LanguageId;
	/// Initial source. In `answer` mode, the saved answer.
	code: string;
	/// File name in the toolbar and the run's entry; `defaultFilename(language)` when absent.
	filename?: string;
	/// Accessible name of the editor, e.g. the resource title.
	label: string;
	/// From `RUNNER_ORIGIN`; null shows the `unconfigured` state.
	runnerOrigin: string | null;
	/// `script` runs the file once; `repl` loads it and opens the toplevel.
	runMode?: RunMode;
	/// Server-highlighted HTML of `code` (Shiki, `highlightCode` with the
	/// `vscode` theme, `dark-plus` like the editor),
	/// shown until the editor mounts and in server rendering. Trusted: never
	/// user HTML.
	highlightedHtml?: string;
	/// Answer mode: running is off for this exam (`canRunCode` false).
	runDisabled?: boolean;
	/// Answer mode: called with the full source after each edit, and the CodeMirror user event behind it when known.
	onChange?: (code: string, userEvent?: string) => void;
	/// Answer mode: the starting code "back to the starter code" restores.
	starterCode?: string;
	/// Review mode: the public id of the submission, as `runForSubmission`
	/// takes it. A run of another submission gets a new sandbox.
	submission?: string;
	/// Review mode: what the card is called in the navigation, "Answer 3" or a student's name.
	reviewLabel?: string;
	/// Shorter editor and terminal hidden until the first run (lists, exams).
	compact?: boolean;
	/// Extra controls at the start of the toolbar (review: submission navigation).
	toolbar?: JSX.Element;
	/// Content under the terminal (answer: autosave status, draft conflict).
	footer?: JSX.Element;
}

/// Counts the Run clicks of review widgets on this page, so a click made
/// while an earlier one still loads the terminal wins over it.
let reviewClicks = 0;

/// The review widgets of the page, in document order.
function reviewWidgets(): HTMLElement[] {
	return [
		...document.querySelectorAll<HTMLElement>(
			"[data-code-runner][data-mode=review]",
		),
	];
}

/// How long "Preparing…" shows before it becomes "Still loading…".
const SLOW_PREPARING_MS = 3000;

/// Phases where running is impossible rather than merely paused.
const BLOCKED: ReadonlySet<IdePhase> = new Set([
	"disabled",
	"unsupported",
	"unconfigured",
]);

/// Text of the terminal header's status for a phase, or null when it has none.
function phaseText(
	phase: IdePhase,
	lastExit: RunExit | null,
	slow: boolean,
): string | null {
	switch (phase) {
		case "preparing":
			return slow ? m.runner_preparing_slow() : m.runner_preparing();
		case "running":
			return m.runner_status_running();
		case "waiting-input":
			return m.runner_status_waiting_input();
		case "done":
			return m.runner_status_done();
		case "error":
			return lastExit?.reason === "crashed"
				? m.runner_status_crashed()
				: m.runner_status_error({ code: String(lastExit?.code ?? "?") });
		case "stopped":
			return lastExit?.reason === "reloaded"
				? m.runner_status_reloaded()
				: m.runner_status_stopped();
		case "truncated":
			return m.runner_status_truncated();
		default:
			return null;
	}
}

/**
 * Renders the widget.
 *
 * Server rendering and first paint show `highlightedHtml` (or the plain
 * code) in a `<pre>`. CodeMirror (VS Code theme and keymap) is loaded with
 * dynamic `import()` and mounted when the editor is first focused or made
 * editable, and right away in `answer` mode; xterm.js likewise on the first
 * run. Neither is ever imported statically. The first focus or edit calls
 * `RunnerHost.prepare(language)`, unless running is off. A run sends the
 * current source as `{ [filename]: code }` with `entry: filename`.
 *
 * "Try again" after `load-failed` starts a new run from this widget only; it
 * never calls `reload()` on the shared host, which would stop other
 * widgets' runs.
 *
 * Keyboard: Ctrl/Cmd+Enter runs, bound with `Prec.highest` so the VS Code
 * keymap cannot take it; Ctrl+C in the terminal stops; Ctrl+D sends end of
 * input. On coarse pointers, input goes through a text field fixed above the
 * on-screen keyboard instead of typing into the terminal; the field's text
 * is echoed through `RunnerTerminal.echoInput`, and any text the widget puts
 * in the DOM itself goes through `textContent`, never `innerHTML`.
 */
export function CodeRunner(props: CodeRunnerProps): JSX.Element {
	// Thrown on the client only: during server rendering it would stall the page.
	if (!isServer && props.mode === "review" && !props.submission) {
		throw new Error("CodeRunner in review mode needs a submission id");
	}
	const filename = () => props.filename ?? defaultFilename(props.language);
	const [state, setState] = createSignal(
		initialIdeState({
			runnerOrigin: props.runnerOrigin,
			runDisabled: props.runDisabled ?? false,
		}),
	);
	const dispatch = (event: IdeEvent) =>
		setState((current) => reduceIde(current, event));
	const [code, setCode] = createSignal(props.code);
	const [editing, setEditing] = createSignal(props.mode === "answer");
	const [editorReady, setEditorReady] = createSignal(false);
	/// The last run started from a modified copy (review mode).
	const [runModified, setRunModified] = createSignal(false);
	/// Review mode: position among the review widgets of the page, known once mounted.
	const [position, setPosition] = createSignal<{
		index: number;
		total: number;
	} | null>(null);
	/// Course material: no toolbar, code in a window frame, a round Run under
	/// it, and the terminal hidden until the first run.
	const minimal = props.mode === "snippet";
	const [terminalShown, setTerminalShown] = createSignal(
		!props.compact && !minimal,
	);
	const [terminalReady, setTerminalReady] = createSignal(false);
	const [coarse, setCoarse] = createSignal(false);
	const [slowPreparing, setSlowPreparing] = createSignal(false);
	/// Pixels the on-screen keyboard covers at the bottom of the layout viewport.
	const [keyboardInset, setKeyboardInset] = createSignal(0);

	let root!: HTMLDivElement;
	let editorParent!: HTMLDivElement;
	let terminalParent!: HTMLDivElement;
	let lineInput: HTMLInputElement | undefined;
	let runButton: HTMLButtonElement | undefined;
	/// The user pressed Stop and the run has not ended yet.
	let stopping = false;
	let editor: RunnerEditor | null = null;
	let editorLoading: Promise<void> | null = null;
	let terminal: RunnerTerminal | null = null;
	let terminalLoading: Promise<RunnerTerminal> | null = null;
	let disposed = false;
	let prepared = false;
	/// Identifies the run in progress; events of any other are ignored.
	let current: object | null = null;
	let active: RunHandle | null = null;
	let startedAt = 0;
	let reading = false;

	/// Digits of the largest line number, to size the static view's gutter.
	const digits = () => String(props.code.split("\n").length).length;
	const readOnly = () => props.mode !== "answer" && !editing();
	const blocked = () => BLOCKED.has(state().phase);
	const running = () => isBusy(state());
	const review = () => props.mode === "review";
	/// Review mode: the copy in memory differs from the submission.
	const modified = () => review() && code() !== props.code;

	/// Asks the runner for a reserve Worker, once, on the first focus or edit.
	const prepare = () => {
		if (review() || prepared || blocked() || props.runnerOrigin === null)
			return;
		prepared = true;
		RunnerHost.shared(props.runnerOrigin).prepare(props.language);
	};

	const ensureEditor = (focus: boolean): Promise<void> => {
		editorLoading ??= createEditor({
			parent: editorParent,
			doc: code(),
			language: props.language,
			readOnly: readOnly(),
			label: props.label,
			tabHint: m.runner_editor_tab_hint(),
			onChange: (value, userEvent) => {
				setCode(value);
				prepare();
				if (!review()) props.onChange?.(value, userEvent);
			},
			onRun: () => void run(),
			onFocus: prepare,
		}).then(
			(created) => {
				if (disposed) {
					created.destroy();
					return;
				}
				editor = created;
				editor.setReadOnly(readOnly());
				setEditorReady(true);
			},
			() => {
				editorLoading = null;
			},
		);
		return editorLoading.then(() => {
			if (focus) editor?.focus();
		});
	};

	const activate = () => {
		prepare();
		void ensureEditor(true);
	};

	const edit = () => {
		setEditing(true);
		prepare();
		void ensureEditor(true).then(() => editor?.setReadOnly(false));
	};

	const reset = () => {
		const original =
			props.mode === "answer" ? (props.starterCode ?? "") : props.code;
		setCode(original);
		editor?.setCode(original);
		if (props.mode === "answer") props.onChange?.(original);
	};

	/// Review mode: scrolls to the card of the previous or next review widget and focuses its Run button.
	const go = (step: -1 | 1) => {
		const target = reviewWidgets()[(position()?.index ?? 0) + step];
		const card = target?.closest<HTMLElement>("[id^=answer-]");
		if (!target || !card) return;
		location.hash = card.id;
		target.querySelector<HTMLButtonElement>("[data-action=run]")?.focus();
	};

	/// Review mode: discards the copy and shows the submission again, read-only.
	const backToSubmission = () => {
		setCode(props.code);
		setEditing(false);
		editor?.setCode(props.code);
		editor?.setReadOnly(true);
	};

	const ensureTerminal = (): Promise<RunnerTerminal> => {
		if (terminal) return Promise.resolve(terminal);
		setTerminalShown(true);
		terminalLoading ??= createTerminal(
			terminalParent,
			props.compact ? { autoHeight: { minRows: 3, maxRows: 10 } } : {},
		).then(
			(created) => {
				if (disposed) {
					created.dispose();
					return created;
				}
				terminal = created;
				created.onInterrupt(() => active?.stop());
				setTerminalReady(true);
				return created;
			},
			(error: unknown) => {
				terminalLoading = null;
				throw error;
			},
		);
		return terminalLoading;
	};

	/// Reads the next line typed in the terminal and sends it to the program.
	const startRead = () => {
		const term = terminal;
		const handle = active;
		const token = current;
		if (!term || !handle || reading || coarse()) return;
		reading = true;
		term.focus();
		void term.readLine().then((line) => {
			if (current !== token) return;
			reading = false;
			if (line === null) handle.sendEof();
			else handle.sendLine(line);
		});
	};

	const run = async () => {
		if (!canRun(state()) || props.runnerOrigin === null) return;
		const token = {};
		current = token;
		stopping = false;
		startedAt = performance.now();
		const click = review() ? ++reviewClicks : 0;
		const copy = modified();
		setRunModified(copy);
		dispatch({ type: "run-requested" });
		if (terminal) setTerminalShown(true);
		editor?.showDiagnostics([]);
		const finish = (exit: RunExit) => {
			if (current !== token) return;
			current = null;
			active = null;
			reading = false;
			terminal?.cancelRead();
			const marks = exit.diagnostics?.filter((d) => d.file === filename());
			if (marks?.length) editor?.showDiagnostics(marks);
			dispatch({
				type: "exit",
				exit,
				elapsedMs: performance.now() - startedAt,
			});
			returnFocusToRun();
		};
		try {
			const term = await ensureTerminal();
			if (current !== token) return;
			if (review() && click !== reviewClicks) {
				finish({ reason: "stopped", code: null });
				return;
			}
			term.clear();
			if (copy) term.notice(m.runner_modified_output());
			const entry = filename();
			const request = {
				language: props.language,
				mode: props.runMode ?? defaultRunMode(props.language),
				files: { [entry]: code() },
				entry,
			};
			const handlers: RunHandlers = {
				onStatus: (value) => {
					if (current !== token) return;
					dispatch({ type: "status", state: value });
					if (value === "waiting-input") startRead();
				},
				onProgress: (loaded, total) => {
					if (current === token) dispatch({ type: "progress", loaded, total });
				},
				onOutput: (stream, text) => {
					if (current === token) terminal?.write(stream, text);
				},
			};
			const handle = await (review()
				? runForSubmission(
						props.runnerOrigin,
						props.submission as string,
						request,
						handlers,
					)
				: RunnerHost.shared(props.runnerOrigin).run(request, handlers));
			if (current !== token) {
				handle.stop();
				return;
			}
			active = handle;
			finish(await handle.done);
		} catch (error) {
			if (current !== token) return;
			if (error instanceof RunnerUnavailable) {
				current = null;
				dispatch({ type: "unavailable", reason: error.reason });
			} else {
				finish({
					reason: "load-failed",
					code: null,
					message: error instanceof Error ? error.message : String(error),
				});
			}
		}
	};

	/// Puts the focus back on Run once a run the user stopped has ended, since the Stop button that had it is gone.
	const returnFocusToRun = () => {
		if (!stopping) return;
		stopping = false;
		runButton?.focus();
	};

	const stop = () => {
		stopping = true;
		if (active) {
			active.stop();
			return;
		}
		if (current !== null) {
			// Still preparing: nothing runs yet, so there is nothing to wait for.
			current = null;
			dispatch({
				type: "exit",
				exit: { reason: "stopped", code: null },
				elapsedMs: performance.now() - startedAt,
			});
		}
		returnFocusToRun();
	};

	/// Snippet mode: stops the run, if any, and folds the terminal away.
	const hideTerminal = () => {
		if (running()) stop();
		setTerminalShown(false);
		runButton?.focus();
	};

	const sendLine = (event: SubmitEvent) => {
		event.preventDefault();
		if (!lineInput || !active) return;
		const line = lineInput.value;
		lineInput.value = "";
		terminal?.echoInput(line);
		active.sendLine(line);
	};

	onMount(() => {
		setCoarse(window.matchMedia("(pointer: coarse)").matches);
		if (review()) {
			const widgets = reviewWidgets();
			setPosition({ index: widgets.indexOf(root), total: widgets.length });
		}
		if (props.mode === "answer") void ensureEditor(false);
	});

	onCleanup(() => {
		disposed = true;
		current = null;
		active?.stop();
		terminal?.dispose();
		editor?.destroy();
	});

	createEffect(() => {
		const viewport = window.visualViewport;
		if (!viewport || !coarse() || state().phase !== "waiting-input") return;
		const update = () =>
			setKeyboardInset(
				Math.max(0, window.innerHeight - viewport.offsetTop - viewport.height),
			);
		update();
		viewport.addEventListener("resize", update);
		viewport.addEventListener("scroll", update);
		onCleanup(() => {
			viewport.removeEventListener("resize", update);
			viewport.removeEventListener("scroll", update);
		});
	});

	createEffect(() => {
		if (state().phase !== "preparing") {
			setSlowPreparing(false);
			return;
		}
		const timer = setTimeout(() => setSlowPreparing(true), SLOW_PREPARING_MS);
		onCleanup(() => clearTimeout(timer));
	});

	createEffect(
		on(
			() => state().phase,
			(phase) => {
				if (phase === "waiting-input" && coarse()) lineInput?.focus();
			},
			{ defer: true },
		),
	);

	const onStaticKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			void run();
		}
	};

	const statusText = () =>
		phaseText(state().phase, state().lastExit, slowPreparing());
	const duration = () => {
		const exit = state().lastExit;
		return state().phase === "done" && exit
			? m.runner_duration({ seconds: (exit.elapsedMs / 1000).toFixed(1) })
			: null;
	};
	const percent = () => {
		const progress = state().progress;
		return progress?.total
			? Math.round((progress.loaded / progress.total) * 100)
			: null;
	};
	const blockedMessage = () => {
		switch (state().phase) {
			case "disabled":
				return m.runner_disabled();
			case "unsupported":
				return m.runner_unsupported();
			case "unconfigured":
				return m.runner_unconfigured();
			default:
				return null;
		}
	};

	const restartNote = () => languageRestartNote(props.language);

	const progressBar = () => (
		<Show when={state().phase === "preparing" && state().progress}>
			<div
				class={`flex items-center gap-3 px-3 py-2 text-xs ${minimal ? "" : "border-b border-base-300 bg-base-200/30"}`}
			>
				<span class="shrink-0">{m.runner_downloading()}</span>
				<progress
					class="progress progress-primary h-1.5 flex-1"
					value={state().progress?.loaded}
					max={state().progress?.total ?? undefined}
				/>
				<Show when={percent() !== null}>
					<span class="shrink-0 tabular-nums text-muted">{percent()}%</span>
				</Show>
			</div>
		</Show>
	);

	const blockedNotice = () => (
		<Show when={blockedMessage()}>
			{(message) => (
				<p
					role="status"
					class={`flex items-center gap-2 px-3 py-2 text-xs text-base-content/70 ${minimal ? "justify-center" : "border-b border-base-300 bg-base-200/30"}`}
				>
					{message()}
				</p>
			)}
		</Show>
	);

	return (
		<div
			ref={root}
			class={
				minimal
					? `flex flex-col transition-[padding] duration-300 ${terminalShown() ? "" : "pb-5"}`
					: "overflow-hidden rounded-box border border-base-300 bg-base-100"
			}
			data-code-runner
			data-submission={props.submission}
			data-mode={props.mode}
			data-phase={state().phase}
		>
			<Show when={!minimal}>
				<div class="flex flex-wrap items-center gap-2 border-b border-base-300 bg-base-200/50 px-3 py-1.5">
					{props.toolbar}
					<Show when={position()}>
						{(at) => (
							<Show when={at().total > 1}>
								<div class="flex items-center gap-1" data-review-nav>
									<button
										type="button"
										class="btn btn-ghost btn-xs"
										data-action="previous"
										aria-label={m.runner_review_previous()}
										disabled={at().index <= 0}
										onClick={() => go(-1)}
									>
										‹
									</button>
									<button
										type="button"
										class="btn btn-ghost btn-xs"
										data-action="next"
										aria-label={m.runner_review_next()}
										disabled={at().index >= at().total - 1}
										onClick={() => go(1)}
									>
										›
									</button>
									<span class="text-xs tabular-nums" data-role="position">
										{m.runner_review_position({
											n: String(at().index + 1),
											total: String(at().total),
										})}
									</span>
									<Show when={props.reviewLabel}>
										<span
											class="text-xs font-semibold"
											data-role="review-label"
										>
											{props.reviewLabel}
										</span>
									</Show>
								</div>
							</Show>
						)}
					</Show>
					<Show when={review()}>
						<span
							class="hidden text-xs text-muted lg:inline"
							data-role="review-hint"
						>
							{m.runner_review_hint()}
						</span>
					</Show>
					<span class="font-mono text-xs">{filename()}</span>
					<span class="badge badge-ghost badge-xs">
						{languageLabel(props.language)}
					</span>
					<Show when={readOnly()}>
						<span class="badge badge-ghost badge-xs">
							{m.runner_read_only()}
						</span>
						<Show when={!review()}>
							<span class="hidden text-xs text-muted sm:inline">
								{m.runner_edit_hint()}
							</span>
						</Show>
					</Show>
					<Show when={modified()}>
						<span class="badge badge-warning badge-xs" data-role="modified">
							{m.runner_modified()}
						</span>
						<span class="text-xs text-muted" data-role="copy-hint">
							{m.runner_copy_hint()}
						</span>
					</Show>
					<div class="ml-auto flex items-center gap-1.5">
						<Show when={props.mode !== "answer" && !editing()}>
							<button
								type="button"
								class="btn btn-ghost btn-sm"
								data-action="edit"
								onClick={edit}
							>
								{review() ? m.runner_edit_copy() : m.runner_edit()}
							</button>
						</Show>
						<Show when={modified()}>
							<button
								type="button"
								class="btn btn-ghost btn-sm"
								data-action="back"
								onClick={backToSubmission}
							>
								{m.runner_back_to_submission()}
							</button>
						</Show>
						<Show when={props.mode !== "answer" && !review() && editing()}>
							<button
								type="button"
								class="btn btn-ghost btn-sm"
								data-action="reset"
								onClick={reset}
							>
								{m.runner_reset()}
							</button>
						</Show>
						<Show
							when={props.mode === "answer" && props.starterCode !== undefined}
						>
							<button
								type="button"
								class="btn btn-ghost btn-sm"
								data-action="reset"
								title={m.runner_reset_starter()}
								onClick={reset}
							>
								{m.runner_reset()}
							</button>
						</Show>
						<Show
							when={running()}
							fallback={
								<button
									ref={runButton}
									type="button"
									class="btn btn-soft btn-success btn-sm"
									data-action="run"
									disabled={!canRun(state())}
									onClick={() => void run()}
								>
									<svg
										viewBox="0 0 16 16"
										class="size-3 fill-current"
										aria-hidden="true"
									>
										<path d="M4 2.5v11l9-5.5z" />
									</svg>
									{review() ? m.runner_run_submission() : m.runner_run()}
								</button>
							}
						>
							<button
								type="button"
								class="btn btn-soft btn-error btn-sm"
								data-action="stop"
								onClick={stop}
							>
								<Show
									when={state().phase === "preparing"}
									fallback={
										<span
											class="inline-block size-2.5 bg-current"
											aria-hidden="true"
										/>
									}
								>
									<span class="loading loading-spinner loading-xs" />
								</Show>
								{state().phase === "preparing"
									? m.runner_cancel()
									: m.runner_stop()}
							</button>
						</Show>
						<Show when={restartNote()}>
							{(note) => (
								<span
									class="text-xs text-base-content/60"
									data-role="restart-note"
								>
									{note()}
								</span>
							)}
						</Show>
					</div>
				</div>

				{progressBar()}
				{blockedNotice()}
			</Show>

			{/* The focus ring is an overlay of this wrapper: an outline on the
			    scrolling box would be painted under the editor's sticky gutter.
			    In a snippet the wrapper is daisyUI's code mockup, with its dots
			    and without the gap it puts before each `pre`. */}
			<div
				class={`relative after:pointer-events-none after:absolute after:inset-0 after:z-[300] after:rounded-[inherit] after:transition-shadow after:content-[''] focus-within:after:shadow-[inset_0_0_0_1px_#569cd666,inset_0_0_14px_#569cd633] ${minimal ? `${terminalShown() ? "rounded-b-none" : ""} mockup-code overflow-hidden bg-[#1e1e1e] pt-3 pb-1 text-[#d4d4d4] before:mb-2 before:ml-1 [&_pre]:before:hidden` : ""}`}
			>
				<Show when={minimal}>
					<div class="absolute top-1.5 right-2 z-10 flex items-center gap-1">
						<Show when={!editing()}>
							<button
								type="button"
								class="btn btn-ghost btn-xs btn-square text-[#a0a0a0] hover:bg-[#ffffff14] hover:text-[#d4d4d4]"
								data-action="edit"
								aria-label={m.runner_edit()}
								title={m.runner_edit_hint()}
								onClick={edit}
							>
								<svg
									viewBox="0 0 24 24"
									class="size-3.5 fill-none stroke-current stroke-2"
									aria-hidden="true"
								>
									<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
								</svg>
							</button>
						</Show>
						<Show when={editing()}>
							<button
								type="button"
								class="btn btn-ghost btn-xs btn-square text-[#a0a0a0] hover:bg-[#ffffff14] hover:text-[#d4d4d4]"
								data-action="reset"
								aria-label={m.runner_reset()}
								title={m.runner_reset()}
								onClick={reset}
							>
								<svg
									viewBox="0 0 24 24"
									class="size-3.5 fill-none stroke-current stroke-2"
									aria-hidden="true"
								>
									<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />
								</svg>
							</button>
						</Show>
					</div>
				</Show>
				<div
					class={`relative overflow-auto bg-[#1e1e1e] font-mono text-[13px] leading-5 text-[#d4d4d4] ${props.compact ? "max-h-56" : "max-h-96"}`}
				>
					<Show when={!editorReady()}>
						{/* biome-ignore lint/a11y/useSemanticElements: a read-only code view, replaced by the editor on first focus */}
						<div
							role="group"
							tabindex="0"
							aria-label={
								readOnly()
									? m.runner_editor_label_read_only({
											label: props.label,
											filename: filename(),
											language: languageLabel(props.language),
										})
									: m.runner_editor_label({
											label: props.label,
											filename: filename(),
											language: languageLabel(props.language),
										})
							}
							data-editor-static
							onFocus={activate}
							onKeyDown={onStaticKeyDown}
						>
							<Show
								when={props.highlightedHtml}
								fallback={
									<pre
										class="m-0 px-0 py-2 whitespace-pre"
										data-line-numbers
										style={{ "--digits": digits() }}
									>
										<code>
											<For each={props.code.split("\n")}>
												{(line) => (
													<>
														<span class="line">{line}</span>
														{"\n"}
													</>
												)}
											</For>
										</code>
									</pre>
								}
							>
								{/* Server-highlighted HTML of the code (Shiki), trusted. */}
								<div
									class="[&_pre]:m-0 [&_pre]:overflow-visible [&_pre]:bg-transparent [&_pre]:px-0 [&_pre]:py-2"
									data-line-numbers
									style={{ "--digits": digits() }}
									innerHTML={props.highlightedHtml}
								/>
							</Show>
						</div>
					</Show>
					<div
						ref={editorParent}
						class={editorReady() ? "" : "hidden"}
						data-editor
					/>
				</div>
			</div>

			<Show when={minimal}>
				{/* No height of its own: the button hangs over the bottom edge of
				    the code, or over the seam with the terminal once it shows. */}
				<div class="relative z-[310] flex h-0 justify-center">
					<div
						class={`-mt-5 h-10 ${restartNote() ? "tooltip tooltip-right" : ""}`}
						data-tip={restartNote() ?? undefined}
					>
						<Show
							when={running()}
							fallback={
								<button
									ref={runButton}
									type="button"
									class="btn btn-circle btn-success shadow-md"
									data-action="run"
									aria-label={m.runner_run()}
									disabled={!canRun(state())}
									onClick={() => void run()}
								>
									<svg
										viewBox="0 0 16 16"
										class="ml-0.5 size-4 fill-current"
										aria-hidden="true"
									>
										<path d="M4 2.5v11l9-5.5z" />
									</svg>
								</button>
							}
						>
							<button
								type="button"
								class="btn btn-circle btn-error shadow-md"
								data-action="stop"
								aria-label={
									state().phase === "preparing"
										? m.runner_cancel()
										: m.runner_stop()
								}
								onClick={stop}
							>
								<Show
									when={state().phase === "preparing"}
									fallback={
										<span
											class="inline-block size-3 rounded-[2px] bg-current"
											aria-hidden="true"
										/>
									}
								>
									<span class="loading loading-spinner loading-sm" />
								</Show>
							</button>
						</Show>
					</div>
				</div>
				{progressBar()}
				{blockedNotice()}
			</Show>

			<div
				class={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${terminalShown() ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
				inert={!terminalShown()}
			>
				<div
					class={`min-h-0 overflow-hidden bg-[#181818] font-mono text-[13px] leading-5 ${minimal ? "rounded-b-box" : ""} border-t border-[#3c3c3c]`}
				>
					<div class="flex items-center gap-2 bg-[#252526] px-3 py-1 text-[11px] tracking-wide text-[#a0a0a0] uppercase">
						<span>{m.runner_terminal()}</span>
						<span
							role="status"
							aria-live="polite"
							class="ml-auto flex items-center gap-1.5 tracking-normal normal-case"
							data-status
							data-exit-code={
								state().phase === "done" || state().phase === "error"
									? String(state().lastExit?.code ?? "")
									: undefined
							}
						>
							<Show
								when={review() && runModified() && state().phase !== "idle"}
							>
								<span class="badge badge-warning badge-xs" data-run-modified>
									{m.runner_modified()}
								</span>
							</Show>
							<Show when={statusText()}>
								{(text) => (
									<span
										class={`flex items-center gap-1.5 ${
											state().phase === "running"
												? "text-[#89d185]"
												: state().phase === "waiting-input" ||
														state().phase === "truncated"
													? "text-[#e5c07b]"
													: state().phase === "error"
														? "text-[#f48771]"
														: "text-[#858585]"
										}`}
									>
										{/* Not while waiting for input: the program waits on
										    the user, and a spinner would say the opposite. */}
										<Show
											when={
												state().phase === "running" ||
												state().phase === "preparing"
											}
										>
											<span class="loading loading-spinner loading-xs" />
										</Show>
										{text()}
									</span>
								)}
							</Show>
							<Show when={duration()}>
								{(text) => <span class="text-[#858585]">· {text()}</span>}
							</Show>
						</span>
						<Show when={minimal}>
							<button
								type="button"
								class="btn btn-ghost btn-xs btn-square -my-1 -mr-2 text-[#a0a0a0] hover:bg-[#ffffff14] hover:text-[#d4d4d4]"
								data-action="hide-terminal"
								aria-label={m.runner_hide_terminal()}
								title={m.runner_hide_terminal()}
								onClick={hideTerminal}
							>
								<svg
									viewBox="0 0 24 24"
									class="size-3.5 fill-none stroke-current stroke-2"
									aria-hidden="true"
								>
									<path d="m6 15 6-6 6 6" />
								</svg>
							</button>
						</Show>
					</div>
					<Show when={state().phase === "load-failed"}>
						<div class="p-3">
							<div
								role="alert"
								class="flex flex-wrap items-center gap-3 rounded-box border border-[#f48771]/40 bg-[#f48771]/10 px-3 py-2 text-sm text-[#f48771]"
							>
								<span class="flex-1">{m.runner_load_failed()}</span>
								<button
									type="button"
									class="btn btn-outline btn-sm border-[#d4d4d4]/60 text-[#d4d4d4]"
									data-action="retry"
									onClick={() => void run()}
								>
									{m.runner_try_again()}
								</button>
							</div>
						</div>
					</Show>
					<div class="relative">
						<Show when={!terminalReady()}>
							<p class="absolute inset-x-0 top-0 px-3 py-2 text-[#858585] italic">
								{m.runner_terminal_empty()}
							</p>
						</Show>
						{/* biome-ignore lint/a11y/useSemanticElements: xterm.js owns this element */}
						<div
							ref={terminalParent}
							role="group"
							aria-label={m.runner_terminal_label()}
							class={`overflow-hidden px-2 py-1 ${props.compact ? "h-20" : "h-56"}`}
							data-terminal
						/>
					</div>
					<Show when={coarse() && state().phase === "waiting-input"}>
						<div class="h-14" aria-hidden="true" />
						<form
							class="fixed inset-x-0 z-50 flex gap-2 border-t border-[#3c3c3c] bg-[#252526] p-2"
							style={{ bottom: `${keyboardInset()}px` }}
							onSubmit={sendLine}
						>
							<input
								ref={lineInput}
								class="input input-sm flex-1 border-[#3c3c3c] bg-[#1e1e1e] font-mono text-[#d4d4d4]"
								aria-label={m.runner_input_label()}
								placeholder={m.runner_input_placeholder()}
								autocomplete="off"
								autocapitalize="off"
								spellcheck={false}
								data-line-input
							/>
							<button
								type="submit"
								class="btn btn-outline btn-sm border-[#d4d4d4]/60 text-[#d4d4d4]"
								data-action="send"
							>
								{m.runner_send()}
							</button>
						</form>
					</Show>
				</div>
			</div>

			{props.footer}
		</div>
	);
}

export default CodeRunner;
