/**
 * Code runner widget: editor, Run/Stop, terminal, status line.
 *
 * One component for the three modes; the differences are in the props and
 * in the `toolbar`/`footer` slots each mode's page fills. All widgets of a
 * page share one runner iframe through `RunnerHost.shared(runnerOrigin)`.
 */

import type { JSX } from "solid-js";
import type { LanguageId, RunMode } from "@/runner/protocol";

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
	/// `light-plus`/`dark-plus` themes, matching the editor's VS Code theme),
	/// shown until the editor mounts and in server rendering. Trusted: never
	/// user HTML.
	highlightedHtml?: string;
	/// Answer mode: running is off for this exam (`canRunCode` false).
	runDisabled?: boolean;
	/// Answer mode: called with the full source after each edit.
	onChange?: (code: string) => void;
	/// Answer mode: the starting code "back to the starter code" restores.
	starterCode?: string;
	/// Shorter editor and terminal hidden until the first run (lists, exams).
	compact?: boolean;
	/// Extra controls at the start of the toolbar (review: submission navigation).
	toolbar?: JSX.Element;
	/// Content under the terminal (answer: autosave status, draft conflict).
	footer?: JSX.Element;
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
export function CodeRunner(_props: CodeRunnerProps): JSX.Element {
	throw new Error("not implemented");
}

export default CodeRunner;
