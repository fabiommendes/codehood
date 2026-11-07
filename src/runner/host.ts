/**
 * App-side client of the runner: owns the hidden runner iframe of a page and
 * multiplexes every run of that page over it.
 *
 * Runs in the browser, on the app origin. Accepts messages only from the
 * iframe's window with origin `runnerOrigin`, and parses them with
 * `runnerToAppMessage`.
 */

import {
	type AppToRunnerMessage,
	type ExitMessage,
	type LanguageId,
	RUNNER_PROTOCOL_VERSION,
	type RunMode,
	type RunnerToAppMessage,
	type RunState,
	runnerToAppMessage,
	type StdinKind,
} from "./protocol";

/** What the runner frame of this page can do, from its `ready` message. */
export interface RunnerCapabilities {
	stdin: StdinKind;
	languages: LanguageId[];
}

/** A program to run. */
export interface RunRequest {
	language: LanguageId;
	mode: RunMode;
	files: Record<string, string>;
	entry: string;
	maxOutputBytes?: number;
}

/** Callbacks for the events of one run, in the order the frame sent them. */
export interface RunHandlers {
	onStatus?(state: RunState): void;
	onProgress?(loaded: number, total: number | null): void;
	onOutput?(stream: "stdout" | "stderr", text: string): void;
}

/**
 * How a run ended, as the `exit` message said.
 *
 * `reloaded` is added by the host: the page's frame was replaced because its
 * bundle went stale while this run was active. The run did not fail by
 * itself; the UI should tell the user to run it again.
 */
export type RunExit = Pick<ExitMessage, "code" | "message" | "diagnostics"> & {
	reason: ExitMessage["reason"] | "reloaded";
};

/** A run in progress. */
export interface RunHandle {
	/// Changes when the host repeats the run after a stale bundle.
	readonly runId: string;

	/** Sends one line of input, without its newline. */
	sendLine(line: string): void;

	/** Sends end of input. */
	sendEof(): void;

	/** Asks the frame to terminate the run; `done` then resolves with `stopped`. */
	stop(): void;

	/** Resolves once with the run's exit; never rejects. */
	readonly done: Promise<RunExit>;
}

/** Thrown when the runner cannot take runs on this page. */
export class RunnerUnavailable extends Error {
	constructor(
		/// `unsupported`: the frame reported `stdin: none`. `timeout`: no `ready`
		/// in time. `protocol`: the frame speaks another protocol version.
		readonly reason: "unsupported" | "timeout" | "protocol",
	) {
		super(`runner unavailable: ${reason}`);
		this.name = "RunnerUnavailable";
	}
}

/// How long the host waits for the frame's `ready`.
export const READY_TIMEOUT_MS = 15_000;

/// Hosts created by `RunnerHost.shared`, one per runner origin of this page.
const sharedHosts = new Map<string, RunnerHost>();

/// One iframe load: its element and the outcome of waiting for its `ready`.
interface FrameState {
	iframe: HTMLIFrameElement;
	ready: Promise<RunnerCapabilities>;
	settled: boolean;
	/// No `ready` came in time: the frame never became usable.
	timedOut: boolean;
	timer: ReturnType<typeof setTimeout> | undefined;
	resolve(capabilities: RunnerCapabilities): void;
	reject(error: RunnerUnavailable): void;
}

/// A run the host sent and has not seen exit.
interface ActiveRun {
	handlers: RunHandlers;
	done: Promise<RunExit>;
	finish(exit: RunExit): void;
}

/**
 * The page's runner iframe and its runs.
 *
 * @example
 * const host = RunnerHost.shared("http://127.0.0.1:4321");
 * const run = await host.run(
 *   { language: "javascript", mode: "script", files: { "main.js": "console.log(1)" }, entry: "main.js" },
 *   { onOutput: (_, text) => term.write(text) },
 * );
 * const exit = await run.done;
 */
export class RunnerHost {
	/// Origin of the runner, normalized.
	private readonly origin: string;
	private readonly isExclusive: boolean;
	private frame: FrameState | null = null;
	private readonly runs = new Map<string, ActiveRun>();
	/// Counts the `run` and `reload` calls, to tell a retry that another one took the frame.
	private takeovers = 0;
	/// A stale reserve already reloaded the frame and no run has worked since.
	private reserveReloaded = false;

	private constructor(runnerOrigin: string, exclusive: boolean) {
		this.origin = new URL(runnerOrigin).origin;
		this.isExclusive = exclusive;
		window.addEventListener("message", (event) => this.onMessage(event));
	}

	/**
	 * Returns the page's host for `runnerOrigin`, creating it on first call.
	 *
	 * Creating it appends nothing yet: the iframe is added on the first `ready()` or `run()`.
	 */
	static shared(runnerOrigin: string): RunnerHost {
		const origin = new URL(runnerOrigin).origin;
		let host = sharedHosts.get(origin);
		if (!host) {
			host = new RunnerHost(origin, false);
			sharedHosts.set(origin, host);
		}
		return host;
	}

	/**
	 * Creates a host with its own iframe, loaded as `/runner/frame?exclusive=1`.
	 *
	 * Review mode uses it: one run at a time, so `run()` stops the run in
	 * progress before starting the next, and the frame refuses a second
	 * concurrent run on its own.
	 */
	static exclusive(runnerOrigin: string): RunnerHost {
		return new RunnerHost(runnerOrigin, true);
	}

	/**
	 * Adds the iframe if needed and waits for its `ready`.
	 *
	 * A frame that timed out never became ready, so no run depends on it: it
	 * is replaced by a new one instead of reused.
	 *
	 * @throws {RunnerUnavailable} when the frame does not become ready or cannot run code.
	 */
	ready(): Promise<RunnerCapabilities> {
		if (this.frame?.timedOut) {
			this.frame.iframe.remove();
			this.frame = null;
		}
		return (this.frame ?? this.createFrame()).ready;
	}

	/**
	 * Asks the frame to keep a loaded reserve Worker for `language`.
	 *
	 * Call it on the first focus or edit of an editor of that language, and
	 * again after `reload()`. Never call it when code execution is off. Adds
	 * the iframe if needed; does nothing when the runner is unavailable.
	 * Never throws.
	 */
	prepare(language: LanguageId): void {
		try {
			this.ready().then(
				() => this.post({ type: "prepare", language }),
				() => {},
			);
		} catch {
			// Nothing to prepare without an iframe.
		}
	}

	/**
	 * Starts a run with a fresh `runId`.
	 *
	 * When the frame reports `stale-bundle` (a deploy replaced the bundle it
	 * was loaded with), the host reloads the frame and repeats the run once
	 * with a new `runId`; `handle.runId` follows. Other runs of the page end
	 * with `reloaded`. A second `stale-bundle` is reported as the exit. The
	 * host keeps the request only until the run ends.
	 *
	 * @throws {RunnerUnavailable} as `ready()` does.
	 */
	async run(request: RunRequest, handlers: RunHandlers): Promise<RunHandle> {
		const takeover = ++this.takeovers;
		await this.ready();
		if (this.isExclusive) {
			const previous = [...this.runs.entries()];
			for (const [runId] of previous) this.post({ type: "stop", runId });
			await Promise.all(previous.map(([, run]) => run.done));
		}
		let current = "";
		let resolveDone: (exit: RunExit) => void = () => {};
		const done = new Promise<RunExit>((resolve) => {
			resolveDone = resolve;
		});
		/// Stop was pressed between the stale exit and the repeat.
		let cancelled = false;
		/// Whether the repeat must not happen: stopped, or (exclusive) another run or reload took the frame.
		const displaced = () =>
			cancelled || (this.isExclusive && this.takeovers !== takeover);
		const abandon = () => resolveDone({ reason: "stopped", code: null });
		const launch = (retried: boolean): void => {
			const runId = crypto.randomUUID();
			current = runId;
			this.runs.set(runId, {
				handlers,
				done,
				finish: (exit) => {
					if (exit.reason !== "stale-bundle" || retried) {
						if (exit.reason !== "stale-bundle") this.reserveReloaded = false;
						resolveDone(exit);
						return;
					}
					if (displaced()) {
						abandon();
						return;
					}
					this.reloadFrame("reloaded").then(
						() => (displaced() ? abandon() : launch(true)),
						() => resolveDone(exit),
					);
				},
			});
			this.post({
				type: "run",
				runId,
				language: request.language,
				mode: request.mode,
				files: request.files,
				entry: request.entry,
				...(request.maxOutputBytes === undefined
					? {}
					: { maxOutputBytes: request.maxOutputBytes }),
			});
		};
		launch(false);
		return {
			get runId() {
				return current;
			},
			done,
			sendLine: (line) => {
				if (this.runs.has(current)) {
					this.post({ type: "stdin", runId: current, line });
				}
			},
			sendEof: () => {
				if (this.runs.has(current)) {
					this.post({ type: "stdin-eof", runId: current });
				}
			},
			stop: () => {
				if (this.runs.has(current)) {
					this.post({ type: "stop", runId: current });
				} else {
					cancelled = true;
					abandon();
				}
			},
		};
	}

	/**
	 * Replaces the iframe with a freshly loaded one and waits for its `ready`.
	 *
	 * Runs in progress end with `stopped`. Review mode calls it before each submission.
	 *
	 * @throws {RunnerUnavailable} as `ready()` does.
	 */
	reload(): Promise<RunnerCapabilities> {
		this.takeovers++;
		return this.reloadFrame("stopped");
	}

	/// Replaces the iframe; the runs in progress end with `reason`.
	private reloadFrame(
		reason: "stopped" | "reloaded",
	): Promise<RunnerCapabilities> {
		const old = this.frame;
		for (const [runId, run] of [...this.runs]) {
			this.runs.delete(runId);
			run.finish({ reason, code: null });
		}
		const fresh = this.createFrame();
		if (old) {
			clearTimeout(old.timer);
			old.iframe.remove();
			// Callers still waiting on the old frame get the new one's outcome.
			if (!old.settled) fresh.ready.then(old.resolve, old.reject);
		}
		return fresh.ready;
	}

	private createFrame(): FrameState {
		const iframe = document.createElement("iframe");
		iframe.src = `${this.origin}/runner/frame${this.isExclusive ? "?exclusive=1" : ""}`;
		iframe.title = "runner";
		iframe.hidden = true;
		iframe.tabIndex = -1;
		iframe.setAttribute("aria-hidden", "true");
		iframe.dataset.runnerFrame = this.isExclusive ? "exclusive" : "shared";
		const state: FrameState = {
			iframe,
			settled: false,
			timedOut: false,
			timer: undefined,
			ready: Promise.resolve({ stdin: "none", languages: [] }),
			resolve: () => {},
			reject: () => {},
		};
		state.ready = new Promise<RunnerCapabilities>((resolve, reject) => {
			state.resolve = (capabilities) => {
				state.settled = true;
				clearTimeout(state.timer);
				resolve(capabilities);
			};
			state.reject = (error) => {
				state.settled = true;
				clearTimeout(state.timer);
				reject(error);
			};
		});
		// A caller that never awaits `ready()` must not cause an unhandled rejection.
		state.ready.catch(() => {});
		state.timer = setTimeout(() => {
			state.timedOut = true;
			state.reject(new RunnerUnavailable("timeout"));
		}, READY_TIMEOUT_MS);
		this.frame = state;
		document.body.append(iframe);
		return state;
	}

	private post(message: AppToRunnerMessage): void {
		this.frame?.iframe.contentWindow?.postMessage(message, this.origin);
	}

	private onMessage(event: MessageEvent): void {
		const frame = this.frame;
		if (
			!frame ||
			event.origin !== this.origin ||
			event.source === null ||
			event.source !== frame.iframe.contentWindow
		) {
			return;
		}
		const data: unknown = event.data;
		if (
			typeof data === "object" &&
			data !== null &&
			(data as { type?: unknown }).type === "ready" &&
			(data as { protocol?: unknown }).protocol !== RUNNER_PROTOCOL_VERSION
		) {
			if (!frame.settled) frame.reject(new RunnerUnavailable("protocol"));
			return;
		}
		const parsed = runnerToAppMessage.safeParse(data);
		if (parsed.success) this.dispatch(frame, parsed.data);
	}

	private dispatch(frame: FrameState, message: RunnerToAppMessage): void {
		if (message.type === "stale-bundle") {
			// Runs in progress already loaded their Worker; the next one that
			// fails will report `stale-bundle` and trigger the reload itself.
			if (this.runs.size === 0 && !this.reserveReloaded) {
				this.reserveReloaded = true;
				this.reloadFrame("reloaded").catch(() => {});
			}
			return;
		}
		if (message.type === "ready") {
			if (frame.settled) return;
			if (message.stdin === "none") {
				frame.reject(new RunnerUnavailable("unsupported"));
			} else {
				frame.resolve({ stdin: message.stdin, languages: message.languages });
			}
			return;
		}
		const run = this.runs.get(message.runId);
		if (!run) return;
		switch (message.type) {
			case "status":
				run.handlers.onStatus?.(message.state);
				break;
			case "progress":
				run.handlers.onProgress?.(message.loaded, message.total);
				break;
			case "output":
				run.handlers.onOutput?.(message.stream, message.text);
				break;
			case "exit":
				this.runs.delete(message.runId);
				run.finish({
					reason: message.reason,
					code: message.code,
					message: message.message,
					diagnostics: message.diagnostics,
				});
				break;
		}
	}
}
