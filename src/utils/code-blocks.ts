/// Highlighted HTML of fenced code blocks, by `codeBlockKey`. The server
/// fills it (`highlightQuestionCodeBlocks`) and an island looks blocks up in
/// it, so the browser never loads the highlighter.
export type CodeBlocksHtml = Record<string, string>;

/** The key of a fenced block in `CodeBlocksHtml`: its language and its code. */
export function codeBlockKey(code: string, lang: string): string {
	return `${lang}\n${code}`;
}
