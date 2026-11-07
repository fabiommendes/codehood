/**
 * Entry of a run's Worker (`/runner/<version>/worker.js`, module Worker).
 *
 * Two phases. At module evaluation it calls `lockDownWorkerScope` before
 * anything else. On `load` it imports the driver, calls `Driver.load`
 * (forwarding `progress`) and posts `loaded`, or `exit { load-failed }`. On
 * the first `start` it opens the stdin reader, posts `status: running`,
 * calls `Driver.run` and posts one `exit`. Wraps `readLine` so that the
 * Worker posts `waiting-input` before blocking and `running` after.
 */

/// Globals removed from the Worker before any driver or student code runs:
/// with them gone a run cannot persist data for the next one nor start a
/// Worker with fresh globals.
export const LOCKED_GLOBALS = [
	"indexedDB",
	"caches",
	"Worker",
	"SharedWorker",
	"BroadcastChannel",
] as const;

/// Properties removed from `navigator` for the same reason (`storage` gives OPFS).
export const LOCKED_NAVIGATOR = ["storage", "serviceWorker"] as const;

/**
 * Removes `LOCKED_GLOBALS` and `LOCKED_NAVIGATOR` from the Worker.
 *
 * Deletes each property from every object of the prototype chain of `self`
 * (`WorkerGlobalScope.prototype` and up) and of `navigator`
 * (`WorkerNavigator.prototype`), so `Object.getOwnPropertyDescriptor` on any
 * of them cannot bring the original back. Then defines each on `self` (or
 * `navigator`) as a non-writable, non-configurable data property whose value
 * is `undefined`.
 */
export function lockDownWorkerScope(): void {
	throw new Error("not implemented");
}

/** Locks the scope down and runs the Worker's message loop; called once at the top of the entry module. */
export function startWorker(): void {
	throw new Error("not implemented");
}
