import type { ThemeRegistration } from "shiki";

/// Colors of a code theme by syntax role, each 4.5:1 or more on `background`.
interface CodePalette {
	background: string;
	foreground: string;
	comment: string;
	keyword: string;
	string: string;
	constant: string;
	func: string;
	type: string;
	tag: string;
	punctuation: string;
}

/// Dark theme: the landing page's terminal, on `neutral`, with the theme's
/// light sources as token colors.
const FOREST: CodePalette = {
	background: "#081510",
	foreground: "#e6f0ea",
	comment: "#8fb3a4",
	keyword: "#ff4d97",
	string: "#4cd08a",
	constant: "#ffc400",
	func: "#4aa0ff",
	type: "#00d2e6",
	tag: "#ff6f1a",
	punctuation: "#b8cfc4",
};

/// Light theme: ink on the lime wash of `base-200`.
const CERRADO: CodePalette = {
	background: "#f7f3ea",
	foreground: "#1f2a24",
	comment: "#575f5a",
	keyword: "#a8309a",
	string: "#337a27",
	constant: "#b5452a",
	func: "#1b4b9b",
	type: "#2670c0",
	tag: "#9c4a00",
	punctuation: "#3d4a43",
};

/// Builds a TextMate theme that maps the common scopes onto a palette.
function codeTheme(
	name: string,
	type: "light" | "dark",
	p: CodePalette,
): ThemeRegistration {
	return {
		name,
		type,
		colors: {
			"editor.background": p.background,
			"editor.foreground": p.foreground,
		},
		tokenColors: [
			{
				scope: ["comment", "punctuation.definition.comment"],
				settings: { foreground: p.comment, fontStyle: "italic" },
			},
			{
				scope: ["keyword", "storage", "storage.type", "storage.modifier"],
				settings: { foreground: p.keyword },
			},
			{
				scope: ["string", "string.regexp", "markup.inline.raw"],
				settings: { foreground: p.string },
			},
			{
				scope: [
					"constant",
					"constant.numeric",
					"constant.language",
					"support.constant",
					"variable.other.enummember",
				],
				settings: { foreground: p.constant },
			},
			{
				scope: [
					"entity.name.function",
					"support.function",
					"meta.function-call",
				],
				settings: { foreground: p.func },
			},
			{
				scope: [
					"entity.name.type",
					"entity.name.class",
					"support.type",
					"support.class",
					"entity.other.inherited-class",
				],
				settings: { foreground: p.type },
			},
			{
				scope: ["entity.name.tag", "entity.other.attribute-name"],
				settings: { foreground: p.tag },
			},
			{
				scope: ["punctuation", "keyword.operator", "meta.brace"],
				settings: { foreground: p.punctuation },
			},
			{
				scope: ["markup.heading", "markup.bold"],
				settings: { fontStyle: "bold" },
			},
			{ scope: "markup.italic", settings: { fontStyle: "italic" } },
		],
	};
}

/// The site's code themes, keyed as `codeToHtml` takes them.
export const CODE_THEMES = {
	light: codeTheme("codehood-cerrado", "light", CERRADO),
	dark: codeTheme("codehood-forest", "dark", FOREST),
};
