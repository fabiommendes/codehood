/**
 * Messages between the app page and the runner frame.
 *
 * The app page (app origin) embeds one hidden iframe from the runner origin
 * and talks to it only through `postMessage`. Both sides parse every incoming
 * message with these schemas and drop what does not parse. Messages carry data
 * only: text, numbers and enums, never HTML, functions or credentials.
 *
 * This module is shared by the app bundle and the sandbox bundle, so it
 * imports nothing from the app besides `zod`.
 */

import { z } from "zod";

/// Version of this protocol. The frame announces it in `ready`; the app
/// refuses a frame that announces another one.
export const RUNNER_PROTOCOL_VERSION = 1;

/// Default and maximum bytes a run may write to stdout and stderr together.
/// A run that goes over is terminated with reason `output-limit`.
export const OUTPUT_LIMIT_BYTES = 1024 * 1024;

/// Maximum messages a run's Worker may post after `start`, of any type,
/// forged or not (`output`, `status`, malformed ones). A run that goes over
/// is terminated with reason `output-limit`, even under the byte limit.
export const OUTPUT_MESSAGES_LIMIT = 100_000;

/// The frame forwards a run's output to the app in batches, one `output`
/// message per stream at most every `OUTPUT_FLUSH_MS`.
export const OUTPUT_FLUSH_MS = 50;

/// Maximum bytes of all source files of one run together.
export const FILES_LIMIT_BYTES = 1024 * 1024;

/// Maximum bytes of one stdin line, newline excluded.
export const STDIN_LINE_MAX_BYTES = 64 * 1024;

/** Languages with a driver in the sandbox bundle. */
export const languageId = z.enum([
	"javascript",
	"lua",
	"prolog",
	"python",
	"fake",
]);
export type LanguageId = z.infer<typeof languageId>;

/** How a driver runs the files: once from the entry file, or as a read-eval-print loop. */
export const runMode = z.enum(["script", "repl"]);
export type RunMode = z.infer<typeof runMode>;

/** How the frame delivers blocking stdin to the Worker; `none` means this browser cannot run code. */
export const stdinKind = z.enum(["sab", "sw", "none"]);
export type StdinKind = z.infer<typeof stdinKind>;

/// Opaque id the app picks for a run, unique per page (`crypto.randomUUID()`).
export const runId = z.uuid();

/// A relative POSIX path: no leading `/`, no `.` or `..` segments, no `\`.
export const sourcePath = z
	.string()
	.min(1)
	.max(255)
	.regex(/^(?!\/)(?!.*(^|\/)\.{1,2}(\/|$))[^\\\0]+$/);

/** States a run goes through before it ends. */
export const runState = z.enum(["loading", "running", "waiting-input"]);
export type RunState = z.infer<typeof runState>;

/**
 * Why a run ended.
 *
 * `exited`: the program finished, `code` says how. `crashed`: the driver
 * itself failed while running. `load-failed`: the runtime could not be
 * downloaded or started. `stopped`: the app sent `stop`. `output-limit`: the
 * program wrote more than `maxOutputBytes` or its Worker posted more than
 * `OUTPUT_MESSAGES_LIMIT` messages. `stale-bundle`: the server no longer serves
 * the bundle version this frame was loaded with (a deploy happened), so the
 * Worker script answers 404; reloading the frame fixes it.
 */
export const exitReason = z.enum([
	"exited",
	"crashed",
	"load-failed",
	"stopped",
	"output-limit",
	"stale-bundle",
]);
export type ExitReason = z.infer<typeof exitReason>;

// =============================================================================
//  						    APP -> FRAME
// =============================================================================

/**
 * Starts a run in a new Worker.
 *
 * `entry` must be a key of `files`. The sum of the sizes of `files` must not
 * exceed `FILES_LIMIT_BYTES`. A `run` whose `runId` was already used in this
 * frame load is ignored: no message answers it. A `run` whose language the
 * frame did not announce in `ready` ends at once with
 * `exit { reason: "crashed" }`.
 */
export const runMessage = z.object({
	type: z.literal("run"),
	runId,
	language: languageId,
	mode: runMode,
	files: z.record(sourcePath, z.string()),
	entry: sourcePath,
	maxOutputBytes: z.int().positive().max(OUTPUT_LIMIT_BYTES).optional(),
});

/**
 * Asks the frame to keep a reserve Worker for `language`: created, locked
 * down and with its runtime loaded, but with no program.
 *
 * The next `run` in that language consumes the reserve instead of loading a
 * runtime. At most one reserve per language; a `prepare` while one exists,
 * is loading, or a run in that language is active is ignored, as is one for
 * a language the frame did not announce. The app sends it on the first focus
 * or edit of an editor, never on page load, and never when code execution is
 * off.
 */
export const prepareMessage = z.object({
	type: z.literal("prepare"),
	language: languageId,
});

/** One line typed in the terminal, without its newline. */
export const stdinMessage = z.object({
	type: z.literal("stdin"),
	runId,
	line: z.string(),
});

/** End of input (Ctrl+D): `readLine` returns `null` once queued lines are read. */
export const stdinEofMessage = z.object({
	type: z.literal("stdin-eof"),
	runId,
});

/** Terminates the run's Worker; the frame answers with `exit { reason: "stopped" }`. */
export const stopMessage = z.object({
	type: z.literal("stop"),
	runId,
});

export const appToRunnerMessage = z.discriminatedUnion("type", [
	prepareMessage,
	runMessage,
	stdinMessage,
	stdinEofMessage,
	stopMessage,
]);
export type AppToRunnerMessage = z.infer<typeof appToRunnerMessage>;
export type RunMessage = z.infer<typeof runMessage>;

// =============================================================================
//  						    FRAME -> APP
// =============================================================================

/**
 * The frame finished loading and can take runs.
 *
 * Sent once per frame load, after the origin storage cleanup started and the
 * stdin transport was chosen. `stdin: "none"` means no run will be accepted.
 */
export const readyMessage = z.object({
	type: z.literal("ready"),
	protocol: z.literal(RUNNER_PROTOCOL_VERSION),
	stdin: stdinKind,
	languages: z.array(languageId),
});

/**
 * The run changed state; never sent twice in a row with the same `state`.
 *
 * A run that consumed a ready reserve goes straight to `running`; one that
 * arrived before its reserve finished loading reports `loading` first.
 */
export const statusMessage = z.object({
	type: z.literal("status"),
	runId,
	state: runState,
});

/** Download progress of the runtime; `total` is null when unknown. */
export const progressMessage = z.object({
	type: z.literal("progress"),
	runId,
	loaded: z.int().nonnegative(),
	total: z.int().nonnegative().nullable(),
});

/**
 * Program output, in order. Text only; ANSI escapes pass through as text.
 *
 * Batched by the frame: consecutive writes to one stream within
 * `OUTPUT_FLUSH_MS` arrive as one message, flushed before any `status` or
 * `exit` of the same run.
 */
export const outputMessage = z.object({
	type: z.literal("output"),
	runId,
	stream: z.enum(["stdout", "stderr"]),
	text: z.string(),
});

/**
 * The run ended; no other message for this `runId` follows.
 *
 * `code` is the program's exit code for `exited`, null otherwise. `message`
 * is a short plain-text explanation for `crashed` and `load-failed`.
 */
export const exitMessage = z.object({
	type: z.literal("exit"),
	runId,
	reason: exitReason,
	code: z.int().nullable(),
	message: z.string().max(2000).optional(),
});

/**
 * A reserve Worker failed because its script answers 404: the frame is stale.
 *
 * Runs report the same failure as `exit { reason: "stale-bundle" }`; this
 * message covers the case with no run to carry it.
 */
export const staleBundleMessage = z.object({
	type: z.literal("stale-bundle"),
});

export const runnerToAppMessage = z.discriminatedUnion("type", [
	readyMessage,
	staleBundleMessage,
	statusMessage,
	progressMessage,
	outputMessage,
	exitMessage,
]);
export type RunnerToAppMessage = z.infer<typeof runnerToAppMessage>;
export type ReadyMessage = z.infer<typeof readyMessage>;
export type ExitMessage = z.infer<typeof exitMessage>;
