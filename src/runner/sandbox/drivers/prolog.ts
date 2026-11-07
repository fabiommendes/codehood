/**
 * Prolog driver: SWI-Prolog compiled to WebAssembly (`swipl-wasm`).
 *
 * `run` writes the files to `/work/` in the in-memory file system of the
 * runtime, consults the entry file and opens the toplevel on the terminal, as
 * `swipl main.pl` would. Syntax errors and warnings of the consult are
 * reported as `main.pl:3:9: ...`. `halt.` and end of input end the run; the
 * exit code is the one of `halt(N)`.
 *
 * The runtime is loaded once per Worker and nothing persists between runs:
 * no persistent file system is ever mounted.
 */

import type { Driver, LoadContext, RunContext } from "../driver";
import { RUNTIMES, runtimePath } from "../runtimes";

/// Directory of the program's files in the runtime's file system.
const WORK_DIR = "/work";

/// The parts of the Emscripten module this driver uses.
interface SwiplModule {
	FS: {
		mkdirTree(path: string): void;
		writeFile(path: string, data: string): void;
		chdir(path: string): void;
		streams: ({
			stream_ops: {
				read(
					stream: unknown,
					buffer: Uint8Array,
					offset: number,
					length: number,
				): number;
			};
		} | null)[];
	};
	prolog: {
		query(goal: string, input?: Record<string, unknown>): { once(): unknown };
	};
}

type SwiplFactory = (options: Record<string, unknown>) => Promise<SwiplModule>;

/// What the `load` and `run` of one Worker share.
interface Loaded {
	swipl: SwiplModule;
	/// The `RunContext` of the current run, read by the stdin callback.
	ctx: RunContext | null;
}

let loaded: Loaded | null = null;

/// Rewrites `/work/main.pl:3:` to `main.pl:3:` and drops the thread tag.
function relativize(text: string): string {
	return text.replaceAll(`${WORK_DIR}/`, "").replaceAll("[Thread main] ", "");
}

/// Reads the exit status of the exception `halt/0,1` raises, or null for any other error.
function exitStatus(error: unknown): number | null {
	const status = (error as { status?: unknown } | null)?.status;
	return typeof status === "number" &&
		(error as { name?: unknown }).name === "ExitStatus"
		? status
		: null;
}

/// Replaces the read of file descriptor 0 by one that serves a line at a
/// time and blocks only when no byte is left. The default device keeps
/// reading until its callback returns, so a `halt.` would wait for the next line.
function installLineStdin(swipl: SwiplModule, readLine: () => string | null) {
	const encoder = new TextEncoder();
	let pending = new Uint8Array(0);
	const stdin = swipl.FS.streams[0];
	if (!stdin) throw new Error("The Prolog runtime has no standard input.");
	stdin.stream_ops.read = (_stream, buffer, offset, length) => {
		if (pending.length === 0) {
			const line = readLine();
			if (line === null) return 0;
			pending = encoder.encode(`${line}\n`);
		}
		const count = Math.min(length, pending.length);
		buffer.set(pending.subarray(0, count), offset);
		pending = pending.subarray(count);
		return count;
	};
}

export const prologDriver: Driver = {
	language: "prolog",
	modes: ["repl"],

	async load(ctx: LoadContext) {
		const url = (file: string) =>
			ctx.runtimeUrl(runtimePath(RUNTIMES.swipl, file));
		const { default: SWIPL } = (await import(
			/* @vite-ignore */ url("swipl-web.js")
		)) as { default: SwiplFactory };
		const state: Loaded = { swipl: null as never, ctx: null };
		const readLine = () => {
			const run = state.ctx;
			return run ? run.readLine() : null;
		};
		const out = (text: string) => state.ctx?.stdout(text);
		const err = (text: string) => state.ctx?.stderr(relativize(text));
		state.swipl = await SWIPL({
			arguments: ["-q"],
			noInitialRun: true,
			locateFile: (file: string) => url(file),
			stdin: () => null,
			print: out,
			printErr: err,
			on_output: (text: string, stream: string) =>
				(stream === "stderr" ? err : out)(text),
		});
		installLineStdin(state.swipl, readLine);
		loaded = state;
	},

	async run(ctx: RunContext) {
		if (!loaded) throw new Error("The Prolog runtime was not loaded.");
		const { swipl } = loaded;
		loaded.ctx = ctx;
		swipl.FS.mkdirTree(WORK_DIR);
		for (const [path, text] of Object.entries(ctx.files)) {
			const target = `${WORK_DIR}/${path}`;
			swipl.FS.mkdirTree(target.slice(0, target.lastIndexOf("/")));
			swipl.FS.writeFile(target, text);
		}
		swipl.FS.chdir(WORK_DIR);
		try {
			swipl.prolog
				.query("consult(File)", { File: `${WORK_DIR}/${ctx.entry}` })
				.once();
			// A terminal is what makes the toplevel print its prompt.
			swipl.prolog.query("set_stream(user_input, tty(true))").once();
			swipl.prolog.query("prolog").once();
			return 0;
		} catch (error) {
			const status = exitStatus(error);
			if (status !== null) return status;
			throw error;
		}
	},
};
