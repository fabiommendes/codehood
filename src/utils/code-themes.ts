import type { ThemeRegistration } from "shiki";

/// Colors of a code theme: the syntax roles, each 4.5:1 or more on
/// `background`, and the chrome of an editor around them.
interface CodePalette {
	background: string;
	foreground: string;
	/// Line numbers and secondary text of the editor and the terminal, 3:1 or more.
	muted: string;
	/// Toolbars and panel headers next to the code.
	panel: string;
	/// Lines between the code and its panels.
	border: string;
	/// Selected text, under the foreground.
	selection: string;
	/// The line that holds the cursor.
	activeLine: string;
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
	muted: "#6f9384",
	panel: "#0f231a",
	border: "#1f3d30",
	selection: "#21503d",
	activeLine: "#ffffff0a",
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
	muted: "#6e746f",
	panel: "#ede6d6",
	border: "#d9cfba",
	selection: "#d3e3bd",
	activeLine: "#0000000a",
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

/**
 * The colors of the runner terminal (xterm.js `ITheme`) in the site's light
 * or dark code theme, the ANSI colors taken from its syntax roles.
 */
export function terminalTheme(dark: boolean): Record<string, string> {
	const p = dark ? FOREST : CERRADO;
	const ansi = {
		black: dark ? p.muted : p.foreground,
		red: p.constant,
		green: p.string,
		yellow: p.tag,
		blue: p.func,
		magenta: p.keyword,
		cyan: p.type,
		white: dark ? p.foreground : p.muted,
	};
	return {
		background: p.background,
		foreground: p.foreground,
		cursor: p.foreground,
		selectionBackground: p.selection,
		...ansi,
		...Object.fromEntries(
			Object.entries(ansi).map(([name, color]) => [
				`bright${name[0]?.toUpperCase()}${name.slice(1)}`,
				color,
			]),
		),
	};
}

/// The editor chrome of a palette as `--code-*` custom properties.
function chromeVariables(p: CodePalette): string {
	return [
		`--code-bg:${p.background}`,
		`--code-fg:${p.foreground}`,
		`--code-muted:${p.muted}`,
		`--code-panel:${p.panel}`,
		`--code-border:${p.border}`,
		`--code-selection:${p.selection}`,
		`--code-active-line:${p.activeLine}`,
	].join(";");
}

/**
 * The CSS that sets the `--code-*` custom properties (background, text, line
 * numbers, panels, selection) of the site's code themes, the light one by
 * default and the dark one under `[data-theme="codehood-dark"]`.
 *
 * Every surface that shows or edits code (Shiki blocks, the CodeMirror
 * editor, the runner terminal) reads these, so they match the token colors
 * of `CODE_THEMES` and follow the site's theme toggle.
 */
export const CODE_THEME_CSS = `:root{${chromeVariables(CERRADO)}}[data-theme="codehood-dark"]{${chromeVariables(FOREST)}}`;
