import MarkdownIt from "markdown-it";
import { type CodeBlocksHtml, codeBlockKey } from "./code-blocks";
import { highlightCode } from "./highlight-code";

/// Only finds the fenced blocks; their content and info string do not depend
/// on the options of the instance that renders them.
const md = new MarkdownIt();

/// A string that may hold a fenced block, judged before parsing it.
const FENCE = /```|~~~/;

/// Every string inside `value`, at any depth.
function* strings(value: unknown): Generator<string> {
	if (typeof value === "string") yield value;
	else if (Array.isArray(value)) for (const item of value) yield* strings(item);
	else if (value !== null && typeof value === "object") {
		for (const item of Object.values(value)) yield* strings(item);
	}
}

/// The code and language of each fenced block of a Markdown text, the
/// language being the first word of the info string, as `mdq/solid` passes it.
function fencedBlocks(text: string): { code: string; lang: string }[] {
	return md
		.parse(text, {})
		.filter((token) => token.type === "fence")
		.map((token) => ({
			code: token.content,
			lang: md.utils.unescapeAll(token.info).trim().split(/\s+/)[0] ?? "",
		}));
}

/**
 * Highlights the fenced code blocks of every Markdown text of a question
 * (stem, choices, feedback, at any depth) with the site's code themes.
 *
 * An island hands the result to `CodeBlocks`, which puts each block in place
 * of the plain `<pre>` of `mdq/solid`.
 */
export async function highlightQuestionCodeBlocks(
	question: unknown,
): Promise<CodeBlocksHtml> {
	const blocks = new Map<string, { code: string; lang: string }>();
	for (const text of strings(question)) {
		if (!FENCE.test(text)) continue;
		for (const block of fencedBlocks(text)) {
			blocks.set(codeBlockKey(block.code, block.lang), block);
		}
	}
	const entries = await Promise.all(
		[...blocks].map(
			async ([key, { code, lang }]) =>
				[key, await highlightCode(code.replace(/\n$/, ""), lang)] as const,
		),
	);
	return Object.fromEntries(entries);
}
