/**
 * JavaScript driver: runs the entry file in the Worker itself, no download.
 *
 * Script mode evaluates the entry file as the body of an async function, so
 * top-level `await` works. `console.log`, `info` and `debug` write to stdout;
 * `console.error` and `warn` to stderr; values are formatted like Node's
 * `util.inspect` for plain data. `prompt(message?)` writes `message`, then
 * returns `readLine()`. An uncaught error prints its stack to stderr and exits
 * with code 1.
 *
 * REPL mode reads lines with `readLine`, evaluates each in a shared global
 * scope, prints the result, and ends with code 0 at end of input.
 *
 * Only the entry file runs; other files in `files` are ignored for now.
 */

import type { Driver, RunContext } from "../driver";
import { StdinCancelled } from "../stdin/types";
import { cleanStack } from "./javascript-stack";
import { formatSyntaxError, locateJavaScriptSyntaxError } from "./syntax-error";

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
	source: string,
) => () => Promise<unknown>;

/// Nesting depth after which `inspect` prints `[Object]` or `[Array]`.
const INSPECT_DEPTH = 2;

/// Width above which `inspect` breaks an object or array into several lines.
const INSPECT_WIDTH = 72;

/// Items of an array, set or map `inspect` prints before `... n more items`.
const INSPECT_ITEMS = 100;

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

function quote(text: string): string {
	const q = !text.includes("'") ? "'" : !text.includes('"') ? '"' : "`";
	return `${q}${text.replaceAll("\\", "\\\\").replaceAll("\n", "\\n")}${q}`;
}

/// Prefix `inspect` puts before the braces of an object, such as `Map(2) `.
function labelOf(value: object): string {
	if (Array.isArray(value)) return "";
	if (value instanceof Map) return `Map(${value.size}) `;
	if (value instanceof Set) return `Set(${value.size}) `;
	const proto = Object.getPrototypeOf(value);
	if (proto === null) return "[Object: null prototype] ";
	const name = proto.constructor?.name;
	return name && name !== "Object" ? `${name} ` : "";
}

/**
 * Formats `value` the way Node's `util.inspect` does for plain data.
 *
 * Strings are quoted, objects and arrays are expanded up to `INSPECT_DEPTH`
 * and broken into lines when they do not fit `INSPECT_WIDTH`.
 */
export function inspect(
	value: unknown,
	depth = 0,
	seen: readonly unknown[] = [],
	indent = 0,
): string {
	switch (typeof value) {
		case "string":
			return quote(value);
		case "bigint":
			return `${value}n`;
		case "symbol":
			return value.toString();
		case "function":
			return value.name
				? `[Function: ${value.name}]`
				: "[Function (anonymous)]";
		case "object":
			break;
		default:
			return Object.is(value, -0) ? "-0" : String(value);
	}
	if (value === null) return "null";
	if (seen.includes(value)) return "[Circular]";
	if (value instanceof Error) return value.stack ?? String(value);
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
	}
	if (value instanceof RegExp) return String(value);

	const label = labelOf(value);
	const isList = Array.isArray(value) || value instanceof Set;
	const [open, close] = isList ? ["[", "]"] : ["{", "}"];
	if (depth > INSPECT_DEPTH) {
		return Array.isArray(value) ? "[Array]" : `[${label.trim() || "Object"}]`;
	}

	const nested = [...seen, value];
	const show = (v: unknown) => inspect(v, depth + 1, nested, indent + 2);
	let items: string[];
	if (Array.isArray(value)) {
		items = value.slice(0, INSPECT_ITEMS).map(show);
		if (value.length > INSPECT_ITEMS) {
			items.push(`... ${value.length - INSPECT_ITEMS} more items`);
		}
	} else if (value instanceof Set) {
		items = [...value].slice(0, INSPECT_ITEMS).map(show);
	} else if (value instanceof Map) {
		items = [...value]
			.slice(0, INSPECT_ITEMS)
			.map(([k, v]) => `${show(k)} => ${show(v)}`);
	} else {
		items = Object.keys(value).map((key) => {
			const name = IDENTIFIER.test(key) ? key : quote(key);
			return `${name}: ${show((value as Record<string, unknown>)[key])}`;
		});
	}
	if (items.length === 0) return `${label}${open}${close}`;
	const oneLine = `${label}${open} ${items.join(", ")} ${close}`;
	if (indent + oneLine.length <= INSPECT_WIDTH && !oneLine.includes("\n")) {
		return oneLine;
	}
	const pad = " ".repeat(indent + 2);
	const end = " ".repeat(indent);
	return `${label}${open}\n${pad}${items.join(`,\n${pad}`)}\n${end}${close}`;
}

/// Joins `console.log` arguments with spaces: strings raw, everything else inspected.
function formatArgs(args: unknown[]): string {
	return args.map((a) => (typeof a === "string" ? a : inspect(a))).join(" ");
}

/// Lines the engine adds before the body of an `AsyncFunction`.
const WRAPPER_LINES = 2;

/// Describes an uncaught throw: the stack of an `Error` in terms of the
/// user's `file`, else `Uncaught <value>`.
function describeThrown(
	error: unknown,
	file: string,
	lineOffset: number,
): string {
	if (!(error instanceof Error)) return `Uncaught ${inspect(error)}`;
	const header = String(error);
	const stack = error.stack ?? "";
	// Some engines leave the message out of the stack.
	const full = stack.includes(header) ? stack : `${header}\n${stack}`;
	return cleanStack(full, file, lineOffset);
}

/// Replaces `console`, `prompt` and `alert` of the Worker global with ones that write to `ctx`.
function installGlobals(ctx: RunContext): void {
	const out = (...args: unknown[]) => ctx.stdout(`${formatArgs(args)}\n`);
	const err = (...args: unknown[]) => ctx.stderr(`${formatArgs(args)}\n`);
	Object.assign(globalThis, {
		console: Object.assign(Object.create(globalThis.console), {
			log: out,
			info: out,
			debug: out,
			error: err,
			warn: err,
		}),
		prompt(message?: unknown) {
			if (message !== undefined) ctx.stdout(String(message));
			return ctx.readLine();
		},
		alert(message?: unknown) {
			ctx.stdout(`${message === undefined ? "" : String(message)}\n`);
		},
	});
}

/// Tracks the timers student code has pending, so a script waits for them like Node does.
function trackTimers(): { idle(): Promise<void> } {
	const live = new Set<unknown>();
	let wake: (() => void) | null = null;
	const check = () => {
		if (live.size === 0) wake?.();
	};
	const { setTimeout, setInterval, clearTimeout, clearInterval } = globalThis;
	type Callback = (...args: unknown[]) => void;
	Object.assign(globalThis, {
		setTimeout(fn: Callback, ms?: number, ...args: unknown[]) {
			const id = setTimeout(
				(...a: unknown[]) => {
					live.delete(id);
					try {
						fn(...a);
					} finally {
						check();
					}
				},
				ms,
				...args,
			);
			live.add(id);
			return id;
		},
		setInterval(fn: Callback, ms?: number, ...args: unknown[]) {
			const id = setInterval(fn, ms, ...args);
			live.add(id);
			return id;
		},
		clearTimeout(id?: number) {
			live.delete(id);
			clearTimeout(id);
			check();
		},
		clearInterval(id?: number) {
			live.delete(id);
			clearInterval(id);
			check();
		},
	});
	return {
		async idle() {
			while (live.size > 0) {
				await new Promise<void>((resolve) => {
					wake = resolve;
				});
			}
		},
	};
}

/// Resolves with the first uncaught error or unhandled rejection of the Worker.
function nextUncaught(): Promise<{ error: unknown }> {
	return new Promise((resolve) => {
		globalThis.addEventListener("error", (event) =>
			resolve({ error: event.error ?? event.message }),
		);
		globalThis.addEventListener("unhandledrejection", (event) =>
			resolve({ error: event.reason }),
		);
	});
}

async function runScript(ctx: RunContext): Promise<number> {
	const source = ctx.files[ctx.entry] ?? "";
	let main: () => Promise<unknown>;
	try {
		main = new AsyncFunction(source);
	} catch (error) {
		const at =
			error instanceof SyntaxError
				? await locateJavaScriptSyntaxError(source)
				: null;
		if (!at) {
			ctx.stderr(`${describeThrown(error, ctx.entry, WRAPPER_LINES)}\n`);
			return 1;
		}
		const message = String(error);
		ctx.stderr(`${formatSyntaxError(ctx.entry, source, at, message)}\n`);
		ctx.diagnose({ file: ctx.entry, ...at, message });
		return 1;
	}
	const timers = trackTimers();
	const finished = (async () => {
		await main.call(globalThis);
		await timers.idle();
		return null;
	})().catch((error: unknown) => ({ error }));
	const failure = await Promise.race([finished, nextUncaught()]);
	if (!failure) return 0;
	if (failure.error instanceof StdinCancelled) throw failure.error;
	ctx.stderr(`${describeThrown(failure.error, ctx.entry, WRAPPER_LINES)}\n`);
	return 1;
}

async function runRepl(ctx: RunContext): Promise<number> {
	for (let line = ctx.readLine(); line !== null; line = ctx.readLine()) {
		if (!line.trim()) continue;
		try {
			// biome-ignore lint/security/noGlobalEval: the REPL evaluates student code, in a Worker with no privileges
			let value: unknown = globalThis.eval(line);
			if (value instanceof Promise) value = await value;
			if (value !== undefined) ctx.stdout(`${inspect(value)}\n`);
		} catch (error) {
			if (error instanceof StdinCancelled) throw error;
			ctx.stderr(`${describeThrown(error, "<repl>", 0)}\n`);
		}
	}
	return 0;
}

export const javascriptDriver: Driver = {
	language: "javascript",
	modes: ["script", "repl"],
	async load() {},
	async run(ctx) {
		installGlobals(ctx);
		return ctx.mode === "repl" ? runRepl(ctx) : runScript(ctx);
	},
};
