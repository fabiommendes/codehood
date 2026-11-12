import { expect, test } from "@playwright/test";
import type { InputKind } from "@/services/answer-edits/codec";
import {
	kindOfInputType,
	kindOfUserEvent,
} from "@/services/answer-edits/input-kind";

// How the page turns what the browser and CodeMirror announce into the kinds
// of the edit history. The result is an observed cause, never a guarantee.

const INPUT_TYPES: readonly (readonly [string | undefined, InputKind])[] = [
	["insertText", "typing"],
	["insertLineBreak", "typing"],
	["insertParagraph", "typing"],
	["insertFromPaste", "paste"],
	["insertFromPasteAsQuotation", "paste"],
	["deleteContentBackward", "delete"],
	["deleteContentForward", "delete"],
	["deleteWordBackward", "delete"],
	["deleteSoftLineForward", "delete"],
	["deleteByCut", "delete"],
	["historyUndo", "undo"],
	["historyRedo", "redo"],
	["insertCompositionText", "composition"],
	["deleteCompositionText", "composition"],
	["insertFromComposition", "composition"],
	["deleteByComposition", "composition"],
	["insertFromDrop", "other"],
	["deleteByDrag", "other"],
	["insertReplacementText", "other"],
	["insertFromYank", "other"],
	["formatBold", "other"],
	["somethingFromTheFuture", "other"],
	["", "other"],
	[undefined, "other"],
];

for (const [inputType, kind] of INPUT_TYPES) {
	test(`input type ${JSON.stringify(inputType)} is ${kind}`, () => {
		expect(kindOfInputType(inputType)).toBe(kind);
	});
}

const USER_EVENTS: readonly (readonly [string | undefined, InputKind])[] = [
	["input", "typing"],
	["input.type", "typing"],
	["input.indent", "typing"],
	["input.paste", "paste"],
	["input.type.compose", "composition"],
	["input.type.compose.start", "composition"],
	["input.drop", "other"],
	["input.complete", "other"],
	["delete", "delete"],
	["delete.backward", "delete"],
	["delete.forward", "delete"],
	["delete.selection", "delete"],
	["delete.cut", "delete"],
	["delete.dragtomove", "other"],
	["move.drop", "other"],
	["undo", "undo"],
	["redo", "redo"],
	["inputs", "other"],
	["something", "other"],
	["", "other"],
	[undefined, "other"],
];

for (const [userEvent, kind] of USER_EVENTS) {
	test(`user event ${JSON.stringify(userEvent)} is ${kind}`, () => {
		expect(kindOfUserEvent(userEvent)).toBe(kind);
	});
}
