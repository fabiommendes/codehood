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

import { DIAGNOSTICS_LIMIT, type Diagnostic } from "../protocol";
import type { Driver } from "./driver";
import { loadDriver } from "./drivers";
import { openStdinReader } from "./stdin";
import { StdinCancelled } from "./stdin/types";
import { utf8Length } from "./utf8";
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

/// Properties removed from `navigator` for the same reason (`storage` gives OPFS, `locks` is a channel between runs).
export const LOCKED_NAVIGATOR = ["storage", "serviceWorker", "locks"] as const;

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
		let left = message.maxOutputBytes;
		/// Posts `text` cut to the remaining budget plus one byte, so the frame
		/// still sees the limit passed; anything after that is dropped.
		const emit = (stream: "stdout" | "stderr", text: string) => {
			if (left < 0) return;
			const size = utf8Length(text);
			if (size > left) {
				text = text.slice(0, left + 1);
				left = -1;
			} else {
				left -= size;
			}
			post({ type: "output", stream, text });
		};
		const diagnostics: Diagnostic[] = [];
		try {
			const code = await current.run({
				files: message.files,
				entry: message.entry,
				mode: message.mode,
				stdout: (text) => emit("stdout", text),
				stderr: (text) => emit("stderr", text),
				diagnose(found) {
					if (diagnostics.length < DIAGNOSTICS_LIMIT) diagnostics.push(found);
				},
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
				...(diagnostics.length > 0 ? { diagnostics } : {}),
			});
		} catch (error) {
			// A stop is decided by the frame, which terminates the Worker first:
			// a cancelled read that reaches this point means the channel was lost.
			post({
				type: "exit",
				reason: "crashed",
				code: null,
				message:
					error instanceof StdinCancelled
						? "stdin channel lost"
						: describe(error),
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
