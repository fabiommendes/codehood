/**
 * Entry of the runner's service worker (`/runner/sw.js`, scope `/runner/`).
 *
 * Answers only `GET ${SW_STDIN_PATH}<runId>` requests (see `stdin/sw.ts`) and
 * lets every other request go to the network untouched. Never uses Cache
 * Storage. On `install` it calls `skipWaiting()`, on `activate`
 * `clients.claim()`. Accepts `FrameToSwMessage`s only from `window` clients.
 * Drops the channels of a window client that no longer exists.
 */

/** Installs the service worker's event listeners; called once at the top of the entry module. */
export function startServiceWorker(): void {
	throw new Error("not implemented");
}
