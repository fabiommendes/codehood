/**
 * The `sab` stdin transport: a `SharedArrayBuffer` and `Atomics.wait`.
 *
 * Only usable when the frame is `crossOriginIsolated`.
 */

import type { StdinReader, StdinWriter } from "./types";

/**
 * Creates the frame's end of a `sab` channel, with a new shared buffer.
 *
 * @throws {Error} when `crossOriginIsolated` is false.
 */
export function createSabWriter(): StdinWriter {
	throw new Error("not implemented");
}

/** Opens the Worker's end of a `sab` channel on the buffer the frame sent. */
export function openSabReader(_buffer: SharedArrayBuffer): StdinReader {
	throw new Error("not implemented");
}
