/**
 * Picks and opens the stdin transport.
 */

import type { StdinKind } from "../../protocol";
import type { StdinReader, StdinTransport, StdinWriter } from "./types";

/// Path of the runner's service worker script. Fixed across releases; its
/// content changes with each build so the browser updates it.
export const SW_SCRIPT_URL = "/runner/sw.js";

/// Scope of the runner's service worker.
export const SW_SCOPE = "/runner/";

/// How long the frame waits for its service worker to take control.
export const SW_READY_TIMEOUT_MS = 5000;

/**
 * Chooses the stdin transport for this frame load: `sab` when the frame is
 * `crossOriginIsolated`, else `sw` once a service worker controls the frame,
 * else `none`.
 *
 * Registers the service worker only on the `sw` path. Never rejects.
 */
export async function detectStdinKind(): Promise<StdinKind> {
	throw new Error("not implemented");
}

/**
 * Creates the frame's end of a new channel for one run.
 *
 * @throws {Error} when `kind` is `none`.
 */
export function createStdinWriter(
	_kind: StdinKind,
	_runId: string,
): StdinWriter {
	throw new Error("not implemented");
}

/** Opens the Worker's end of the channel described by `transport`. */
export function openStdinReader(_transport: StdinTransport): StdinReader {
	throw new Error("not implemented");
}
