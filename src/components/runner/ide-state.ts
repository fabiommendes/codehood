/**
 * State of one code runner widget, as a pure reducer.
 *
 * The widget feeds it the events of `RunnerHost` and of its own buttons, and
 * renders from the result. No DOM, no clock: tests drive it with values.
 */

import type { RunExit } from "@/runner/host";
import type { RunState } from "@/runner/protocol";

/**
 * What the widget shows.
 *
 * `idle`: never ran. `preparing`: Run was clicked and the runtime is still
 * loading ("preparando…", with progress when known). `running`,
 * `waiting-input`: the program is running. `done`: exited with code 0.
 * `error`: exited with another code, or the driver crashed. `stopped`: the
 * user stopped it. `truncated`: the output limit was hit. `load-failed`: the
 * runtime could not load, or the runner did not answer in time; offers
 * "try again". `disabled`: running is off for this exam. `unsupported`: this
 * browser cannot run code. `unconfigured`: this instance has no runner.
 */
export type IdePhase =
	| "idle"
	| "preparing"
	| "running"
	| "waiting-input"
	| "done"
	| "error"
	| "stopped"
	| "truncated"
	| "load-failed"
	| "disabled"
	| "unsupported"
	| "unconfigured";

export interface IdeState {
	phase: IdePhase;
	/// Download progress while `preparing`; null when unknown or not loading.
	progress: { loaded: number; total: number | null } | null;
	/// How the last run ended; null before the first one ends.
	lastExit: (RunExit & { elapsedMs: number }) | null;
}

export type IdeEvent =
	/// The user clicked Run (or Try again).
	| { type: "run-requested" }
	| { type: "status"; state: RunState }
	| { type: "progress"; loaded: number; total: number | null }
	| { type: "exit"; exit: RunExit; elapsedMs: number }
	/// `RunnerHost` threw `RunnerUnavailable`.
	| { type: "unavailable"; reason: "unsupported" | "timeout" | "protocol" };

/**
 * The state a widget starts in.
 *
 * `unconfigured` without a runner origin, `disabled` when the exam turned
 * running off, `idle` otherwise.
 */
export function initialIdeState(options: {
	runnerOrigin: string | null;
	runDisabled: boolean;
}): IdeState {
	const phase: IdePhase =
		options.runnerOrigin === null
			? "unconfigured"
			: options.runDisabled
				? "disabled"
				: "idle";
	return { phase, progress: null, lastExit: null };
}

/// Phases from which Run starts a new run.
const RUNNABLE: ReadonlySet<IdePhase> = new Set([
	"idle",
	"done",
	"error",
	"stopped",
	"truncated",
	"load-failed",
]);

/// Phases of a run in progress.
const BUSY: ReadonlySet<IdePhase> = new Set([
	"preparing",
	"running",
	"waiting-input",
]);

/// The phase an exit leads to.
function exitPhase(exit: RunExit): IdePhase {
	switch (exit.reason) {
		case "exited":
			return exit.code === 0 ? "done" : "error";
		case "crashed":
			return "error";
		case "stopped":
		case "reloaded":
			return "stopped";
		case "output-limit":
			return "truncated";
		case "load-failed":
		case "stale-bundle":
			return "load-failed";
	}
}

/**
 * Applies one event.
 *
 * Exit reasons map to phases: `exited` with code 0 to `done`, `exited` with
 * another code and `crashed` to `error`, `stopped` to `stopped`,
 * `output-limit` to `truncated`, `load-failed` to `load-failed`.
 * `unavailable` maps `unsupported` and `protocol` to `unsupported`, and
 * `timeout` to `load-failed`. Events that make no sense in the current phase
 * (a `status` after `exit`, `run-requested` while running, anything while
 * `disabled`, `unsupported` or `unconfigured`) leave the state unchanged.
 */
export function reduceIde(state: IdeState, event: IdeEvent): IdeState {
	const { phase } = state;
	switch (event.type) {
		case "run-requested":
			return RUNNABLE.has(phase)
				? { ...state, phase: "preparing", progress: null }
				: state;
		case "status":
			// `loading` only makes sense before the program starts, where it
			// changes nothing: the phase is already `preparing`.
			if (!BUSY.has(phase) || event.state === "loading") return state;
			return { ...state, phase: event.state, progress: null };
		case "progress":
			return phase === "preparing"
				? {
						...state,
						progress: { loaded: event.loaded, total: event.total },
					}
				: state;
		case "exit":
			return BUSY.has(phase)
				? {
						phase: exitPhase(event.exit),
						progress: null,
						lastExit: { ...event.exit, elapsedMs: event.elapsedMs },
					}
				: state;
		case "unavailable":
			if (phase !== "idle" && phase !== "preparing") return state;
			return {
				...state,
				phase: event.reason === "timeout" ? "load-failed" : "unsupported",
				progress: null,
			};
	}
}

/** Whether the Run button is enabled. */
export function canRun(state: IdeState): boolean {
	return RUNNABLE.has(state.phase);
}

/** Whether a run is in progress, so the Stop button shows in place of Run. */
export function isBusy(state: IdeState): boolean {
	return BUSY.has(state.phase);
}
