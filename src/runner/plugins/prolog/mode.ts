/**
 * A CodeMirror stream parser for Prolog: comments, quoted atoms and strings,
 * variables, numbers, functors and the control constructs.
 *
 * `@codemirror/legacy-modes` ships no Prolog mode, and this one only colours
 * tokens; it does not parse clauses.
 */
import type { StreamParser, StringStream } from "@codemirror/language";

/// Parser state: whether the stream is inside a `/* ... */` comment.
interface PrologState {
	inComment: boolean;
}

/// Atoms and operators that read as control flow or directives.
const KEYWORDS = new Set([
	"is",
	"mod",
	"rem",
	"div",
	"xor",
	"rdiv",
	"dynamic",
	"discontiguous",
	"initialization",
	"module",
	"use_module",
	"true",
	"fail",
	"false",
	"halt",
]);

/// Characters that form symbolic operators such as `:-`, `\=` or `=..`.
const SYMBOL_CHAR = /[+\-*/\\^<>=~:.?@#&$]/;

/// Consumes a quoted token up to the closing `quote`, honouring backslash escapes and doubled quotes.
function skipQuoted(stream: StringStream, quote: string): void {
	while (!stream.eol()) {
		const ch = stream.next();
		if (ch === "\\") stream.next();
		else if (ch === quote) {
			if (stream.peek() === quote) stream.next();
			else return;
		}
	}
}

/// Consumes the rest of a block comment and reports whether it closed on this line.
function skipBlockComment(stream: StringStream): boolean {
	while (!stream.eol()) {
		if (stream.match("*/")) return true;
		stream.next();
	}
	return false;
}

/** Stream parser that colours Prolog source for `StreamLanguage.define`. */
export const prolog: StreamParser<PrologState> = {
	name: "prolog",
	startState: () => ({ inComment: false }),
	token(stream, state) {
		if (state.inComment) {
			state.inComment = !skipBlockComment(stream);
			return "comment";
		}
		if (stream.eatSpace()) return null;
		if (stream.match("%")) {
			stream.skipToEnd();
			return "comment";
		}
		if (stream.match("/*")) {
			state.inComment = !skipBlockComment(stream);
			return "comment";
		}
		const ch = stream.next();
		if (ch == null) return null;
		if (ch === '"' || ch === "'" || ch === "`") {
			skipQuoted(stream, ch);
			return "string";
		}
		if (ch === "0" && stream.match(/^'(\\.|.)/)) return "number";
		if (/\d/.test(ch)) {
			stream.match(/^[\d_]*(\.\d+)?([eE][+-]?\d+)?/);
			return "number";
		}
		if (/[A-Z_]/.test(ch)) {
			stream.match(/^\w*/);
			return "variableName";
		}
		if (/[a-z]/.test(ch)) {
			stream.match(/^\w*/);
			if (KEYWORDS.has(stream.current())) return "keyword";
			return stream.peek() === "(" ? "variableName.function" : null;
		}
		if (ch === "!") return "keyword";
		if (SYMBOL_CHAR.test(ch)) {
			stream.match(/^[+\-*/\\^<>=~:.?@#&$]*/);
			return "operator";
		}
		return "punctuation";
	},
	languageData: {
		commentTokens: { line: "%", block: { open: "/*", close: "*/" } },
	},
};
