/**
 * Syntax colors for the CodeMirror editor taken from Shiki, with the site's
 * code themes (`CODE_THEMES`) and the grammars the server uses for the
 * read-only view, so a snippet keeps its colors when it turns into an editor.
 *
 * Each token carries the colors of both themes as `--shiki-light` and
 * `--shiki-dark`, like the server's HTML, and `src/styles/global.css` picks
 * one for the site's theme (`.cm-shiki`), so a theme change needs no new pass.
 *
 * Only `createEditor` imports this module, with a dynamic `import()`.
 */

import type { LanguageId } from "@codehood/runner/protocol";
import type { Extension } from "@codemirror/state";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import type { HighlighterCore, ThemedToken } from "shiki/core";
import { runnerInfo } from "@/runner/languages";
import { CODE_THEMES } from "@/utils/code-themes";

/// The theme names of `CODE_THEMES`, by the color names of the server's HTML.
const THEMES = {
	light: CODE_THEMES.light.name ?? "light",
	dark: CODE_THEMES.dark.name ?? "dark",
};

/// One highlighter for every editor of the page; grammars load on first use.
let highlighter: Promise<HighlighterCore> | undefined;

/// The inline style of a token: its `--shiki-*` variables.
function tokenStyle(token: ThemedToken): string {
	return Object.entries(token.htmlStyle ?? {})
		.map(([name, value]) => `${name}:${value}`)
		.join(";");
}

/**
 * Returns a CodeMirror extension that colors `language` as Shiki does, or
 * `[]` when its plugin declares no grammar.
 */
export async function shikiHighlighting(
	language: LanguageId,
): Promise<Extension> {
	const grammar = runnerInfo(language)?.grammar;
	if (!grammar) return [];
	const [core, engine, view, state] = await Promise.all([
		import("shiki/core"),
		import("shiki/engine/javascript"),
		import("@codemirror/view"),
		import("@codemirror/state"),
	]);
	highlighter ??= core.createHighlighterCore({
		themes: [CODE_THEMES.light, CODE_THEMES.dark],
		langs: [],
		engine: engine.createJavaScriptRegexEngine(),
	});
	const shiki = await highlighter;
	if (!shiki.getLoadedLanguages().includes(grammar.name)) {
		await shiki.loadLanguage(
			(await grammar.load()) as Parameters<HighlighterCore["loadLanguage"]>[0],
		);
	}

	const { Decoration, ViewPlugin } = view;
	/// Mark decorations by style, so equal tokens share one.
	const marks = new Map<string, ReturnType<typeof Decoration.mark>>();
	const markOf = (style: string) => {
		let mark = marks.get(style);
		if (!mark) {
			mark = Decoration.mark({ class: "cm-shiki", attributes: { style } });
			marks.set(style, mark);
		}
		return mark;
	};

	const decorate = (code: string): DecorationSet => {
		const builder = new state.RangeSetBuilder<ReturnType<typeof markOf>>();
		const { tokens } = shiki.codeToTokens(code, {
			lang: grammar.name,
			themes: THEMES,
			defaultColor: false,
		});
		let lineStart = 0;
		for (const line of tokens) {
			let offset = lineStart;
			for (const token of line) {
				const style = tokenStyle(token);
				if (style && token.content.length > 0) {
					builder.add(offset, offset + token.content.length, markOf(style));
				}
				offset += token.content.length;
			}
			lineStart = offset + 1;
		}
		return builder.finish();
	};

	return ViewPlugin.define(
		(editor) => ({
			decorations: decorate(editor.state.doc.toString()),
			update(update: ViewUpdate) {
				if (update.docChanged) {
					this.decorations = decorate(update.state.doc.toString());
				}
			},
		}),
		{ decorations: (plugin) => plugin.decorations },
	);
}
