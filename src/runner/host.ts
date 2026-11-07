/**
 * App-side client of the runner: owns the hidden runner iframe of a page and
 * multiplexes every run of that page over it.
 *
 * Runs in the browser, on the app origin. Accepts messages only from the
 * iframe's window with origin `runnerOrigin`, and parses them with
 * `runnerToAppMessage`.
 */

import type {
	ExitMessage,
	LanguageId,
	RunMode,
	RunState,
	StdinKind,
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

/** How a run ended, as the `exit` message said. */
export type RunExit = Pick<ExitMessage, "reason" | "code" | "message">;

/** A run in progress. */
export interface RunHandle {
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
	/**
	 * Returns the page's host for `runnerOrigin`, creating it on first call.
	 *
	 * Creating it appends nothing yet: the iframe is added on the first `ready()` or `run()`.
	 */
	static shared(_runnerOrigin: string): RunnerHost {
		throw new Error("not implemented");
	}

	/**
	 * Creates a host with its own iframe, loaded as `/runner/frame?exclusive=1`.
	 *
	 * Review mode uses it: one run at a time, so `run()` stops the run in
	 * progress before starting the next, and the frame refuses a second
	 * concurrent run on its own.
	 */
	static exclusive(_runnerOrigin: string): RunnerHost {
		throw new Error("not implemented");
	}

	/**
	 * Adds the iframe if needed and waits for its `ready`.
	 *
	 * @throws {RunnerUnavailable} when the frame does not become ready or cannot run code.
	 */
	ready(): Promise<RunnerCapabilities> {
		throw new Error("not implemented");
	}

	/**
	 * Asks the frame to keep a loaded reserve Worker for `language`.
	 *
	 * Call it on the first focus or edit of an editor of that language, and
	 * again after `reload()`. Never call it when code execution is off. Adds
	 * the iframe if needed; does nothing when the runner is unavailable.
	 * Never throws.
	 */
	prepare(_language: LanguageId): void {
		throw new Error("not implemented");
	}

	/**
	 * Starts a run with a fresh `runId`.
	 *
	 * @throws {RunnerUnavailable} as `ready()` does.
	 */
	run(_request: RunRequest, _handlers: RunHandlers): Promise<RunHandle> {
		throw new Error("not implemented");
	}

	/**
	 * Replaces the iframe with a freshly loaded one and waits for its `ready`.
	 *
	 * Runs in progress end with `stopped`. Review mode calls it before each submission.
	 *
	 * @throws {RunnerUnavailable} as `ready()` does.
	 */
	reload(): Promise<RunnerCapabilities> {
		throw new Error("not implemented");
	}
}
