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

import type { Driver } from "./driver";
import { loadDriver } from "./drivers";
import { openStdinReader } from "./stdin";
import { StdinCancelled } from "./stdin/types";
import type {
	FrameToWorkerMessage,
	LoadMessage,
	StartMessage,
	WorkerToFrameMessage,
} from "./worker-protocol";

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
	lockDown(globalThis, LOCKED_GLOBALS);
	lockDown(navigator, LOCKED_NAVIGATOR);
}

/// Removes `names` from every object of the prototype chain of `root`, then
/// shadows them on `root` with frozen `undefined` values.
function lockDown(root: object, names: readonly string[]): void {
	for (let o: object | null = root; o; o = Object.getPrototypeOf(o)) {
		for (const name of names) {
			if (Object.hasOwn(o, name)) Reflect.deleteProperty(o, name);
		}
	}
	for (const name of names) {
		Object.defineProperty(root, name, {
			value: undefined,
			writable: false,
			configurable: false,
			enumerable: false,
		});
	}
}

/// The parts of the dedicated worker scope this file uses.
interface WorkerScope {
	postMessage(message: unknown): void;
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<FrameToWorkerMessage>) => void,
	): void;
}

/** Locks the scope down and runs the Worker's message loop; called once at the top of the entry module. */
export function startWorker(): void {
	lockDownWorkerScope();
	const scope = self as unknown as WorkerScope;
	// Student code shares this global and may replace `postMessage`: keep ours.
	const rawPost = scope.postMessage.bind(scope);
	const post = (message: WorkerToFrameMessage) => rawPost(message);
	let loading = false;
	let driver: Driver | null = null;
	let pendingStart: StartMessage | null = null;
	let started = false;

	async function load(message: LoadMessage) {
		try {
			const loaded = await loadDriver(message.language);
			await loaded.load({
				runtimeUrl: (path) => new URL(path, message.runtimeBase).href,
				progress: (done, total) =>
					post({ type: "progress", loaded: done, total }),
				program: message.program,
			});
			driver = loaded;
			post({ type: "loaded" });
			if (pendingStart) void start(pendingStart);
		} catch (error) {
			post({
				type: "exit",
				reason: "load-failed",
				code: null,
				message: describe(error),
			});
		}
	}

	async function start(message: StartMessage) {
		if (started || !driver) return;
		started = true;
		const current = driver;
		const reader = openStdinReader(message.stdin);
		post({ type: "status", state: "running" });
		try {
			const code = await current.run({
				files: message.files,
				entry: message.entry,
				mode: message.mode,
				stdout: (text) => post({ type: "output", stream: "stdout", text }),
				stderr: (text) => post({ type: "output", stream: "stderr", text }),
				readLine() {
					post({ type: "status", state: "waiting-input" });
					try {
						return reader.readLine();
					} finally {
						post({ type: "status", state: "running" });
					}
				},
			});
			post({
				type: "exit",
				reason: "exited",
				code: Number.isInteger(code) ? code : 0,
			});
		} catch (error) {
			if (error instanceof StdinCancelled) return;
			post({
				type: "exit",
				reason: "crashed",
				code: null,
				message: describe(error),
			});
		}
	}

	scope.addEventListener("message", (event) => {
		const message = event.data;
		if (typeof message !== "object" || message === null) return;
		if (message.type === "load" && !loading) {
			loading = true;
			void load(message);
		} else if (message.type === "start" && !started) {
			if (driver) void start(message);
			else pendingStart ??= message;
		}
	});
}

/// Short plain-text description of a thrown value, within the protocol's size limit.
function describe(error: unknown): string {
	const text = error instanceof Error ? error.message : String(error);
	return text.slice(0, 2000);
}
