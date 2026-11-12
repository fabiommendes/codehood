/**
 * The code editor of the runner widget: CodeMirror 6 with the VS Code keymap
 * and Shiki's `dark-plus` colors (the ones of the read-only view), behind a
 * small interface.
 *
 * Everything from CodeMirror is loaded with dynamic `import()` inside
 * `createEditor`; no other module imports it, so a page with a list of
 * snippets downloads none of it until an editor is focused.
 */

import type { LanguageId } from "@codehood/runner/protocol";
import type { AnnotationType, Extension, Transaction } from "@codemirror/state";
import { runnerInfo } from "@/runner/languages";

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
	/// Called with the full source after each edit, and the CodeMirror user event behind it when there is a single one (`input.paste`, `undo`, ...).
	onChange(code: string, userEvent?: string): void;
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
	const loadSupport = runnerInfo(options.language)?.editor;
	const [state, view, commands, language, vscode, lint, colors, support] =
		await Promise.all([
			import("@codemirror/state"),
			import("@codemirror/view"),
			import("@codemirror/commands"),
			import("@codemirror/language"),
			import("@replit/codemirror-vscode-keymap"),
			import("@codemirror/lint"),
			import("./shiki-highlight").then((shiki) =>
				shiki.shikiHighlighting(options.language),
			),
			// The plugin's language support: indentation, brackets, folding.
			loadSupport
				? loadSupport().then(
						(module) => module.default() as Extension | Promise<Extension>,
					)
				: [],
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
				support,
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
						options.onChange(
							update.state.doc.toString(),
							userEventOf(update.transactions, state.Transaction.userEvent),
						);
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

/// The user event shared by every transaction that changed the document, or undefined when there is none or they differ; never throws.
function userEventOf(
	transactions: readonly Transaction[],
	annotation: AnnotationType<string>,
): string | undefined {
	try {
		const events = new Set(
			transactions
				.filter((transaction) => transaction.docChanged)
				.map((transaction) => transaction.annotation(annotation)),
		);
		return events.size === 1 ? [...events][0] : undefined;
	} catch {
		return undefined;
	}
}
