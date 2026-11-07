/**
 * Messages between the runner frame and the Worker that executes one run.
 *
 * Student code runs inside that Worker and can call `postMessage` itself, so
 * the frame parses every message from the Worker with `workerToFrameMessage`
 * and treats it as untrusted data. A Worker message never carries a `runId`:
 * the frame knows which run each Worker belongs to.
 */

import { z } from "zod";
import {
	DIAGNOSTICS_LIMIT,
	diagnostic,
	type languageId,
	type runMode,
	type sourcePath,
} from "../protocol";
import type { StdinTransport } from "./stdin/types";

/**
 * First message the frame sends to a new Worker: load the runtime.
 *
 * The Worker is already locked down when it arrives. `runtimeBase` is the
 * absolute URL of the versioned directory the driver downloads its runtime
 * files from. During this phase the Worker may post only `progress`,
 * `loaded` or an `exit` with reason `load-failed`; the frame terminates a
 * Worker that posts anything else.
 */
export interface LoadMessage {
	type: "load";
	language: z.infer<typeof languageId>;
	runtimeBase: string;
	/** Set only when a run is already waiting for this Worker (see `LoadContext.program`). */
	program?: { files: Record<string, string>; entry: string };
}

/**
 * Second and last message: run one program.
 *
 * Sent once, only after `loaded`, when a run consumes this Worker. The
 * Worker ignores any `start` after the first.
 */
export interface StartMessage {
	type: "start";
	mode: z.infer<typeof runMode>;
	files: Record<string, string>;
	entry: z.infer<typeof sourcePath>;
	stdin: StdinTransport;
	/** Output budget of the run; the Worker cuts what it posts at this size. */
	maxOutputBytes: number;
}

export type FrameToWorkerMessage = LoadMessage | StartMessage;

/** The runtime finished loading; the Worker waits for `start`. */
export const workerLoadedMessage = z.object({
	type: z.literal("loaded"),
});

/** Sent only after `start`: `running` first, then around each blocking read. */
export const workerStatusMessage = z.object({
	type: z.literal("status"),
	state: z.enum(["running", "waiting-input"]),
});

export const workerProgressMessage = z.object({
	type: z.literal("progress"),
	loaded: z.int().nonnegative(),
	total: z.int().nonnegative().nullable(),
});

export const workerOutputMessage = z.object({
	type: z.literal("output"),
	stream: z.enum(["stdout", "stderr"]),
	text: z.string(),
});

/**
 * The driver returned or failed.
 *
 * `reason` is `exited` (with `code`), `crashed` or `load-failed` (with a
 * `message`). `stopped` and `output-limit` are decided by the frame, never by
 * the Worker.
 */
export const workerExitMessage = z.object({
	type: z.literal("exit"),
	reason: z.enum(["exited", "crashed", "load-failed"]),
	code: z.int().nullable(),
	message: z.string().max(2000).optional(),
	diagnostics: z.array(diagnostic).max(DIAGNOSTICS_LIMIT).optional(),
});

export const workerToFrameMessage = z.discriminatedUnion("type", [
	workerLoadedMessage,
	workerStatusMessage,
	workerProgressMessage,
	workerOutputMessage,
	workerExitMessage,
]);
export type WorkerToFrameMessage = z.infer<typeof workerToFrameMessage>;
