/**
 * Syntax colors for the runner's CodeMirror editor taken from Shiki, with
 * the `dark-plus` theme and the grammars the server uses for the read-only
 * view, so a snippet keeps its colors when it turns into an editor.
 *
 * Only `createEditor` imports this module, with a dynamic `import()`.
 */

import type { Extension } from "@codemirror/state";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import type { HighlighterCore, ThemedToken } from "shiki/core";
import { runnerInfo } from "@/runner/languages";
import type { LanguageId } from "@/runner/protocol";

const THEME = "dark-plus";

/// One highlighter for every editor of the page; grammars load on first use.
let highlighter: Promise<HighlighterCore> | undefined;

/// Font style bits of a Shiki token.
const ITALIC = 1;
const BOLD = 2;
const UNDERLINE = 4;

/// The CSS of a token, or `""` when it has the theme's default look.
function tokenStyle(token: ThemedToken, foreground: string): string {
	const parts: string[] = [];
	if (token.color && token.color.toLowerCase() !== foreground) {
		parts.push(`color:${token.color}`);
	}
	const font = token.fontStyle ?? 0;
	if (font & ITALIC) parts.push("font-style:italic");
	if (font & BOLD) parts.push("font-weight:bold");
	if (font & UNDERLINE) parts.push("text-decoration:underline");
	return parts.join(";");
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
		themes: [import("shiki/themes/dark-plus.mjs")],
		langs: [],
		engine: engine.createJavaScriptRegexEngine(),
	});
	const shiki = await highlighter;
	if (!shiki.getLoadedLanguages().includes(grammar.name)) {
		await shiki.loadLanguage(
			(await grammar.load()) as Parameters<HighlighterCore["loadLanguage"]>[0],
		);
	}
	const foreground = (shiki.getTheme(THEME).fg ?? "").toLowerCase();

	const { Decoration, ViewPlugin } = view;
	/// Mark decorations by style, so equal tokens share one.
	const marks = new Map<string, ReturnType<typeof Decoration.mark>>();
	const markOf = (style: string) => {
		let mark = marks.get(style);
		if (!mark) {
			mark = Decoration.mark({ attributes: { style } });
			marks.set(style, mark);
		}
		return mark;
	};

	const decorate = (code: string): DecorationSet => {
		const builder = new state.RangeSetBuilder<ReturnType<typeof markOf>>();
		const lines = shiki.codeToTokensBase(code, {
			lang: grammar.name,
			theme: THEME,
		});
		for (const line of lines) {
			for (const token of line) {
				const style = tokenStyle(token, foreground);
				if (style && token.content.length > 0) {
					builder.add(
						token.offset,
						token.offset + token.content.length,
						markOf(style),
					);
				}
			}
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
