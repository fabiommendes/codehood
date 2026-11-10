/**
 * The code editor of the runner widget: CodeMirror 6 with the VS Code keymap
 * and Shiki's `dark-plus` colors (the ones of the read-only view), behind a
 * small interface.
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

	/** Underlines each problem at its place, replacing the previous ones; `[]` clears them. */
	showDiagnostics(diagnostics: readonly EditorDiagnostic[]): void;

	focus(): void;
	destroy(): void;
}

/// A problem in the source: 1-based `line`, 0-based `column`.
export interface EditorDiagnostic {
	line: number;
	column: number;
	message: string;
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
	const [state, view, commands, language, vscode, javascript, lint, colors] =
		await Promise.all([
			import("@codemirror/state"),
			import("@codemirror/view"),
			import("@codemirror/commands"),
			import("@codemirror/language"),
			import("@replit/codemirror-vscode-keymap"),
			import("@codemirror/lang-javascript"),
			import("@codemirror/lint"),
			import("./shiki-highlight").then((shiki) =>
				shiki.shikiHighlighting(options.language),
			),
		]);
	const { Compartment, EditorState, Prec } = state;
	const {
		EditorView,
		keymap,
		drawSelection,
		highlightActiveLine,
		lineNumbers,
	} = view;

	/// Marks changes made by `setCode`, which do not reach `onChange`.
	const external = state.Annotation.define<boolean>();
	const readOnly = new Compartment();
	const readOnlyExtensions = (value: boolean) => [
		EditorState.readOnly.of(value),
		EditorView.contentAttributes.of({ "aria-readonly": String(value) }),
	];

	const theme = EditorView.theme(
		{
			"&": {
				backgroundColor: "#1e1e1e",
				color: "#d4d4d4",
				fontSize: "inherit",
			},
			".cm-scroller": {
				fontFamily: "inherit",
				lineHeight: "1.25rem",
				overflow: "auto",
			},
			".cm-content": { caretColor: "#aeafad", padding: "0.5rem 0" },
			".cm-line": { padding: "0 0.75rem" },
			// The focus ring is drawn by the widget, above the sticky gutter.
			"&.cm-focused": { outline: "none" },
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
			".cm-tooltip": {
				backgroundColor: "#252526",
				color: "#d4d4d4",
				border: "1px solid #454545",
			},
			".cm-diagnostic": { fontFamily: "inherit", whiteSpace: "pre-wrap" },
		},
		{ dark: true },
	);

	const hintId = `runner-editor-hint-${++hints}`;
	const hint = document.createElement("span");
	hint.id = hintId;
	hint.className = "sr-only";
	hint.textContent = options.tabHint;
	options.parent.append(hint);

	const languageSupport = [];
	if (options.language === "javascript" || options.language === "typescript") {
		languageSupport.push(
			javascript.javascript({ typescript: options.language === "typescript" }),
		);
	} else if (options.language === "lua") {
		const { lua } = await import("@codemirror/legacy-modes/mode/lua");
		languageSupport.push(language.StreamLanguage.define(lua));
	} else if (options.language === "python") {
		const { python } = await import("@codemirror/legacy-modes/mode/python");
		languageSupport.push(language.StreamLanguage.define(python));
	} else if (options.language === "prolog") {
		const { prolog } = await import("./prolog-mode");
		languageSupport.push(language.StreamLanguage.define(prolog));
	} else if (options.language === "elm") {
		const { elm } = await import("@codemirror/legacy-modes/mode/elm");
		languageSupport.push(language.StreamLanguage.define(elm));
	}

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
				colors,
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
			editor.dispatch(lint.setDiagnostics(editor.state, []));
		},
		setReadOnly(value) {
			editor.dispatch({
				effects: readOnly.reconfigure(readOnlyExtensions(value)),
			});
		},
		showDiagnostics(diagnostics) {
			const { doc } = editor.state;
			const marks = diagnostics
				.filter((d) => d.line <= doc.lines)
				.map((d) => {
					const line = doc.line(d.line);
					const from = Math.min(line.from + d.column, line.to);
					// One character, so a mark at the end of a line stays visible.
					return {
						from,
						to: Math.min(from + 1, line.to),
						severity: "error" as const,
						message: d.message,
					};
				});
			editor.dispatch(lint.setDiagnostics(editor.state, marks));
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
