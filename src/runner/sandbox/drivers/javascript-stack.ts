/**
 * Rewrites an `Error` stack of the JavaScript driver to talk about the user's
 * file only.
 *
 * Frames of the runner itself are dropped. Frames of code compiled with the
 * `AsyncFunction` constructor become `file:line:column`, with `lineOffset`
 * lines removed: the engine puts the function header before the body.
 * Lines before the first frame (the message) are kept as they are.
 *
 * @example
 * cleanStack("Error: x\n    at f (eval at run (w.js:1:1), <anonymous>:4:2)", "main.js", 2);
 * // "Error: x\n    at f (main.js:2:2)"
 */
export function cleanStack(
	stack: string,
	file: string,
	lineOffset: number,
): string {
	const kept: string[] = [];
	let inFrames = false;
	for (const line of stack.split("\n")) {
		const frame = rewriteFrame(line, file, lineOffset);
		if (frame === undefined) {
			if (!inFrames) kept.push(line);
			continue;
		}
		inFrames = true;
		if (frame !== null) kept.push(frame);
	}
	return kept.join("\n");
}

/// V8: `    at name (eval at origin (url:1:2), <anonymous>:5:9)`.
const V8_EVAL_FRAME =
	/^(\s+at (?:async )?)(?:(.*?) \()?eval at .*, <anonymous>:(\d+):(\d+)\)?$/;

/// SpiderMonkey: `name@url line 1 > AsyncFunction:5:9`.
const GECKO_EVAL_FRAME = /^(.*)@.* > (?:Async)?Function:(\d+):(\d+)$/;

/// Anything that looks like a stack frame, whichever engine wrote it.
const ANY_FRAME = /^\s+at |@\S*:\d+(?::\d+)?$/;

/// Returns the user-facing form of a frame line, `null` for a frame to drop,
/// `undefined` when the line is not a frame.
function rewriteFrame(
	line: string,
	file: string,
	lineOffset: number,
): string | null | undefined {
	const v8 = V8_EVAL_FRAME.exec(line);
	if (v8) {
		const [, prefix = "", name, row = "0", column = "0"] = v8;
		const at = location(file, row, column, lineOffset);
		if (at === null) return null;
		return name ? `${prefix}${name} (${at})` : `${prefix}${at}`;
	}
	const gecko = GECKO_EVAL_FRAME.exec(line);
	if (gecko) {
		const [, name = "", row = "0", column = "0"] = gecko;
		const at = location(file, row, column, lineOffset);
		return at === null ? null : `${name}@${at}`;
	}
	return ANY_FRAME.test(line) ? null : undefined;
}

/// `file:line:column`, or `null` when the line falls inside the function header.
function location(
	file: string,
	row: string,
	column: string,
	lineOffset: number,
): string | null {
	const line = Number(row) - lineOffset;
	return line < 1 ? null : `${file}:${line}:${column}`;
}
