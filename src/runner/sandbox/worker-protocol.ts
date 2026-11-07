/**
 * Messages between the runner frame and the Worker that executes one run.
 *
 * Student code runs inside that Worker and can call `postMessage` itself, so
 * the frame parses every message from the Worker with `workerToFrameMessage`
 * and treats it as untrusted data. A Worker message never carries a `runId`:
 * the frame knows which run each Worker belongs to.
 */

import { z } from "zod";
import type { languageId, runMode, sourcePath } from "../protocol";
import type { StdinTransport } from "./stdin/types";

/**
 * The only message the frame sends to a Worker, right after creating it.
 *
 * `runtimeBase` is the absolute URL of the versioned directory the driver
 * downloads its runtime files from.
 */
export interface StartMessage {
	type: "start";
	language: z.infer<typeof languageId>;
	mode: z.infer<typeof runMode>;
	files: Record<string, string>;
	entry: z.infer<typeof sourcePath>;
	stdin: StdinTransport;
	runtimeBase: string;
}

export const workerStatusMessage = z.object({
	type: z.literal("status"),
	state: z.enum(["loading", "running", "waiting-input"]),
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
});

export const workerToFrameMessage = z.discriminatedUnion("type", [
	workerStatusMessage,
	workerProgressMessage,
	workerOutputMessage,
	workerExitMessage,
]);
export type WorkerToFrameMessage = z.infer<typeof workerToFrameMessage>;
