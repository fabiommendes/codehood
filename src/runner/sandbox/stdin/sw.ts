/**
 * The `sw` stdin transport: the runner's service worker answers synchronous
 * XHRs from the Worker with the lines the frame posts to it.
 *
 * The Worker sends `GET ${SW_STDIN_PATH}<runId>`. The service worker holds the
 * request up to `SW_POLL_MS` and answers:
 *
 * | Status | Header `X-Stdin` | Meaning                                  |
 * | :----- | :--------------- | :--------------------------------------- |
 * | 200    | `line`           | body is one line, UTF-8, no newline      |
 * | 200    | `eof`            | end of input                             |
 * | 204    |                  | nothing yet; ask again                   |
 * | 410    |                  | channel cancelled or unknown             |
 * | 403    |                  | request from a client that does not own the channel |
 *
 * The first request for a `runId` binds the channel to its
 * `FetchEvent.clientId`; requests from any other client get 403.
 */

import { z } from "zod";
import type { StdinReader, StdinWriter } from "./types";

/**
 * Messages the frame posts to the service worker.
 *
 * The service worker accepts them only from a `window` client of its own
 * origin, never from a Worker.
 */
export const frameToSwMessage = z.discriminatedUnion("type", [
	z.object({ type: z.literal("stdin-open"), runId: z.uuid() }),
	z.object({
		type: z.literal("stdin-line"),
		runId: z.uuid(),
		line: z.string(),
	}),
	z.object({ type: z.literal("stdin-eof"), runId: z.uuid() }),
	z.object({ type: z.literal("stdin-cancel"), runId: z.uuid() }),
]);
export type FrameToSwMessage = z.infer<typeof frameToSwMessage>;

/**
 * Creates the frame's end of an `sw` channel and posts `stdin-open` to the
 * controlling service worker.
 *
 * @throws {Error} when no service worker controls the frame.
 */
export function createSwWriter(_runId: string): StdinWriter {
	throw new Error("not implemented");
}

/** Opens the Worker's end of an `sw` channel; each `readLine` polls with synchronous XHR. */
export function openSwReader(_runId: string): StdinReader {
	throw new Error("not implemented");
}
