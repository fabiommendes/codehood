/**
 * Entry of the runner frame page, the document served at `/runner/frame`
 * on the runner origin.
 *
 * Student code never runs in this document: only in Workers it creates. The
 * frame handles a message only when `event.source === window.parent` and
 * `event.origin === appOrigin`; anything else (a popup, an opener, another
 * frame, the frame's own Workers through `window`) is dropped. It posts only
 * to `window.parent` with target origin `appOrigin`.
 *
 * The frame loads its scripts only from `/runner/<version>/`, never from
 * `/_astro/` or `public/`.
 */

import {
	type AppToRunnerMessage,
	appToRunnerMessage,
	type Diagnostic,
	type ExitReason,
	FILES_LIMIT_BYTES,
	type LanguageId,
	OUTPUT_FLUSH_MS,
	OUTPUT_LIMIT_BYTES,
	OUTPUT_MESSAGES_LIMIT,
	RUNNER_PROTOCOL_VERSION,
	type RunMessage,
	type RunMode,
	type RunnerToAppMessage,
	type RunState,
	type StdinKind,
} from "../protocol";
import { availableLanguages } from "./drivers";
import { createStdinWriter, detectStdinKind } from "./stdin";
import type { StdinWriter } from "./stdin/types";
import { utf8Length } from "./utf8";
import {
	type LoadMessage,
	type StartMessage,
	workerToFrameMessage,
} from "./worker-protocol";

/** Settings the server writes into the frame page. */
export interface FrameConfig {
	/// Origin of the app allowed to drive this frame (`PUBLIC_URL`).
	appOrigin: string;
	/// Absolute URL of the versioned bundle directory (`/runner/<version>/`).
	bundleBase: string;
	/// Announce the `fake` driver (every environment but production).
	withFake: boolean;
	/// At most one run at a time: a `run` while another is active ends at once
	/// with `crashed`. Set by `/runner/frame?exclusive=1`, which review mode uses.
	exclusive: boolean;
}

/// Deadline for one origin storage cleanup.
export const STORAGE_CLEANUP_TIMEOUT_MS = 2000;

/**
 * Boots the frame: starts the storage cleanup, picks the stdin transport,
 * starts listening to the app and posts `ready`, without waiting for the
 * cleanup.
 *
 * Reserves: on `prepare` it creates a module Worker from
 * `${bundleBase}worker.js` and sends `load`, keeping at most one reserve per
 * language. A reserve is not tied to any `runId` or stdin channel until a
 * run consumes it. A reserve that posts anything outside the load protocol
 * is terminated. All reserves are terminated when the document becomes
 * hidden (`visibilitychange`). A failed reserve is dropped silently.
 *
 * For each `run` it starts `clearOriginStorage` without waiting for it,
 * takes the language's reserve (or creates a Worker and sends `load` if
 * there is none), opens a stdin channel and, once the Worker posted
 * `loaded`, sends `start`. The next reserve for that language is created
 * only after this run ends, and only if the app sent `prepare` for it since
 * the last reserve was consumed or dropped. It forwards Worker messages that parse: output
 * and `status` in batches every `OUTPUT_FLUSH_MS` (a `status` goes out at once only if none did in the last interval, the rest collapse into one per batch, and only when the state
 * changes). It counts output bytes and every message the Worker posts after
 * `start` (dropped ones included), and terminates the
 * Worker on `stop`, when either output limit is passed, or on the first
 * `exit` the Worker posts (student code can forge one); later messages from
 * that Worker are dropped. A `run` with a `runId` already used in this frame
 * load is ignored. Each accepted run ends with exactly one `exit`.
 *
 * A Worker that fails before `loaded` makes the frame fetch its script: on
 * 404 the run ends with `stale-bundle` (a reserve posts `stale-bundle`
 * instead), on anything else with `load-failed`.
 */
export function startFrame(config: FrameConfig): void {
	void clearOriginStorage(STORAGE_CLEANUP_TIMEOUT_MS);
	const languages = availableLanguages(config.withFake);
	const runtimeBase = new URL("/runner/rt/", location.origin).href;
	let stdinKind: StdinKind = "none";

	/// A Worker, either a reserve (`run` is null) or the one of a run.
	interface Slot {
		language: LanguageId;
		worker: Worker;
		loaded: boolean;
		started: boolean;
		dead: boolean;
		progress: { loaded: number; total: number | null } | null;
		run: Run | null;
	}

	interface Run {
		runId: string;
		language: LanguageId;
		mode: RunMode;
		files: Record<string, string>;
		entry: string;
		maxOutputBytes: number;
		writer: StdinWriter;
		slot: Slot | null;
		ended: boolean;
		bytes: number;
		messages: number;
		/// Last state posted to the app.
		lastState: RunState | null;
		/// Output and status waiting for the next flush, in order; at most one status.
		pending: (
			| { kind: "output"; stream: "stdout" | "stderr"; text: string }
			| { kind: "status"; state: RunState }
		)[];
		flushTimer: ReturnType<typeof setTimeout> | null;
		/// Open for `OUTPUT_FLUSH_MS` after a Worker status went out at once.
		statusWindow: ReturnType<typeof setTimeout> | null;
	}

	const usedRunIds = new Set<string>();
	const runs = new Map<string, Run>();
	const reserves = new Map<LanguageId, Slot>();
	/// Languages the app asked a reserve for since the last one was consumed or dropped.
	const wanted = new Set<LanguageId>();

	function post(message: RunnerToAppMessage): void {
		if (window.parent !== window) {
			window.parent.postMessage(message, config.appOrigin);
		}
	}

	function activeRuns(language: LanguageId): number {
		let count = 0;
		for (const run of runs.values()) if (run.language === language) count++;
		return count;
	}

	function flushOutput(run: Run): void {
		if (run.flushTimer !== null) clearTimeout(run.flushTimer);
		run.flushTimer = null;
		const pending = run.pending;
		run.pending = [];
		for (const item of pending) {
			if (item.kind === "output") {
				post({
					type: "output",
					runId: run.runId,
					stream: item.stream,
					text: item.text,
				});
			} else if (item.state !== run.lastState) {
				run.lastState = item.state;
				post({ type: "status", runId: run.runId, state: item.state });
			}
		}
	}

	/// Posts a Worker status at once if none went out in the last `OUTPUT_FLUSH_MS`;
	/// otherwise queues it for the next flush, replacing the one already queued.
	function queueStatus(run: Run, state: RunState): void {
		if (run.statusWindow === null) {
			run.statusWindow = setTimeout(() => {
				run.statusWindow = null;
			}, OUTPUT_FLUSH_MS);
			emitStatus(run, state);
			return;
		}
		run.pending = run.pending.filter((item) => item.kind !== "status");
		run.pending.push({ kind: "status", state });
		run.flushTimer ??= setTimeout(() => flushOutput(run), OUTPUT_FLUSH_MS);
	}

	/// Posts a status of the frame itself at once, after the output queued before it.
	function emitStatus(run: Run, state: RunState): void {
		flushOutput(run);
		if (run.lastState === state) return;
		run.lastState = state;
		post({ type: "status", runId: run.runId, state });
	}

	function emitOutput(run: Run, stream: "stdout" | "stderr", text: string) {
		if (text === "") return;
		run.bytes += utf8Length(text);
		if (run.bytes > run.maxOutputBytes) {
			finish(run, "output-limit", null);
			return;
		}
		// Batches keep the order of the two streams: only neighbors of the same stream merge.
		const last = run.pending[run.pending.length - 1];
		if (last?.kind === "output" && last.stream === stream) last.text += text;
		else run.pending.push({ kind: "output", stream, text });
		run.flushTimer ??= setTimeout(() => flushOutput(run), OUTPUT_FLUSH_MS);
	}

	/// Ends `run` with its one `exit`, terminating its Worker and stdin channel.
	function finish(
		run: Run,
		reason: ExitReason,
		code: number | null,
		message?: string,
		diagnostics?: Diagnostic[],
	): void {
		if (run.ended) return;
		run.ended = true;
		flushOutput(run);
		if (run.statusWindow !== null) clearTimeout(run.statusWindow);
		runs.delete(run.runId);
		if (run.slot) {
			run.slot.dead = true;
			run.slot.worker.terminate();
		}
		run.writer.cancel();
		post({
			type: "exit",
			runId: run.runId,
			reason,
			code,
			...(message === undefined ? {} : { message: message.slice(0, 2000) }),
			...(diagnostics?.length ? { diagnostics } : {}),
		});
		if (
			wanted.has(run.language) &&
			!reserves.has(run.language) &&
			activeRuns(run.language) === 0
		) {
			createReserve(run.language);
		}
	}

	function dropSlot(slot: Slot): void {
		slot.dead = true;
		slot.worker.terminate();
		if (reserves.get(slot.language) === slot) {
			reserves.delete(slot.language);
			wanted.delete(slot.language);
		}
	}

	/// A Worker that broke the protocol or failed: ends its run, or drops the reserve.
	function fail(slot: Slot, message: string): void {
		if (slot.run) {
			finish(slot.run, slot.started ? "crashed" : "load-failed", null, message);
		} else {
			dropSlot(slot);
		}
	}

	/// Sends `start` to a loaded Worker that a run owns.
	function begin(slot: Slot): void {
		const run = slot.run;
		if (!run || slot.started || run.ended) return;
		slot.started = true;
		const message: StartMessage = {
			type: "start",
			mode: run.mode,
			files: run.files,
			entry: run.entry,
			stdin: run.writer.transport,
			maxOutputBytes: run.maxOutputBytes,
		};
		slot.worker.postMessage(message);
	}

	function onWorkerMessage(slot: Slot, data: unknown): void {
		if (slot.dead) return;
		const run = slot.run;
		if (!slot.started) {
			const parsed = workerToFrameMessage.safeParse(data);
			const message = parsed.success ? parsed.data : null;
			if (message?.type === "progress") {
				slot.progress = { loaded: message.loaded, total: message.total };
				if (run) {
					post({ type: "progress", runId: run.runId, ...slot.progress });
				}
			} else if (message?.type === "loaded") {
				slot.loaded = true;
				begin(slot);
			} else if (message?.type === "exit" && message.reason === "load-failed") {
				void confirmStale(slot, message.message ?? "the Worker failed");
			} else {
				fail(slot, "the Worker broke the load protocol");
			}
			return;
		}
		if (!run || run.ended) return;
		if (++run.messages > OUTPUT_MESSAGES_LIMIT) {
			finish(run, "output-limit", null);
			return;
		}
		const parsed = workerToFrameMessage.safeParse(data);
		if (!parsed.success) return;
		const message = parsed.data;
		switch (message.type) {
			case "status":
				if (message.state === "waiting-input") run.writer.readerWaiting();
				queueStatus(run, message.state);
				break;
			case "output":
				emitOutput(run, message.stream, message.text);
				break;
			case "exit":
				finish(
					run,
					message.reason,
					message.reason === "exited" ? message.code : null,
					message.message,
					message.reason === "exited" ? message.diagnostics : undefined,
				);
				break;
		}
	}

	/// Fetches the Worker script to tell a 404 (the server dropped this bundle
	/// version) from any other failure; `reason` is the message of the latter.
	/// A cached script can load while a chunk it imports is gone, so this runs
	/// for the `error` event and for a driver `load-failed` alike.
	async function confirmStale(slot: Slot, reason: string): Promise<void> {
		let stale = false;
		try {
			const response = await fetch(`${config.bundleBase}worker.js`, {
				cache: "no-store",
			});
			void response.body?.cancel();
			stale = response.status === 404;
		} catch {
			// Network failure: report a plain load failure.
		}
		if (slot.dead) return;
		if (!stale) {
			fail(slot, reason);
			return;
		}
		if (slot.run) {
			finish(
				slot.run,
				"stale-bundle",
				null,
				"the runner bundle changed after this page loaded",
			);
		} else {
			dropSlot(slot);
			post({ type: "stale-bundle" });
		}
	}

	function createSlot(
		language: LanguageId,
		program?: LoadMessage["program"],
	): Slot {
		const worker = new Worker(`${config.bundleBase}worker.js`, {
			type: "module",
		});
		const slot: Slot = {
			language,
			worker,
			loaded: false,
			started: false,
			dead: false,
			progress: null,
			run: null,
		};
		worker.addEventListener("message", (event) =>
			onWorkerMessage(slot, event.data),
		);
		worker.addEventListener("error", (event) => {
			event.preventDefault();
			if (slot.dead) return;
			if (slot.loaded || slot.started) {
				fail(slot, "the Worker failed");
				return;
			}
			void confirmStale(slot, "the Worker failed");
		});
		worker.addEventListener("messageerror", () => {
			if (!slot.dead)
				fail(slot, "the Worker sent a message that cannot be read");
		});
		const load: LoadMessage = { type: "load", language, runtimeBase, program };
		worker.postMessage(load);
		return slot;
	}

	function createReserve(language: LanguageId): void {
		if (document.visibilityState === "hidden") return;
		try {
			reserves.set(language, createSlot(language));
		} catch {
			wanted.delete(language);
		}
	}

	/// Hands `run` the reserve of its language, or a new Worker.
	function claimWorker(run: Run): void {
		const reserve = reserves.get(run.language);
		let slot: Slot;
		if (reserve) {
			reserves.delete(run.language);
			slot = reserve;
		} else {
			slot = createSlot(run.language, {
				files: run.files,
				entry: run.entry,
			});
		}
		wanted.delete(run.language);
		slot.run = run;
		run.slot = slot;
		if (slot.loaded) {
			begin(slot);
			return;
		}
		emitStatus(run, "loading");
		if (slot.progress) {
			post({ type: "progress", runId: run.runId, ...slot.progress });
		}
	}

	function onRun(message: RunMessage): void {
		if (usedRunIds.has(message.runId)) return;
		usedRunIds.add(message.runId);
		const { runId, language } = message;
		const crashed = (why: string) =>
			post({
				type: "exit",
				runId,
				reason: "crashed",
				code: null,
				message: why,
			});
		let size = 0;
		for (const text of Object.values(message.files)) size += utf8Length(text);
		const refusal =
			stdinKind === "none"
				? "this browser cannot run code"
				: !languages.includes(language)
					? "language not available"
					: config.exclusive && runs.size > 0
						? "another run is active in this frame"
						: size > FILES_LIMIT_BYTES
							? "files are too large"
							: message.entry in message.files
								? null
								: "entry is not a file";
		if (refusal !== null) {
			crashed(refusal);
			return;
		}

		void clearOriginStorage(STORAGE_CLEANUP_TIMEOUT_MS);
		let writer: StdinWriter;
		try {
			writer = createStdinWriter(stdinKind, runId);
		} catch (error) {
			crashed(error instanceof Error ? error.message : "stdin failed");
			return;
		}
		const run: Run = {
			runId,
			language,
			mode: message.mode,
			files: message.files,
			entry: message.entry,
			maxOutputBytes: message.maxOutputBytes ?? OUTPUT_LIMIT_BYTES,
			writer,
			slot: null,
			ended: false,
			bytes: 0,
			messages: 0,
			lastState: null,
			statusWindow: null,
			pending: [],
			flushTimer: null,
		};
		runs.set(runId, run);
		try {
			claimWorker(run);
		} catch (error) {
			finish(
				run,
				"load-failed",
				null,
				error instanceof Error ? error.message : "",
			);
		}
	}

	function onPrepare(language: LanguageId): void {
		if (stdinKind === "none" || !languages.includes(language)) return;
		if (reserves.has(language)) return;
		wanted.add(language);
		if (activeRuns(language) === 0) createReserve(language);
	}

	function onMessage(message: AppToRunnerMessage): void {
		switch (message.type) {
			case "prepare":
				onPrepare(message.language);
				return;
			case "run":
				onRun(message);
				return;
			case "stdin":
				try {
					runs.get(message.runId)?.writer.writeLine(message.line);
				} catch {
					// A line over the limit is refused; the run goes on.
				}
				return;
			case "stdin-eof":
				runs.get(message.runId)?.writer.end();
				return;
			case "stop": {
				const run = runs.get(message.runId);
				if (run) finish(run, "stopped", null);
			}
		}
	}

	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState !== "hidden") return;
		for (const slot of [...reserves.values()]) dropSlot(slot);
	});

	void detectStdinKind().then((kind) => {
		stdinKind = kind;
		window.addEventListener("message", (event) => {
			if (
				window.parent === window ||
				event.source !== window.parent ||
				event.origin !== config.appOrigin
			) {
				return;
			}
			const parsed = appToRunnerMessage.safeParse(event.data);
			if (parsed.success) onMessage(parsed.data);
		});
		post({
			type: "ready",
			protocol: RUNNER_PROTOCOL_VERSION,
			stdin: kind,
			languages,
		});
	});
}

/**
 * Deletes every IndexedDB database, every Cache Storage cache and every
 * entry of the origin private file system of this origin, all in parallel,
 * giving up after `timeoutMs`.
 *
 * A database another context keeps open is left for a later cleanup instead
 * of being waited on. The service worker registration stays. Never rejects.
 */
export async function clearOriginStorage(timeoutMs: number): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<void>((resolve) => {
		timer = setTimeout(resolve, timeoutMs);
	});
	const work = Promise.allSettled([
		clearDatabases(),
		clearCaches(),
		clearOpfs(),
	]);
	await Promise.race([work, deadline]);
	clearTimeout(timer);
}

async function clearDatabases(): Promise<void> {
	const databases = await indexedDB.databases();
	await Promise.all(
		databases.map(
			(db) =>
				new Promise<void>((resolve) => {
					if (db.name === undefined) return resolve();
					const request = indexedDB.deleteDatabase(db.name);
					request.onsuccess = request.onerror = () => resolve();
					// Another context holds it open: the delete finishes on its own later.
					request.onblocked = () => resolve();
				}),
		),
	);
}

async function clearCaches(): Promise<void> {
	await Promise.all((await caches.keys()).map((name) => caches.delete(name)));
}

async function clearOpfs(): Promise<void> {
	const root =
		(await navigator.storage.getDirectory()) as FileSystemDirectoryHandle & {
			keys(): AsyncIterable<string>;
		};
	const names: string[] = [];
	for await (const name of root.keys()) names.push(name);
	await Promise.all(
		names.map((name) => root.removeEntry(name, { recursive: true })),
	);
}
