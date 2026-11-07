/**
 * Maps the language tags the app stores to runner languages.
 *
 * Tags come from a `CODE` resource's `language`, an essay question's
 * `highlight`, and the info string of a fenced code block in a note.
 */

import type { LanguageId } from "./protocol";

/// Tags that map to a driver. `fake` is deliberately absent.
const ALIASES: Record<string, LanguageId | undefined> = {
	javascript: "javascript",
	js: "javascript",
	mjs: "javascript",
	node: "javascript",
};

/// File extension of each language's source files.
const EXTENSIONS: Record<LanguageId, string> = {
	javascript: "js",
	fake: "fake",
};

/**
 * The runner language for a tag, or null when no driver runs it.
 *
 * Case-insensitive; accepts the usual aliases (`js`, `mjs`, `javascript`,
 * `node` for JavaScript). Never returns `fake`: that driver is reachable only
 * from tests. A language whose driver arrives in a later delivery maps to
 * null until its id is in `languageId`.
 *
 * @example
 * runnerLanguage("JS"); // "javascript"
 * runnerLanguage("haskell"); // null
 */
export function runnerLanguage(
	tag: string | null | undefined,
): LanguageId | null {
	if (!tag) return null;
	return Object.hasOwn(ALIASES, tag.trim().toLowerCase())
		? (ALIASES[tag.trim().toLowerCase()] ?? null)
		: null;
}

/** Default file name for a program in `language` (`main.js`). */
export function defaultFilename(language: LanguageId): string {
	return `main.${EXTENSIONS[language]}`;
}
