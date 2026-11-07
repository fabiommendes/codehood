/**
 * Blocking stdin between the runner frame (writer) and a run's Worker (reader).
 *
 * Two transports implement the same pair of interfaces: a `SharedArrayBuffer`
 * with `Atomics.wait` when the frame is `crossOriginIsolated`, and a
 * synchronous XHR answered by the runner's service worker otherwise. Drivers
 * only ever see `StdinReader.readLine`.
 */

/// Layout of the shared buffer used by the `sab` transport: an `Int32Array`
/// header of `SAB_HEADER_INTS` slots, then `STDIN_LINE_MAX_BYTES` of UTF-8.
/// Slot 0 is the state (`SabState`), slot 1 the byte length of the line.
export const SAB_HEADER_INTS = 2;

/// Values of slot 0 of the `sab` buffer.
export const SabState = {
	/// No line available; the reader waits.
	EMPTY: 0,
	/// A line is in the buffer; the reader takes it and sets `EMPTY`.
	LINE: 1,
	/// No more input; every following read returns null.
	EOF: 2,
	/// The run was stopped; the reader throws `StdinCancelled`.
	CANCELLED: 3,
} as const;

/// How long the service worker holds one stdin request before answering
/// "nothing yet" and letting the Worker ask again.
export const SW_POLL_MS = 1000;

/// Path, under the runner origin, of the stdin requests the service worker answers.
export const SW_STDIN_PATH = "/runner/__stdin/";

/** What the frame hands the Worker so it can open a reader. Structured-cloneable. */
export type StdinTransport =
	| { kind: "sab"; buffer: SharedArrayBuffer }
	| { kind: "sw"; runId: string; token: string };

/** The Worker's end: blocks the Worker thread until a line, EOF or cancellation. */
export interface StdinReader {
	/**
	 * Blocks until the next line is available and returns it without its newline.
	 *
	 * @returns the line, or `null` at end of input.
	 * @throws {StdinCancelled} when the run was stopped while waiting.
	 */
	readLine(): string | null;
}

/** The frame's end of one run's stdin. */
export interface StdinWriter {
	/** The transport to put in the Worker's `start` message. */
	readonly transport: StdinTransport;

	/**
	 * Queues one line typed by the user; lines are delivered in order.
	 *
	 * @throws {RangeError} when the line exceeds `STDIN_LINE_MAX_BYTES`.
	 */
	writeLine(line: string): void;

	/** Marks end of input, delivered after the lines already queued. */
	end(): void;

	/** Releases a reader blocked in `readLine` with `StdinCancelled` and drops queued lines. */
	cancel(): void;

	/**
	 * Tells the writer the Worker is blocked in `readLine`.
	 *
	 * The frame calls it on each Worker `status: waiting-input`. The `sab`
	 * writer delivers the next queued line only then; the `sw` writer ignores it.
	 */
	readerWaiting(): void;
}

/** Thrown by `StdinReader.readLine` when the run was stopped while it waited. */
export class StdinCancelled extends Error {
	constructor() {
		super("stdin cancelled");
		this.name = "StdinCancelled";
	}
}
