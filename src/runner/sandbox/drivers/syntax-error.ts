/**
 * Points a syntax error at its place in the source, the way Node prints one.
 */

/// Position of a syntax error: 1-based line, 0-based column.
export interface SourcePosition {
	line: number;
	column: number;
}

/**
 * Formats a syntax error as `file:line:column`, the source line, a caret under the column and the message.
 *
 * @example
 * formatSyntaxError("main.js", "let a: number;", { line: 1, column: 5 }, "SyntaxError: Unexpected token ':'");
 * // "main.js:1:6\nlet a: number;\n     ^\n\nSyntaxError: Unexpected token ':'"
 */
export function formatSyntaxError(
	file: string,
	source: string,
	at: SourcePosition,
	message: string,
): string {
	const text = source.split("\n")[at.line - 1] ?? "";
	// Keep the tabs of the line so the caret lands under the same column.
	const pad = text.slice(0, at.column).replace(/[^\t]/g, " ");
	return `${file}:${at.line}:${at.column + 1}\n${text}\n${pad}^\n\n${message}`;
}

/**
 * Finds where JavaScript `source` stops parsing as the body of an async function, or `null` when it parses.
 *
 * The engine's own `SyntaxError` from the `AsyncFunction` constructor carries
 * no position in Chromium, so acorn parses the source again to find it. Acorn
 * is loaded only when a program fails to compile.
 */
export async function locateJavaScriptSyntaxError(
	source: string,
): Promise<SourcePosition | null> {
	const { parse } = await import("acorn");
	try {
		parse(source, {
			ecmaVersion: "latest",
			sourceType: "script",
			allowReturnOutsideFunction: true,
			allowAwaitOutsideFunction: true,
		});
		return null;
	} catch (error) {
		const loc = (error as { loc?: SourcePosition }).loc;
		return loc ? { line: loc.line, column: loc.column } : null;
	}
}
