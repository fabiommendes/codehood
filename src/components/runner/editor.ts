/**
 * The code editor of the runner widget: CodeMirror 6 with the VS Code theme
 * and keymap, behind a small interface.
 *
 * Everything from CodeMirror is loaded with dynamic `import()` inside
 * `createEditor`; no other module imports it, so a page with a list of
 * snippets downloads none of it until an editor is focused.
 */

import type { LanguageId } from "@/runner/protocol";

/** What the widget needs from an editor. */
export interface RunnerEditor {
	/** The current source. */
	getCode(): string;

	/** Replaces the whole source without calling `onChange`. */
	setCode(code: string): void;

	/** Makes the editor read-only (still focusable and selectable) or writable. */
	setReadOnly(readOnly: boolean): void;

	focus(): void;
	destroy(): void;
}

export interface CreateEditorOptions {
	parent: HTMLElement;
	doc: string;
	language: LanguageId;
	readOnly: boolean;
	/// Accessible name of the editor.
	label: string;
	/// Description announced with the editor: how Tab works and how to leave.
	tabHint: string;
	/// Called with the full source after each edit.
	onChange(code: string): void;
	/// Called by Ctrl/Cmd+Enter.
	onRun(): void;
	/// Called each time the editor receives focus.
	onFocus(): void;
}

/// Gives each editor's hint element its own id.
let hints = 0;

/**
 * Creates the editor in `options.parent`.
 *
 * Ctrl/Cmd+Enter calls `onRun`; it is bound with `Prec.highest` so the VS
 * Code keymap cannot take it first.
 */
export async function createEditor(
	options: CreateEditorOptions,
): Promise<RunnerEditor> {
	const [state, view, commands, language, lezer, vscode, javascript] =
		await Promise.all([
			import("@codemirror/state"),
			import("@codemirror/view"),
			import("@codemirror/commands"),
			import("@codemirror/language"),
			import("@lezer/highlight"),
			import("@replit/codemirror-vscode-keymap"),
			import("@codemirror/lang-javascript"),
		]);
	const { Compartment, EditorState, Prec } = state;
	const {
		EditorView,
		keymap,
		drawSelection,
		highlightActiveLine,
		lineNumbers,
	} = view;
	const { tags } = lezer;

	/// Marks changes made by `setCode`, which do not reach `onChange`.
	const external = state.Annotation.define<boolean>();
	const readOnly = new Compartment();
	const readOnlyExtensions = (value: boolean) => [
		EditorState.readOnly.of(value),
		EditorView.contentAttributes.of({ "aria-readonly": String(value) }),
	];

	const highlight = language.HighlightStyle.define([
		{ tag: [tags.keyword, tags.controlKeyword], color: "#569cd6" },
		{ tag: [tags.moduleKeyword, tags.operatorKeyword], color: "#c586c0" },
		{ tag: [tags.string, tags.special(tags.string)], color: "#ce9178" },
		{ tag: [tags.number, tags.bool, tags.null], color: "#b5cea8" },
		{ tag: tags.regexp, color: "#d16969" },
		{
			tag: [tags.comment, tags.lineComment, tags.blockComment],
			color: "#6a9955",
		},
		{
			tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
			color: "#dcdcaa",
		},
		{
			tag: [tags.definition(tags.variableName), tags.variableName],
			color: "#9cdcfe",
		},
		{ tag: tags.propertyName, color: "#9cdcfe" },
		{ tag: [tags.typeName, tags.className], color: "#4ec9b0" },
		{ tag: [tags.operator, tags.punctuation], color: "#d4d4d4" },
	]);

	const theme = EditorView.theme(
		{
			"&": {
				backgroundColor: "#1e1e1e",
				color: "#d4d4d4",
				fontSize: "13px",
			},
			".cm-scroller": {
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
				lineHeight: "1.25rem",
				overflow: "auto",
			},
			".cm-content": { caretColor: "#aeafad", padding: "0.5rem 0" },
			".cm-line": { padding: "0 0.75rem" },
			"&.cm-focused": { outline: "2px solid #007acc", outlineOffset: "-2px" },
			".cm-cursor, .cm-dropCursor": { borderLeftColor: "#aeafad" },
			".cm-activeLine": { backgroundColor: "#ffffff0a" },
			"&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection":
				{ backgroundColor: "#264f78" },
			".cm-gutters": {
				backgroundColor: "#1e1e1e",
				color: "#858585",
				border: "none",
			},
			".cm-activeLineGutter": {
				backgroundColor: "transparent",
				color: "#c6c6c6",
			},
			".cm-panels": { backgroundColor: "#252526", color: "#d4d4d4" },
		},
		{ dark: true },
	);

	const hintId = `runner-editor-hint-${++hints}`;
	const hint = document.createElement("span");
	hint.id = hintId;
	hint.className = "sr-only";
	hint.textContent = options.tabHint;
	options.parent.append(hint);

	const languageSupport =
		options.language === "javascript" ? [javascript.javascript()] : [];

	const editor = new EditorView({
		parent: options.parent,
		state: EditorState.create({
			doc: options.doc,
			extensions: [
				Prec.highest(
					keymap.of([
						{
							key: "Mod-Enter",
							run: () => {
								options.onRun();
								return true;
							},
						},
					]),
				),
				keymap.of(vscode.vscodeKeymap),
				commands.history(),
				drawSelection(),
				highlightActiveLine(),
				language.bracketMatching(),
				language.syntaxHighlighting(highlight),
				theme,
				languageSupport,
				readOnly.of(readOnlyExtensions(options.readOnly)),
				EditorView.contentAttributes.of({
					"aria-label": options.label,
					"aria-describedby": hintId,
				}),
				lineNumbers(),
				EditorView.updateListener.of((update) => {
					if (
						update.docChanged &&
						!update.transactions.some((t) => t.annotation(external))
					) {
						options.onChange(update.state.doc.toString());
					}
				}),
				EditorView.domEventHandlers({
					focus: () => {
						options.onFocus();
					},
				}),
			],
		}),
	});

	return {
		getCode: () => editor.state.doc.toString(),
		setCode(code) {
			editor.dispatch({
				changes: { from: 0, to: editor.state.doc.length, insert: code },
				annotations: external.of(true),
			});
		},
		setReadOnly(value) {
			editor.dispatch({
				effects: readOnly.reconfigure(readOnlyExtensions(value)),
			});
		},
		focus() {
			editor.focus();
		},
		destroy() {
			editor.destroy();
			hint.remove();
		},
	};
}
