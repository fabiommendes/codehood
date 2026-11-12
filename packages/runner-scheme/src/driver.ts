/**
 * Scheme driver: BiwaScheme, an R7RS interpreter in JavaScript.
 *
 * `run` reads the entry file one top-level form at a time and evaluates each
 * in turn. BiwaScheme does not track source positions, so an error reports
 * the line where its top-level form starts: `main.scm:3: message`. The run
 * stops at the first error and exits with code 1; `(exit n)` exits with `n`.
 * In `repl` mode, after the file, each complete form typed is evaluated and
 * its value written, unless it has none.
 *
 * `display`, `write` and `newline` go to the run's output; `read-line` reads
 * through `readLine`. Only the entry file is read.
 */

import {
	type Driver,
	type LoadContext,
	type RunContext,
	runtimePath,
	StdinCancelled,
} from "@codehood/runner-api/driver";
import { biwascheme as runtime } from "./runtime";

/// The parts of the BiwaScheme API this driver uses.
interface Biwa {
	Parser: {
		new (
			text: string,
		): {
			/// Offset just past the last datum read.
			i: number;
			getObject(): unknown;
		};
		EOS: unknown;
	};
	Interpreter: new (
		onError: (error: unknown) => void,
	) => { evaluate(source: string): unknown };
	Port: {
		CustomOutput: new (write: (text: string) => void) => unknown;
		current_output: unknown;
		current_error: unknown;
	};
	define_libfunc(
		name: string,
		min: number,
		max: number,
		fn: (args: unknown[]) => unknown,
	): void;
	to_write(value: unknown): string;
	undef: unknown;
	eof: unknown;
}

/// Thrown by `(exit n)` to end the program with code `n`.
class ExitRequest {
	constructor(readonly code: number) {}
}

/// What the `load` and `run` of one Worker share.
interface Loaded {
	biwa: Biwa;
	/// The `RunContext` of the current run, read by the I/O functions.
	ctx: RunContext | null;
}

let loaded: Loaded | null = null;

/// A top-level form of the source: its text and where it starts.
interface Form {
	text: string;
	line: number;
	column: number;
}

/// Thrown by `readForms` for text the reader rejects, with where the form
/// that fails starts.
class SyntaxProblem {
	constructor(
		readonly message: string,
		readonly line: number,
		readonly column: number,
		/// Whether more text could complete the form (an open list or string).
		readonly incomplete: boolean,
	) {}
}

/// Offset of the first character at or after `from` that is not blank or in
/// a `;` comment.
function skipBlank(source: string, from: number): number {
	let i = from;
	while (i < source.length) {
		const c = source[i];
		if (c === ";") {
			while (i < source.length && source[i] !== "\n") i++;
		} else if (c === " " || c === "\t" || c === "\n" || c === "\r") {
			i++;
		} else {
			break;
		}
	}
	return i;
}

/// 1-based line and 0-based column of `offset` in `source`.
function position(source: string, offset: number) {
	const before = source.slice(0, offset);
	const lastBreak = before.lastIndexOf("\n");
	return {
		line: before.split("\n").length,
		column: offset - lastBreak - 1,
	};
}

/// Splits `source` into its top-level forms, in order.
function readForms(biwa: Biwa, source: string): Form[] {
	const parser = new biwa.Parser(source);
	const forms: Form[] = [];
	let end = 0;
	while (true) {
		const start = skipBlank(source, end);
		let datum: unknown;
		try {
			datum = parser.getObject();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const { line, column } = position(source, start);
			throw new SyntaxProblem(
				message,
				line,
				column,
				// BiwaScheme's reader throws `Unterminated` for an open list or
				// string, and other classes for text no addition can fix.
				error instanceof Error && error.constructor.name === "Unterminated",
			);
		}
		if (datum === biwa.Parser.EOS) return forms;
		end = parser.i;
		forms.push({ text: source.slice(start, end), ...position(source, start) });
	}
}

/// The message of an error raised while evaluating.
function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/// Evaluates `form`; resolves with its value, or with the error it raised.
///
/// @throws {StdinCancelled} when the run was stopped while `read-line` waited.
function evaluate(
	biwa: Biwa,
	form: Form,
): { value: unknown } | { error: unknown } {
	let failure: { error: unknown } | null = null;
	const interpreter = new biwa.Interpreter((error) => {
		failure = { error };
	});
	let result: { value: unknown } | { error: unknown };
	try {
		const value = interpreter.evaluate(form.text);
		result = failure ?? { value };
	} catch (error) {
		result = { error };
	}
	if ("error" in result && result.error instanceof StdinCancelled) {
		throw result.error;
	}
	return result;
}

/// Evaluates every form of `source`; the exit code, or null when all ran.
function runForms(ctx: RunContext, biwa: Biwa, source: string): number | null {
	let forms: Form[];
	try {
		forms = readForms(biwa, source);
	} catch (error) {
		if (!(error instanceof SyntaxProblem)) throw error;
		report(ctx, error, `syntax error: ${error.message}`);
		return 1;
	}
	for (const form of forms) {
		const result = evaluate(biwa, form);
		if ("error" in result) {
			if (result.error instanceof ExitRequest) return result.error.code;
			report(ctx, form, messageOf(result.error));
			return 1;
		}
	}
	return null;
}

/// Writes an error at `where` of the entry file and marks it in the editor.
function report(
	ctx: RunContext,
	where: { line: number; column: number },
	message: string,
): void {
	ctx.stderr(`${ctx.entry}:${where.line}: ${message}\n`);
	ctx.diagnose({
		file: ctx.entry,
		line: where.line,
		column: where.column,
		message,
	});
}

/// Whether `text` is a definition, whose value the REPL does not echo.
function isDefinition(text: string): boolean {
	return /^\(\s*define[\s-]/.test(text);
}

/// Reads forms typed on stdin until its end, writing each one's value.
function repl(ctx: RunContext, biwa: Biwa): number {
	let pending = "";
	while (true) {
		const line = ctx.readLine();
		if (line === null) return 0;
		const source = `${pending}${line}\n`;
		let forms: Form[];
		try {
			forms = readForms(biwa, source);
		} catch (error) {
			if (!(error instanceof SyntaxProblem)) throw error;
			if (error.incomplete) {
				pending = source;
				continue;
			}
			ctx.stderr(`syntax error: ${error.message}\n`);
			pending = "";
			continue;
		}
		pending = "";
		for (const form of forms) {
			const result = evaluate(biwa, form);
			if ("error" in result) {
				if (result.error instanceof ExitRequest) return result.error.code;
				ctx.stderr(`${messageOf(result.error)}\n`);
				break;
			}
			if (result.value !== biwa.undef && !isDefinition(form.text)) {
				ctx.stdout(`${biwa.to_write(result.value)}\n`);
			}
		}
	}
}

export const schemeDriver: Driver = {
	language: "scheme",
	modes: ["script", "repl"],

	async load(ctx: LoadContext) {
		const { default: biwa } = (await import(
			/* @vite-ignore */ ctx.runtimeUrl(runtimePath(runtime, "biwascheme.mjs"))
		)) as { default: Biwa };
		const state: Loaded = { biwa, ctx: null };
		biwa.Port.current_output = new biwa.Port.CustomOutput((text) =>
			state.ctx?.stdout(text),
		);
		biwa.Port.current_error = new biwa.Port.CustomOutput((text) =>
			state.ctx?.stderr(text),
		);
		biwa.define_libfunc("read-line", 0, 1, () => {
			const line = state.ctx?.readLine() ?? null;
			return line === null ? biwa.eof : line;
		});
		biwa.define_libfunc("exit", 0, 1, ([code]) => {
			throw new ExitRequest(
				code === undefined || code === true
					? 0
					: typeof code === "number"
						? code
						: 1,
			);
		});
		loaded = state;
	},

	async run(ctx: RunContext) {
		if (!loaded) throw new Error("The Scheme runtime was not loaded.");
		loaded.ctx = ctx;
		const code = runForms(ctx, loaded.biwa, ctx.files[ctx.entry] ?? "");
		if (code !== null) return code;
		return ctx.mode === "repl" ? repl(ctx, loaded.biwa) : 0;
	},
};

export default schemeDriver;
