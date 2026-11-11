/**
 * The contract every language driver implements.
 *
 * A driver lives inside a run's Worker and runs exactly one program. It never
 * talks to the frame directly: it writes through `RunContext` and reads stdin
 * through `readLine`. Stopping is not its concern: the frame terminates the
 * Worker.
 *
 * This module is bundled into the sandbox, so it imports nothing.
 */

/** Id of a language, as its plugin declares it, e.g. `python`. */
export type LanguageId = string;

/** How a driver runs the files: once from the entry file, or as a read-eval-print loop. */
export type RunMode = "script" | "repl";

/**
 * A problem the driver found at a place in the source, e.g. a syntax error.
 *
 * `line` is 1-based and `column` 0-based, both in `file`.
 */
export interface Diagnostic {
	file: string;
	line: number;
	column: number;
	message: string;
}

/** A runtime package copied into the runner bundle. */
export interface RuntimePackage {
	/// npm package name and exact version, as in package.json.
	pkg: string;
	version: string;
	/// Files copied from the package, relative to its root, and the path
	/// each gets under `/runner/rt/<pkg>@<version>/`.
	files: Record<string, string>;
	/// Text put before and after a file (keyed by its destination path) at
	/// build, for glue that is a classic script or UMD and has to become an
	/// ES module the Worker can import.
	wrap?: Record<string, { prefix?: string; suffix?: string }>;
	/// Destination files the build bundles into one ES module from the source
	/// file in `files`, keeping only the listed exports: for packages whose
	/// entry drags in code the Worker has no use for.
	bundle?: Record<string, string[]>;
}

/** Directory of a runtime under `/runner/rt/`, e.g. `pyodide@314.0.7`. */
export function runtimeDir(runtime: RuntimePackage): string {
	return `${runtime.pkg}@${runtime.version}`;
}

/** Path of a runtime file under `/runner/rt/`, e.g. `pyodide@314.0.7/pyodide.mjs`. */
export function runtimePath(runtime: RuntimePackage, file: string): string {
	return `${runtimeDir(runtime)}/${file}`;
}

/** Thrown by `RunContext.readLine` when the run was stopped while it waited. */
export class StdinCancelled extends Error {
	constructor() {
		super("stdin cancelled");
		this.name = "StdinCancelled";
	}
}

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
	 * Reports a problem at a place in the source, which the editor marks.
	 *
	 * The message still has to be written to stderr: a diagnostic only adds
	 * the mark. Reports past the protocol's limit are dropped.
	 */
	diagnose(diagnostic: Diagnostic): void;

	/**
	 * Blocks until the user enters a line.
	 *
	 * The Worker reports `waiting-input` while blocked and `running` after.
	 *
	 * @returns the line without its newline, or `null` at end of input.
	 * @throws {StdinCancelled} when the run was stopped while waiting; let it
	 * propagate.
	 */
	readLine(): string | null;
}

/**
 * One language's runtime, the default export of a plugin's `driver` module.
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
	 * Runs in a Worker already locked down, before any program is known; it
	 * may run long before `run`, or never be followed by it.
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
