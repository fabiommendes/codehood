/**
 * One Elm run: compile the student's files, run their tests, then open the
 * REPL when the mode asks for it.
 *
 * Kept apart from the driver so it runs in Node too, for the build and the
 * unit tests.
 */

import type { RunContext } from "@codehood/runner-api/driver";
import { MemFs, MOUNTED_MTIME } from "./fs";
import { type GuidaElm, type GuidaIo, runGuida } from "./host";
import {
	elmJson,
	HOME_DIR,
	PROJECT_DIR,
	SOURCE_DIR,
	TEST_MAIN_MODULE,
	testMainSource,
} from "./project";
import { type CompileReport, renderReport } from "./report";

/// Where `make` writes the compiled test suite.
const TESTS_JS = "/out/tests.js";

/// Version of the compiler the banner names.
export const GUIDA_VERSION = "1.0.0-beta.2";

/// What the REPL prints instead of Guida's banner.
const BANNER = `Elm 0.19.1 (Guida ${GUIDA_VERSION}). :help for help, :exit to exit.\n`;

/// Name of the module a file declares; `Main` when it has no header, which
/// the compiler then reports.
function moduleName(source: string): string {
	const match = /^(?:port\s+|effect\s+)?module\s+([A-Z][\w.]*)/m.exec(source);
	return match?.[1] ?? "Main";
}

/// Whether a file declares `tests` (its type annotation starts a line).
function declaresTests(source: string): boolean {
	return /^tests\s*:/m.test(source);
}

/// Thrown by the `process.exit` the REPL's JavaScript calls.
class ProcessExit {
	constructor(readonly code: number) {}
}

/// Runs JavaScript the compiler wrote for `node`, with `console` and a
/// `process` that write to the run's terminal.
function runNodeScript(code: string, ctx: RunContext): number {
	const write = (out: (text: string) => void) => (text: unknown) => {
		out(String(text));
		return true;
	};
	const line =
		(out: (text: string) => void) =>
		(...args: unknown[]) =>
			out(`${args.map(String).join(" ")}\n`);
	const console = {
		log: line(ctx.stdout),
		info: line(ctx.stdout),
		warn: line(ctx.stderr),
		error: line(ctx.stderr),
	};
	const process = {
		stdout: { write: write(ctx.stdout) },
		stderr: { write: write(ctx.stderr) },
		on() {},
		exit(status?: number) {
			throw new ProcessExit(status ?? 0);
		},
	};
	try {
		new Function("process", "console", code)(process, console);
		return 0;
	} catch (error) {
		if (error instanceof ProcessExit) return error.code;
		ctx.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
		return 1;
	}
}

/// The `scope.Elm` a compiled program defines, reduced to what runs a suite.
interface CompiledSuite {
	[module: string]: {
		init(): {
			ports: {
				report: {
					subscribe(fn: (r: { output: string; code: number }) => void): void;
				};
				start: { send(seed: number): void };
			};
		};
	};
}

/// Runs the compiled suite and resolves with its exit code.
function runSuite(code: string, ctx: RunContext): Promise<number> {
	const scope: { Elm?: CompiledSuite } = {};
	// `Debug.log` writes with `log`; `warn` only says the build is not optimized.
	const console = {
		log: (...a: unknown[]) => ctx.stdout(`${a.join(" ")}\n`),
		warn() {},
	};
	// `make` wraps the program as `(function(scope){...}(this))`.
	new Function("console", code).call(scope, console);
	const app = scope.Elm?.[TEST_MAIN_MODULE]?.init();
	if (!app) throw new Error("The compiled test suite defines no program.");
	return new Promise((resolve) => {
		app.ports.report.subscribe(({ output, code }) => {
			ctx.stdout(output);
			resolve(code);
		});
		app.ports.start.send(Math.floor(Math.random() * 2 ** 31));
	});
}

/**
 * Runs the program of `ctx` with the compiler `elm`, on a file system holding
 * `cache` (the files the build packed).
 *
 * Resolves with the exit code: 1 when it does not compile, 2 when a test
 * fails, 0 otherwise (and after the REPL, in `repl` mode).
 */
export async function runElm(
	elm: GuidaElm,
	cache: ReadonlyMap<string, Uint8Array>,
	ctx: RunContext,
): Promise<number> {
	const fs = new MemFs();
	for (const [path, data] of cache) fs.write(path, data, MOUNTED_MTIME);
	fs.write(`${PROJECT_DIR}/elm.json`, elmJson(), MOUNTED_MTIME);
	for (const [path, source] of Object.entries(ctx.files)) {
		if (path === "elm.json") continue;
		fs.write(`${PROJECT_DIR}/${SOURCE_DIR}/${path}`, source);
	}
	fs.cwd = PROJECT_DIR;
	const entrySource = ctx.files[ctx.entry] ?? "";
	const module = moduleName(entrySource);
	const withTests = declaresTests(entrySource);
	const fileOf = (path: string) => {
		const full = fs.resolve(path);
		const prefix = `${PROJECT_DIR}/${SOURCE_DIR}/`;
		const rel = full.startsWith(prefix) ? full.slice(prefix.length) : null;
		return rel !== null && Object.hasOwn(ctx.files, rel) ? rel : null;
	};
	const io = (args: string[], extra: Partial<GuidaIo> = {}): GuidaIo => ({
		fs,
		args,
		env: { HOME: HOME_DIR },
		stdout: ctx.stdout,
		stderr: ctx.stderr,
		fetch: (_method, url) =>
			/\/all-packages\/since\//.test(url) ? { status: 200, body: "[]" } : null,
		...extra,
	});

	if (withTests) {
		fs.write(
			`${PROJECT_DIR}/${SOURCE_DIR}/${TEST_MAIN_MODULE}.elm`,
			testMainSource(module),
		);
	}
	let errors = "";
	const compiled = await runGuida(
		elm,
		io(
			[
				"make",
				withTests
					? `${SOURCE_DIR}/${TEST_MAIN_MODULE}.elm`
					: `${SOURCE_DIR}/${ctx.entry}`,
				`--output=${withTests ? TESTS_JS : "/dev/null"}`,
				"--report=json",
			],
			{
				stdout: () => {},
				stderr: (text) => {
					errors += text;
				},
			},
		),
	);
	fs.remove(`${PROJECT_DIR}/${SOURCE_DIR}/${TEST_MAIN_MODULE}.elm`);
	if (compiled !== 0) {
		let report: CompileReport | null = null;
		try {
			report = JSON.parse(errors) as CompileReport;
		} catch {
			ctx.stderr(errors);
		}
		if (report) {
			const { text, diagnostics } = renderReport(report, fileOf);
			ctx.stderr(text);
			for (const diagnostic of diagnostics) ctx.diagnose(diagnostic);
		}
		return 1;
	}

	let status = 0;
	if (withTests) {
		const code = fs.read(TESTS_JS);
		if (!code) throw new Error("The compiler wrote no test suite.");
		status = await runSuite(new TextDecoder().decode(code), ctx);
	} else if (ctx.mode === "script") {
		ctx.stdout(`Compiled ${ctx.entry}, no tests to run.\n`);
	}
	if (ctx.mode !== "repl") return status;

	// The first line the REPL reads is the import of the student's module,
	// typed by the driver; Guida's banner, printed before it, is dropped.
	let started = false;
	await runGuida(
		elm,
		io(["repl"], {
			stdout: (text) => {
				if (started) ctx.stdout(text);
			},
			readLine(prompt) {
				if (!started) {
					started = true;
					ctx.stdout(BANNER);
					return `import ${module} exposing (..)`;
				}
				ctx.stdout(prompt);
				return ctx.readLine();
			},
			runJs: (code) => runNodeScript(code, ctx),
		}),
	);
	return 0;
}
