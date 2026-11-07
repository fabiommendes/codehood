import { bundledLanguages, bundledLanguagesAlias, codeToHtml } from "shiki";
import { CODE_THEMES } from "./code-themes";

/**
 * Renders `code` as highlighted HTML using `lang` (a `CODE` resource's
 * `extra`), falling back to plaintext for an unknown or missing language.
 * The server stores resource content as bytes and never refuses it because
 * it cannot pretty-print it. Renders both themes' colors as CSS variables
 * (`src/styles/global.css` switches between them on the site's `data-theme`
 * toggle) so this never re-runs on a theme change. With `theme: "vscode"`,
 * it uses VS Code's `dark-plus` in both site themes, to match the dark
 * code editor of the runner widget.
 */
export async function highlightCode(
	code: string,
	lang: string | null | undefined,
	options: { theme?: "site" | "vscode" } = {},
): Promise<string> {
	const key = lang?.trim().toLowerCase();
	const known =
		key && (key in bundledLanguages || key in bundledLanguagesAlias);
	return codeToHtml(code, {
		lang: known ? key : "plaintext",
		themes:
			options.theme === "vscode"
				? { light: "dark-plus", dark: "dark-plus" }
				: CODE_THEMES,
		defaultColor: false,
	});
}
