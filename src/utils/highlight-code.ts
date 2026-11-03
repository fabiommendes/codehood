import { bundledLanguages, bundledLanguagesAlias, codeToHtml } from "shiki";
import { CODE_THEMES } from "./code-themes";

/**
 * Renders `code` as highlighted HTML using `lang` (a `CODE` resource's
 * `extra`), falling back to plaintext for an unknown or missing language.
 * The server stores resource content as bytes and never refuses it because
 * it cannot pretty-print it. Renders both themes' colors as CSS variables
 * (`src/styles/global.css` switches between them on the site's `data-theme`
 * toggle) so this never re-runs on a theme change.
 */
export async function highlightCode(
	code: string,
	lang: string | null | undefined,
): Promise<string> {
	const key = lang?.trim().toLowerCase();
	const known =
		key && (key in bundledLanguages || key in bundledLanguagesAlias);
	return codeToHtml(code, {
		lang: known ? key : "plaintext",
		themes: CODE_THEMES,
		defaultColor: false,
	});
}
