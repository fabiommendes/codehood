/**
 * Maps the language tags the app stores to runner languages.
 *
 * Tags come from a `CODE` resource's `language`, an essay question's
 * `highlight`, and the info string of a fenced code block in a note. The
 * languages are those of the plugins in `runner.languages`.
 */

import { runners } from "codehood:runners";
import type { LanguageId, RunMode } from "./protocol";
import type { RunnerInfo } from "./registry";

/// Each language by id.
const BY_ID = new Map<string, RunnerInfo>(
	runners.map((runner) => [runner.id, runner]),
);

/// Each alias to its language. `fake` is deliberately absent.
const ALIASES = new Map<string, LanguageId>(
	runners.flatMap((runner) =>
		runner.aliases.map((alias) => [alias, runner.id] as const),
	),
);

/**
 * The runner language for a tag, or null when no driver runs it.
 *
 * Case-insensitive; accepts each plugin's aliases (`js`, `mjs`, `node` for
 * JavaScript, say). Never returns `fake`: that driver is reachable only from
 * tests.
 *
 * @example
 * runnerLanguage("JS"); // "javascript"
 * runnerLanguage("haskell"); // null
 */
export function runnerLanguage(
	tag: string | null | undefined,
): LanguageId | null {
	if (!tag) return null;
	return ALIASES.get(tag.trim().toLowerCase()) ?? null;
}

/** What the app knows of `language`, or undefined for `fake` and unknown ids. */
export function runnerInfo(language: LanguageId): RunnerInfo | undefined {
	return BY_ID.get(language);
}

/** How Run starts `language`, as its plugin declares; `script` for `fake`. */
export function defaultRunMode(language: LanguageId): RunMode {
	return BY_ID.get(language)?.defaultMode ?? "script";
}

/** Default file name for a program in `language` (`main.js`, `Main.elm`). */
export function defaultFilename(language: LanguageId): string {
	return BY_ID.get(language)?.defaultFilename ?? `main.${language}`;
}

/** Name of `language` shown in the widget; the id for `fake`. */
export function languageLabel(language: LanguageId): string {
	return BY_ID.get(language)?.label ?? language;
}

/** Note shown next to Run when each Run starts `language` over, or null. */
export function restartNote(language: LanguageId): string | null {
	return BY_ID.get(language)?.restartNote ?? null;
}
