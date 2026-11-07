/**
 * Maps the language tags the app stores to runner languages.
 *
 * Tags come from a `CODE` resource's `language`, an essay question's
 * `highlight`, and the info string of a fenced code block in a note.
 */

import type { LanguageId } from "./protocol";

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
	_tag: string | null | undefined,
): LanguageId | null {
	throw new Error("not implemented");
}

/** Default file name for a program in `language` (`main.js`). */
export function defaultFilename(_language: LanguageId): string {
	throw new Error("not implemented");
}
