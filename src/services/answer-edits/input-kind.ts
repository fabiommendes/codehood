import type { InputKind } from "./codec";

/// What each `InputEvent.inputType` the browser announces counts as; anything absent is `other`.
const INPUT_TYPE_KINDS: Readonly<Record<string, InputKind>> = {
	insertText: "typing",
	insertLineBreak: "typing",
	insertParagraph: "typing",
	insertFromPaste: "paste",
	insertFromPasteAsQuotation: "paste",
	/// Dropped text arrives from outside the typing flow, as a paste does.
	insertFromDrop: "paste",
	historyUndo: "undo",
	historyRedo: "redo",
	insertCompositionText: "composition",
	deleteCompositionText: "composition",
	insertFromComposition: "composition",
	deleteByComposition: "composition",
	/// The removal half of a drag and drop move inside the field.
	deleteByDrag: "other",
};

/// What each CodeMirror user event counts as, most specific first; an event is matched by itself or by its prefix.
const USER_EVENT_KINDS: readonly (readonly [string, InputKind])[] = [
	["input.type.compose", "composition"],
	["input.paste", "paste"],
	["input.drop", "paste"],
	["input.complete", "other"],
	["input.type", "typing"],
	["input.indent", "typing"],
	["input", "typing"],
	["delete.dragtomove", "other"],
	["delete", "delete"],
	["undo", "undo"],
	["redo", "redo"],
];

/**
 * The kind of edit a browser `inputType` announces, `other` when it is missing or unknown.
 *
 * The result is the observed cause of the edit, not a guarantee of its origin.
 * Never throws.
 */
export function kindOfInputType(inputType: string | undefined): InputKind {
	if (typeof inputType !== "string") return "other";
	const known = INPUT_TYPE_KINDS[inputType];
	if (known !== undefined && Object.hasOwn(INPUT_TYPE_KINDS, inputType))
		return known;
	return inputType.startsWith("delete") ? "delete" : "other";
}

/**
 * The kind of edit a CodeMirror user event announces, `other` when it is missing or unknown.
 *
 * Never throws.
 */
export function kindOfUserEvent(userEvent: string | undefined): InputKind {
	if (typeof userEvent !== "string") return "other";
	for (const [name, kind] of USER_EVENT_KINDS)
		if (userEvent === name || userEvent.startsWith(`${name}.`)) return kind;
	return "other";
}
