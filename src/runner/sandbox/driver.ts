/**
 * The contract every language driver implements.
 *
 * A driver lives inside a run's Worker and runs exactly one program. It never
 * talks to the frame directly: it writes through `DriverContext` and reads
 * stdin through `readLine`. Stopping is not its concern: the frame terminates
 * the Worker.
 */

import type { LanguageId, RunMode } from "../protocol";

/** What a driver may use while loading its runtime. */
export interface LoadContext {
	/** Absolute URL of a runtime file, under the versioned runtime directory. */
	runtimeUrl(path: string): string;

	/** Reports download progress; `total` is null when unknown. */
	progress(loaded: number, total: number | null): void;

	/**
	 * The program, only when the Worker was created for a run that found no
	 * reserve; absent for a reserve. Only the `fake` driver reads it, to
	 * script its load.
	 */
	readonly program?: {
		readonly files: Readonly<Record<string, string>>;
		readonly entry: string;
	};
}

/** What a driver may use while running the program. */
export interface RunContext {
	/** Source files by relative POSIX path; `entry` is one of the keys. */
	readonly files: Readonly<Record<string, string>>;
	readonly entry: string;
	readonly mode: RunMode;

	stdout(text: string): void;
	stderr(text: string): void;

	/**
	 * Blocks until the user enters a line.
	 *
	 * The Worker reports `waiting-input` while blocked and `running` after.
	 *
	 * @returns the line without its newline, or `null` at end of input.
	 * @throws {StdinCancelled} when the run was stopped while waiting.
	 */
	readLine(): string | null;
}

/**
 * One language's runtime.
 *
 * Mounting a persistent file system (IDBFS, OPFS) or reading a runtime from
 * Cache Storage or IndexedDB is forbidden: runtimes come from HTTP only.
 */
export interface Driver {
	readonly language: LanguageId;
	readonly modes: readonly RunMode[];

	/**
	 * Downloads and starts the runtime.
	 *
	 * Runs in a Worker already locked down (`lockDownWorkerScope`), before any
	 * program is known; it may run long before `run`, or never be followed by it.
	 *
	 * @throws {Error} when the runtime cannot be loaded; the run ends with `load-failed`.
	 */
	load(ctx: LoadContext): Promise<void>;

	/**
	 * Runs the program and resolves with its exit code.
	 *
	 * An error in the student's program is the program's business: the driver
	 * prints it to stderr and resolves with a nonzero code.
	 *
	 * @throws {Error} only on a fault of the driver itself; the run ends with `crashed`.
	 */
	run(ctx: RunContext): Promise<number>;
}
