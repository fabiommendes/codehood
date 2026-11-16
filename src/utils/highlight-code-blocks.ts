import MarkdownIt from "markdown-it";
import { type CodeBlocksHtml, codeBlockKey } from "./code-blocks";
import { highlightCode } from "./highlight-code";

/// A piece of code to highlight and the language to highlight it in, empty for none.
export interface CodeSnippet {
	code: string;
	lang: string;
}

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
function fencedBlocks(text: string): CodeSnippet[] {
	return md
		.parse(text, {})
		.filter((token) => token.type === "fence")
		.map((token) => ({
			code: token.content,
			lang: md.utils.unescapeAll(token.info).trim().split(/\s+/)[0] ?? "",
		}));
}

/// The language a question's code is written in: a code question's `language`, an essay's `highlight`.
function questionLanguage(question: unknown): string {
	if (question === null || typeof question !== "object") return "";
	const { language, highlight } = question as Record<string, unknown>;
	if (typeof language === "string") return language;
	return typeof highlight === "string" ? highlight : "";
}

/// The code a question shows outside its Markdown, at any depth (a pool
/// holds several questions): the example tests of a code question and the
/// text of its attachments.
function* codeOutsideMarkdown(value: unknown): Generator<CodeSnippet> {
	if (Array.isArray(value)) {
		for (const item of value) yield* codeOutsideMarkdown(item);
		return;
	}
	if (value === null || typeof value !== "object") return;
	const record = value as Record<string, unknown>;
	if (Array.isArray(record.attachments)) {
		for (const item of record.attachments as {
			text?: unknown;
			format?: unknown;
		}[]) {
			if (typeof item.text === "string") {
				yield {
					code: item.text,
					lang: typeof item.format === "string" ? item.format : "",
				};
			}
		}
	}
	if (record.type === "code" && Array.isArray(record.publicTests)) {
		const lang = questionLanguage(record);
		for (const test of record.publicTests as {
			text?: unknown;
			example?: unknown;
		}[]) {
			if (test.example && typeof test.text === "string") {
				yield { code: test.text, lang };
			}
		}
	}
	for (const [key, item] of Object.entries(record)) {
		if (key !== "attachments" && typeof item === "object") {
			yield* codeOutsideMarkdown(item);
		}
	}
}

/**
 * Highlights each snippet with the site's code themes, keyed by
 * `codeBlockKey`, for an island to draw through `CodeBlocks`.
 */
export async function highlightSnippets(
	snippets: Iterable<CodeSnippet>,
): Promise<CodeBlocksHtml> {
	const unique = new Map<string, CodeSnippet>();
	for (const snippet of snippets) {
		unique.set(codeBlockKey(snippet.code, snippet.lang), snippet);
	}
	const entries = await Promise.all(
		[...unique].map(
			async ([key, { code, lang }]) =>
				[key, await highlightCode(code.replace(/\n$/, ""), lang)] as const,
		),
	);
	return Object.fromEntries(entries);
}

/**
 * The code of the answers to a question as a review shows them, such as the
 * student's answer and a reference solution: those of a code question, or of
 * an essay whose content is code, in the question's language. Other questions,
 * and answers that are not text, give none.
 */
export function answerSnippets(
	question: unknown,
	answers: readonly unknown[],
): CodeSnippet[] {
	const record = (question ?? {}) as Record<string, unknown>;
	const isCode =
		record.type === "code" ||
		(record.type === "essay" && record.content === "code");
	if (!isCode) return [];
	const lang = questionLanguage(question);
	return answers
		.filter(
			(code): code is string => typeof code === "string" && code.trim() !== "",
		)
		.map((code) => ({ code, lang }));
}

/**
 * Highlights the code of every Markdown text of a question (stem, choices,
 * feedback, at any depth), the example tests of a code question, the text of
 * its attachments and the `extra` snippets, such as `answerSnippets`, with
 * the site's code themes.
 *
 * An island hands the result to `CodeBlocks`, which puts each block in place
 * of the plain `<pre>` of `mdq/solid`.
 */
export async function highlightQuestionCodeBlocks(
	question: unknown,
	extra: Iterable<CodeSnippet> = [],
): Promise<CodeBlocksHtml> {
	const snippets: CodeSnippet[] = [...codeOutsideMarkdown(question), ...extra];
	for (const text of strings(question)) {
		if (FENCE.test(text)) snippets.push(...fencedBlocks(text));
	}
	return highlightSnippets(snippets);
}
