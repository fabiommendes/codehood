/**
 * The `sw` stdin transport: the runner's service worker answers synchronous
 * XHRs from the Worker with the lines the frame posts to it.
 *
 * The Worker sends `GET ${SW_STDIN_PATH}<runId>` with header
 * `X-Stdin-Token: <token>`. The service worker holds the request up to
 * `SW_POLL_MS` and answers:
 *
 * | Status | Header `X-Stdin` | Meaning                                  |
 * | :----- | :--------------- | :--------------------------------------- |
 * | 200    | `line`           | body is one line, UTF-8, no newline      |
 * | 200    | `eof`            | end of input                             |
 * | 204    |                  | nothing yet; ask again                   |
 * | 410    |                  | channel cancelled or unknown             |
 * | 410    | `X-Stdin-Retry`  | unknown after the resync deadline; ask again |
 * | 403    |                  | wrong or missing token, or a client that does not own the channel |
 *
 * The channel is bound to its owner when the frame creates it, before any
 * read: `stdin-open` registers a random `token` (`crypto.randomUUID()`) that
 * only the frame and, through `start`, the run's Worker know. A request
 * without that token gets 403, whatever its `runId`, even before the owner's
 * first read. The frame cannot learn the Worker's service worker client id,
 * so on top of the token the first request carrying it also binds the
 * channel to its `FetchEvent.clientId`; later requests from another client
 * get 403 even with the token.
 */

import { z } from "zod";
import { STDIN_LINE_MAX_BYTES } from "../../protocol";
import { utf8Length } from "../utf8";
import {
	StdinCancelled,
	type StdinReader,
	type StdinWriter,
	SW_POLL_MS,
	SW_STDIN_PATH,
} from "./types";

/// Header that carries the channel token on stdin requests.
export const STDIN_TOKEN_HEADER = "X-Stdin-Token";

/// Header that says what a 200 answer holds: `line` or `eof`.
export const STDIN_KIND_HEADER = "X-Stdin";

/// Header with the number of lines the Worker has consumed from the channel.
export const STDIN_CONSUMED_HEADER = "X-Stdin-Consumed";

/// Header on a 410 that says the channel was unknown only because no
/// `stdin-open` arrived in time, so the Worker may ask again.
export const STDIN_RETRY_HEADER = "X-Stdin-Retry";

/// How many times the Worker asks again after such a 410 before giving up.
export const STDIN_RETRIES = 2;

/// How long a request for an unknown channel waits for a `stdin-open`, which
/// travels by another path and may arrive after the request, or answers the
/// service worker's `stdin-resync`. Long enough for a busy frame (a phone).
export const UNKNOWN_CHANNEL_GRACE_MS = 5000;

/// Shape of a channel token (`crypto.randomUUID()`); cheap filter for requests
/// that cannot belong to any channel.
const TOKEN_SHAPE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/// Interval at which the frame pings the service worker while a run uses the
/// `sw` transport, so the browser does not stop it for being idle.
export const SW_KEEPALIVE_MS = 10_000;

/**
 * Messages the frame posts to the service worker.
 *
 * The service worker accepts them only from a `window` client of its own
 * origin, never from a Worker. `stdin-open` may carry the `lines` not yet
 * consumed and `eof`, to rebuild a channel the service worker lost.
 * `keepalive` only wakes the service worker.
 */
export const frameToSwMessage = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("stdin-open"),
		runId: z.uuid(),
		token: z.uuid(),
		lines: z.array(z.string()).optional(),
		eof: z.boolean().optional(),
	}),
	z.object({ type: z.literal("keepalive") }),
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
 * Messages the service worker posts to its window clients.
 *
 * `stdin-resync` goes to every window when a Worker asks for a channel the
 * service worker does not know: the frame that owns `runId` answers with a
 * `stdin-open` that replays the lines after the first `consumed`.
 * `stdin-consumed` goes to the owner only, so it can forget those lines.
 */
export const swToFrameMessage = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("stdin-resync"),
		runId: z.uuid(),
		consumed: z.int().nonnegative(),
	}),
	z.object({
		type: z.literal("stdin-consumed"),
		runId: z.uuid(),
		consumed: z.int().nonnegative(),
	}),
]);
export type SwToFrameMessage = z.infer<typeof swToFrameMessage>;

/** What the service worker answers to one stdin request. */
export interface StdinReply {
	status: 200 | 204 | 403 | 410;
	kind?: "line" | "eof";
	body?: string;
	/// Set on a 410 for a channel that was unknown, not cancelled.
	retry?: true;
}

interface Channel {
	token: string;
	/// Id of the frame's window client, the only one allowed to feed the channel.
	owner: string;
	/// Id of the Worker client that made the first valid request.
	reader: string | null;
	lines: string[];
	eof: boolean;
	/// Highest consumed count already reported to the owner.
	acked: number;
	waiter: { answer: (reply: StdinReply) => void } | null;
}

/**
 * The service worker's table of stdin channels, one per run.
 *
 * Holds no browser objects, so it runs the same in Node.
 */
export class StdinChannels {
	private channels = new Map<string, Channel>();
	private openWaiters = new Map<string, Set<() => void>>();

	/** Registers a channel owned by window client `owner`; ignored when `runId` already has one. */
	open(
		runId: string,
		token: string,
		owner: string,
		lines: string[] = [],
		eof = false,
	): void {
		if (this.channels.has(runId)) return;
		this.channels.set(runId, {
			token,
			owner,
			reader: null,
			lines: [...lines],
			eof,
			acked: 0,
			waiter: null,
		});
		for (const wake of [...(this.openWaiters.get(runId) ?? [])]) wake();
	}

	/** Queues a line from `sender`; ignored unless `sender` owns the channel. */
	line(runId: string, line: string, sender: string): void {
		const channel = this.owned(runId, sender);
		if (!channel || channel.eof) return;
		channel.lines.push(line);
		this.wake(channel);
	}

	/** Marks end of input from `sender`; ignored unless `sender` owns the channel. */
	eof(runId: string, sender: string): void {
		const channel = this.owned(runId, sender);
		if (!channel) return;
		channel.eof = true;
		this.wake(channel);
	}

	/** Drops the channel on `sender`'s request, releasing a pending read with 410. */
	cancel(runId: string, sender: string): void {
		if (this.owned(runId, sender)) this.drop(runId);
	}

	/** Drops the channels whose owner is not among `liveOwners`. */
	retainOwners(liveOwners: ReadonlySet<string>): void {
		for (const [runId, channel] of [...this.channels]) {
			if (!liveOwners.has(channel.owner)) this.drop(runId);
		}
	}

	/**
	 * Records that the reader holding `token` consumed `consumed` lines;
	 * returns the owner's client id when that is news, else null.
	 */
	ack(runId: string, token: string | null, consumed: number): string | null {
		const channel = this.channels.get(runId);
		if (!channel || token !== channel.token) return null;
		if (!Number.isInteger(consumed) || consumed <= channel.acked) return null;
		channel.acked = consumed;
		return channel.owner;
	}

	/**
	 * Answers a request of Worker client `clientId`: a queued line, end of
	 * input, "nothing yet" after `SW_POLL_MS`, 403 for a wrong token or
	 * client, 410 for an unknown or cancelled channel. A request for an unknown
	 * channel needs a token of the right shape (403 otherwise, with no resync);
	 * it then calls `resync` once per run at a time, so the owner can rebuild
	 * the channel, and a 410 after the deadline is marked `retry`.
	 */
	async read(
		runId: string,
		token: string | null,
		clientId: string,
		resync?: () => void,
	): Promise<StdinReply> {
		let channel = this.channels.get(runId) ?? null;
		if (!channel) {
			if (token === null || !TOKEN_SHAPE.test(token)) return { status: 403 };
			channel = await this.waitForOpen(runId, resync);
			if (!channel) return { status: 410, retry: true };
		}
		if (this.channels.get(runId) !== channel) return { status: 410 };
		if (token !== channel.token) return { status: 403 };
		if (channel.reader === null) channel.reader = clientId;
		else if (channel.reader !== clientId) return { status: 403 };

		channel.waiter?.answer({ status: 204 });
		const ready = this.take(channel);
		if (ready) return ready;
		return new Promise<StdinReply>((resolve) => {
			const answer = (reply: StdinReply) => {
				clearTimeout(timer);
				if (channel.waiter?.answer === answer) channel.waiter = null;
				resolve(reply);
			};
			const timer = setTimeout(() => answer({ status: 204 }), SW_POLL_MS);
			channel.waiter = { answer };
		});
	}

	private owned(runId: string, sender: string): Channel | null {
		const channel = this.channels.get(runId);
		return channel && channel.owner === sender ? channel : null;
	}

	private take(channel: Channel): StdinReply | null {
		const line = channel.lines.shift();
		if (line !== undefined) return { status: 200, kind: "line", body: line };
		if (channel.eof) return { status: 200, kind: "eof" };
		return null;
	}

	private wake(channel: Channel): void {
		if (!channel.waiter) return;
		const reply = this.take(channel);
		if (reply) channel.waiter.answer(reply);
	}

	private drop(runId: string): void {
		const channel = this.channels.get(runId);
		this.channels.delete(runId);
		channel?.waiter?.answer({ status: 410 });
	}

	private waitForOpen(
		runId: string,
		resync?: () => void,
	): Promise<Channel | null> {
		return new Promise((resolve) => {
			const waiters = this.openWaiters.get(runId) ?? new Set<() => void>();
			const resyncing = waiters.size > 0;
			this.openWaiters.set(runId, waiters);
			const done = () => {
				clearTimeout(timer);
				waiters.delete(done);
				if (waiters.size === 0) this.openWaiters.delete(runId);
				resolve(this.channels.get(runId) ?? null);
			};
			const timer = setTimeout(done, UNKNOWN_CHANNEL_GRACE_MS);
			waiters.add(done);
			if (!resyncing) resync?.();
		});
	}
}

/**
 * Creates the frame's end of an `sw` channel with a fresh token and posts
 * `stdin-open` to the controlling service worker.
 *
 * @throws {Error} when no service worker controls the frame.
 */
export function createSwWriter(runId: string): StdinWriter {
	const container = navigator.serviceWorker;
	if (!container?.controller) {
		throw new Error("no service worker controls the frame");
	}
	const token = crypto.randomUUID();
	/// Every line written, kept to rebuild the channel in a restarted service worker.
	const history: string[] = [];
	/// How many lines were dropped from the front of `history` as consumed.
	let forgotten = 0;
	let ended = false;
	// Always the current controller: a service worker that restarted is a new object.
	const post = (message: FrameToSwMessage) =>
		container.controller?.postMessage(message);
	post({ type: "stdin-open", runId, token });
	const onMessage = (event: MessageEvent) => {
		const parsed = swToFrameMessage.safeParse(event.data);
		if (!parsed.success || parsed.data.runId !== runId) return;
		const { consumed } = parsed.data;
		if (parsed.data.type === "stdin-consumed") {
			history.splice(0, Math.max(0, consumed - forgotten));
			forgotten = Math.max(forgotten, consumed);
			return;
		}
		post({
			type: "stdin-open",
			runId,
			token,
			lines: history.slice(Math.max(0, consumed - forgotten)),
			eof: ended,
		});
	};
	container.addEventListener("message", onMessage);
	const keepalive = setInterval(
		() => post({ type: "keepalive" }),
		SW_KEEPALIVE_MS,
	);
	return {
		transport: { kind: "sw", runId, token },
		writeLine(line) {
			if (utf8Length(line) > STDIN_LINE_MAX_BYTES) {
				throw new RangeError(
					`stdin line exceeds ${STDIN_LINE_MAX_BYTES} bytes`,
				);
			}
			history.push(line);
			post({ type: "stdin-line", runId, line });
		},
		end() {
			ended = true;
			post({ type: "stdin-eof", runId });
		},
		cancel() {
			clearInterval(keepalive);
			container.removeEventListener("message", onMessage);
			history.length = 0;
			post({ type: "stdin-cancel", runId });
		},
		readerWaiting() {},
	};
}

/** Opens the Worker's end of an `sw` channel; each `readLine` polls with synchronous XHR. */
export function openSwReader(runId: string, token: string): StdinReader {
	let ended = false;
	let consumed = 0;
	let retries = 0;
	return {
		readLine() {
			if (ended) return null;
			for (;;) {
				const request = new XMLHttpRequest();
				request.open("GET", `${SW_STDIN_PATH}${runId}`, false);
				request.setRequestHeader(STDIN_TOKEN_HEADER, token);
				request.setRequestHeader(STDIN_CONSUMED_HEADER, String(consumed));
				request.send();
				if (request.status === 204) continue;
				if (
					request.status === 410 &&
					request.getResponseHeader(STDIN_RETRY_HEADER) !== null &&
					retries < STDIN_RETRIES
				) {
					retries++;
					continue;
				}
				if (request.status === 410) throw new StdinCancelled();
				if (request.status !== 200) {
					throw new Error(`stdin request failed: ${request.status}`);
				}
				if (request.getResponseHeader(STDIN_KIND_HEADER) === "eof") {
					ended = true;
					return null;
				}
				consumed++;
				retries = 0;
				return request.responseText;
			}
		},
	};
}
