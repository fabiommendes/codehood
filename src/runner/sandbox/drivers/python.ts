/**
 * Python driver: CPython compiled to WebAssembly (Pyodide), core only.
 *
 * `run` writes the files to `/work/` in the in-memory file system of the
 * runtime and runs the entry file as `__main__` under the name `main.py`, so
 * a traceback points at the student's lines. An unhandled exception prints the
 * traceback and exits with code 1; `SystemExit(n)` exits with `n`. In `repl`
 * mode the program is followed by `code.interact()`, as in `python -i`.
 * `input()` reads through `readLine`.
 *
 * No package is ever loaded (an `import` outside the standard library raises
 * `ModuleNotFoundError`) and no persistent file system is mounted.
 */

import {
	type Driver,
	type LoadContext,
	type RunContext,
	runtimePath,
} from "@codehood/runner-api/driver";
import { RUNTIMES } from "../runtimes";

/// Directory of the program's files in the runtime's file system.
const WORK_DIR = "/work";

/// The parts of the Pyodide API this driver uses.
interface PyodideApi {
	FS: {
		mkdirTree(path: string): void;
		writeFile(path: string, data: string): void;
		chdir(path: string): void;
	};
	setStdin(options: { stdin: () => string | null }): void;
	setStdout(options: { write(buffer: Uint8Array): number }): void;
	setStderr(options: { write(buffer: Uint8Array): number }): void;
	runPython(code: string, options?: { globals?: unknown }): unknown;
	globals: {
		get(name: string): unknown;
		set(name: string, value: unknown): void;
	};
}

type PyodideLoader = (options: Record<string, unknown>) => Promise<PyodideApi>;

/// What the `load` and `run` of one Worker share.
interface Loaded {
	pyodide: PyodideApi;
	/// The `RunContext` of the current run, read by the stdin and output callbacks.
	ctx: RunContext | null;
}

let loaded: Loaded | null = null;

/// Python side of `run`: executes the entry as `__main__` and returns the exit code.
const BOOTSTRAP = `
import sys, traceback, code, __main__
sys.path.insert(0, "/work")

def _codehood_run(entry, source, interactive):
    status = 0
    try:
        try:
            compiled = compile(source, entry, "exec")
        except SyntaxError as error:
            traceback.print_exception(type(error), error, None)
            status = 1
        else:
            try:
                exec(compiled, __main__.__dict__)
            except SystemExit as error:
                status = _codehood_exit_code(error)
                if not interactive:
                    return status
            except BaseException as error:
                # Drop this function's own frame from the traceback.
                traceback.print_exception(type(error), error, error.__traceback__.tb_next)
                status = 1
        if interactive:
            code.interact(banner="", local=__main__.__dict__, exitmsg="")
            status = 0
    except SystemExit as error:
        status = _codehood_exit_code(error)
    sys.stdout.flush()
    return status

def _codehood_exit_code(error):
    value = error.code
    if value is None:
        return 0
    if isinstance(value, int):
        return value
    print(value, file=sys.stderr)
    return 1
`;

/// Writes each chunk Python emits to `emit`, decoding UTF-8 across chunk boundaries.
function writer(emit: (text: string) => void) {
	const decoder = new TextDecoder();
	return {
		write(buffer: Uint8Array): number {
			emit(decoder.decode(buffer, { stream: true }));
			return buffer.length;
		},
	};
}

export const pythonDriver: Driver = {
	language: "python",
	modes: ["script", "repl"],

	async load(ctx: LoadContext) {
		const url = (file: string) =>
			ctx.runtimeUrl(runtimePath(RUNTIMES.pyodide, file));
		const { loadPyodide } = (await import(
			/* @vite-ignore */ url("pyodide.mjs")
		)) as { loadPyodide: PyodideLoader };
		const state: Loaded = { pyodide: null as never, ctx: null };
		const pyodide = await loadPyodide({
			indexURL: url(""),
			fullStdLib: false,
			stdin: () => null,
			stdout: () => {},
			stderr: () => {},
		});
		pyodide.setStdin({
			stdin: () => state.ctx?.readLine() ?? null,
		});
		pyodide.setStdout(writer((text) => state.ctx?.stdout(text)));
		pyodide.setStderr(writer((text) => state.ctx?.stderr(text)));
		pyodide.runPython(BOOTSTRAP);
		state.pyodide = pyodide;
		loaded = state;
	},

	async run(ctx: RunContext) {
		if (!loaded) throw new Error("The Python runtime was not loaded.");
		const { pyodide } = loaded;
		loaded.ctx = ctx;
		pyodide.FS.mkdirTree(WORK_DIR);
		for (const [path, text] of Object.entries(ctx.files)) {
			const target = `${WORK_DIR}/${path}`;
			pyodide.FS.mkdirTree(target.slice(0, target.lastIndexOf("/")));
			pyodide.FS.writeFile(target, text);
		}
		pyodide.FS.chdir(WORK_DIR);
		const run = pyodide.globals.get("_codehood_run") as (
			...args: unknown[]
		) => unknown;
		const status = run(
			ctx.entry,
			ctx.files[ctx.entry] ?? "",
			ctx.mode === "repl",
		);
		return typeof status === "number" ? status : 0;
	},
};

export default pythonDriver;
