/**
 * The `sab` stdin transport: a `SharedArrayBuffer` and `Atomics.wait`.
 *
 * Only usable when the frame is `crossOriginIsolated`.
 */

import { STDIN_LINE_MAX_BYTES } from "../../protocol";
import { utf8Length } from "../utf8";
import {
	SAB_HEADER_INTS,
	SabState,
	StdinCancelled,
	type StdinReader,
	type StdinWriter,
} from "./types";

/**
 * Creates the frame's end of a `sab` channel, with a new shared buffer.
 *
 * @throws {Error} when `crossOriginIsolated` is false.
 */
export function createSabWriter(): StdinWriter {
	if (!globalThis.crossOriginIsolated) {
		throw new Error(
			"SharedArrayBuffer is unavailable: not cross-origin isolated",
		);
	}
	const buffer = new SharedArrayBuffer(
		SAB_HEADER_INTS * Int32Array.BYTES_PER_ELEMENT + STDIN_LINE_MAX_BYTES,
	);
	const header = new Int32Array(buffer, 0, SAB_HEADER_INTS);
	const data = new Uint8Array(
		buffer,
		SAB_HEADER_INTS * Int32Array.BYTES_PER_ELEMENT,
	);
	const encoder = new TextEncoder();
	const queue: string[] = [];
	let waiting = false;
	let ended = false;
	let cancelled = false;

	/// The buffer has one slot: a line goes in only while the reader is blocked.
	function deliver() {
		if (cancelled || !waiting) return;
		const line = queue.shift();
		if (line !== undefined) {
			// `encodeInto` refuses a view over shared memory: encode, then copy.
			const bytes = encoder.encode(line);
			data.set(bytes);
			Atomics.store(header, 1, bytes.length);
			Atomics.store(header, 0, SabState.LINE);
		} else if (ended) {
			Atomics.store(header, 0, SabState.EOF);
		} else {
			return;
		}
		waiting = false;
		Atomics.notify(header, 0);
	}

	return {
		transport: { kind: "sab", buffer },
		writeLine(line) {
			if (utf8Length(line) > STDIN_LINE_MAX_BYTES) {
				throw new RangeError(
					`stdin line exceeds ${STDIN_LINE_MAX_BYTES} bytes`,
				);
			}
			if (cancelled || ended) return;
			queue.push(line);
			deliver();
		},
		end() {
			ended = true;
			deliver();
		},
		cancel() {
			cancelled = true;
			queue.length = 0;
			Atomics.store(header, 0, SabState.CANCELLED);
			Atomics.notify(header, 0);
		},
		readerWaiting() {
			waiting = true;
			deliver();
		},
	};
}

/** Opens the Worker's end of a `sab` channel on the buffer the frame sent. */
export function openSabReader(buffer: SharedArrayBuffer): StdinReader {
	const header = new Int32Array(buffer, 0, SAB_HEADER_INTS);
	const data = new Uint8Array(
		buffer,
		SAB_HEADER_INTS * Int32Array.BYTES_PER_ELEMENT,
	);
	const decoder = new TextDecoder();
	return {
		readLine() {
			for (;;) {
				const state = Atomics.load(header, 0);
				if (state === SabState.LINE) {
					const length = Atomics.load(header, 1);
					// `TextDecoder` refuses views over shared memory: copy first.
					const line = decoder.decode(data.slice(0, length));
					Atomics.store(header, 0, SabState.EMPTY);
					return line;
				}
				if (state === SabState.EOF) return null;
				if (state === SabState.CANCELLED) throw new StdinCancelled();
				Atomics.wait(header, 0, SabState.EMPTY);
			}
		},
	};
}
