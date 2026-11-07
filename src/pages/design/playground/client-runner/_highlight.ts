/**
 * Mock syntax colouring for the prototype editor, in the VS Code Dark+ palette.
 *
 * Good enough to look like CodeMirror with the VS Code theme; not a real
 * tokenizer. The real IDE uses CodeMirror's language packages.
 */

export type Language =
	| "python"
	| "prolog"
	| "javascript"
	| "lua"
	| "typescript";

const KEYWORDS: Record<Language, string[]> = {
	python: [
		"def",
		"return",
		"if",
		"elif",
		"else",
		"for",
		"while",
		"in",
		"import",
		"from",
		"print",
		"input",
		"int",
		"float",
		"str",
		"len",
		"range",
		"True",
		"False",
		"None",
		"and",
		"or",
		"not",
		"class",
		"raise",
		"try",
		"except",
	],
	prolog: [
		"is",
		"not",
		"member",
		"append",
		"length",
		"findall",
		"write",
		"nl",
		"read",
		"format",
	],
	javascript: [
		"const",
		"let",
		"var",
		"function",
		"return",
		"if",
		"else",
		"for",
		"while",
		"of",
		"in",
		"console",
		"new",
		"class",
		"true",
		"false",
		"null",
		"undefined",
		"async",
		"await",
		"import",
		"export",
	],
	typescript: [
		"const",
		"let",
		"function",
		"return",
		"if",
		"else",
		"for",
		"while",
		"of",
		"console",
		"type",
		"interface",
		"number",
		"string",
		"boolean",
		"true",
		"false",
		"null",
		"export",
		"import",
	],
	lua: [
		"local",
		"function",
		"return",
		"if",
		"then",
		"else",
		"elseif",
		"end",
		"for",
		"do",
		"while",
		"print",
		"io",
		"in",
		"nil",
		"true",
		"false",
	],
};

const COMMENT: Record<Language, string> = {
	python: "#",
	prolog: "%",
	javascript: "//",
	typescript: "//",
	lua: "--",
};

const COLOR = {
	keyword: "#569cd6",
	string: "#ce9178",
	comment: "#6a9955",
	number: "#b5cea8",
	call: "#dcdcaa",
	variable: "#9cdcfe",
};

function escapeHtml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function span(color: string, text: string): string {
	return `<span style="color:${color}">${escapeHtml(text)}</span>`;
}

/** Colours one line of code; returns HTML. */
export function highlightLine(line: string, language: Language): string {
	const commentAt = line.indexOf(COMMENT[language]);
	let code = line;
	let comment = "";
	if (commentAt >= 0 && !insideString(line, commentAt)) {
		code = line.slice(0, commentAt);
		comment = line.slice(commentAt);
	}
	const keywords = new Set(KEYWORDS[language]);
	const tokens =
		code.match(
			/"[^"]*"|'[^']*'|\b\d+(?:\.\d+)?\b|[A-Za-z_]\w*(?=\()|[A-Z][a-z]\w*|\b[A-Za-z_]\w*\b|\s+|./g,
		) ?? [];
	const html = tokens
		.map((token) => {
			if (/^["']/.test(token)) return span(COLOR.string, token);
			if (/^\d/.test(token)) return span(COLOR.number, token);
			if (keywords.has(token)) return span(COLOR.keyword, token);
			if (/^[A-Za-z_]\w*$/.test(token) && code.includes(`${token}(`)) {
				return span(COLOR.call, token);
			}
			if (language === "prolog" && /^[A-Z_]\w*$/.test(token)) {
				return span(COLOR.variable, token);
			}
			return escapeHtml(token);
		})
		.join("");
	return comment ? html + span(COLOR.comment, comment) : html;
}

function insideString(line: string, index: number): boolean {
	const before = line.slice(0, index);
	const doubles = (before.match(/"/g) ?? []).length;
	const singles = (before.match(/'/g) ?? []).length;
	return doubles % 2 === 1 || singles % 2 === 1;
}

/** Splits a code block into highlighted lines. */
export function highlight(code: string, language: Language): string[] {
	return code
		.replace(/^\n/, "")
		.replace(/\n\s*$/, "")
		.split("\n")
		.map((line) => highlightLine(line, language));
}
