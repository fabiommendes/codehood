/**
 * Entry of the runner's service worker (`/runner/sw.js`, scope `/runner/`).
 *
 * Answers only `GET ${SW_STDIN_PATH}<runId>` requests (see `stdin/sw.ts`) and
 * lets every other request go to the network untouched. Never uses Cache
 * Storage. On `install` it calls `skipWaiting()`, on `activate`
 * `clients.claim()`. Accepts `FrameToSwMessage`s only from `window` clients.
 * Drops the channels of a window client that no longer exists. A request for a
 * channel it does not know (the browser restarted it) is first offered to the
 * window clients with `stdin-resync`.
 */

import {
	frameToSwMessage,
	STDIN_CONSUMED_HEADER,
	STDIN_KIND_HEADER,
	STDIN_RETRY_HEADER,
	STDIN_TOKEN_HEADER,
	StdinChannels,
	type SwToFrameMessage,
} from "./stdin/sw";
import { SW_STDIN_PATH } from "./stdin/types";

/// The parts of the service worker global scope and events this file uses
/// (the project compiles against the DOM lib, which lacks them).
interface SwClient {
	id: string;
	type: string;
	postMessage(message: unknown): void;
}

interface SwScope {
	location: Location;
	clients: {
		claim(): Promise<void>;
		matchAll(options: { type: "window" }): Promise<SwClient[]>;
	};
	skipWaiting(): Promise<void>;
	addEventListener<E>(type: string, listener: (event: E) => void): void;
}

interface ExtendableEvent {
	waitUntil(promise: Promise<unknown>): void;
}

interface SwMessageEvent extends ExtendableEvent {
	data: unknown;
	source: SwClient | null;
}

interface SwFetchEvent extends ExtendableEvent {
	request: Request;
	clientId: string;
	respondWith(response: Promise<Response>): void;
}

/** Installs the service worker's event listeners; called once at the top of the entry module. */
export function startServiceWorker(): void {
	const scope = self as unknown as SwScope;
	const channels = new StdinChannels();

	scope.addEventListener("install", (event: ExtendableEvent) => {
		event.waitUntil(scope.skipWaiting());
	});

	scope.addEventListener("activate", (event: ExtendableEvent) => {
		event.waitUntil(scope.clients.claim());
	});

	scope.addEventListener("message", (event: SwMessageEvent) => {
		const sender = event.source;
		if (sender?.type !== "window") return;
		const parsed = frameToSwMessage.safeParse(event.data);
		if (!parsed.success) return;
		const message = parsed.data;
		switch (message.type) {
			case "stdin-open":
				channels.open(
					message.runId,
					message.token,
					sender.id,
					message.lines,
					message.eof,
				);
				event.waitUntil(
					scope.clients
						.matchAll({ type: "window" })
						.then((windows) =>
							channels.retainOwners(new Set(windows.map((w) => w.id))),
						),
				);
				break;
			case "keepalive":
				break;
			case "stdin-line":
				channels.line(message.runId, message.line, sender.id);
				break;
			case "stdin-eof":
				channels.eof(message.runId, sender.id);
				break;
			case "stdin-cancel":
				channels.cancel(message.runId, sender.id);
				break;
		}
	});

	scope.addEventListener("fetch", (event: SwFetchEvent) => {
		const url = new URL(event.request.url);
		if (
			event.request.method !== "GET" ||
			url.origin !== scope.location.origin ||
			!url.pathname.startsWith(SW_STDIN_PATH)
		) {
			return;
		}
		const runId = url.pathname.slice(SW_STDIN_PATH.length);
		const token = event.request.headers.get(STDIN_TOKEN_HEADER);
		const consumed = Number(event.request.headers.get(STDIN_CONSUMED_HEADER));
		const owner = channels.ack(runId, token, consumed);
		if (owner !== null) {
			const message: SwToFrameMessage = {
				type: "stdin-consumed",
				runId,
				consumed,
			};
			event.waitUntil(
				scope.clients.matchAll({ type: "window" }).then((windows) => {
					for (const client of windows) {
						if (client.id === owner) client.postMessage(message);
					}
				}),
			);
		}
		const resync = () => {
			const message: SwToFrameMessage = {
				type: "stdin-resync",
				runId,
				consumed: Number.isInteger(consumed) && consumed >= 0 ? consumed : 0,
			};
			void scope.clients.matchAll({ type: "window" }).then((windows) => {
				for (const client of windows) client.postMessage(message);
			});
		};
		event.respondWith(
			channels.read(runId, token, event.clientId, resync).then((reply) => {
				const headers = new Headers({ "Cache-Control": "no-store" });
				if (reply.kind) headers.set(STDIN_KIND_HEADER, reply.kind);
				if (reply.retry) headers.set(STDIN_RETRY_HEADER, "1");
				if (reply.body !== undefined) {
					headers.set("Content-Type", "text/plain; charset=utf-8");
				}
				return new Response(reply.body ?? null, {
					status: reply.status,
					headers,
				});
			}),
		);
	});
}
