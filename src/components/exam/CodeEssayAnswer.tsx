/**
 * Answer field of an essay question with `content: "code"` whose language
 * has a runner driver: the question text around a `CodeRunner` in `answer`
 * mode, with autosave status and the local draft.
 */

import type { JSX } from "solid-js";
import type { LanguageId } from "@/runner/protocol";
import type { DraftRef } from "./code-draft";

/** Where the autosave of this answer stands, as `ExamAttempt` tracks it. */
export interface CodeAnswerSaveState {
	/// `saved`: the server has the current code. `saving`: a save is in
	/// flight (shown only once it is slow). `unsaved`: an edit is waiting.
	state: "saved" | "saving" | "unsaved";
	/// When the server last confirmed a save in this page; null before the first.
	savedAt: Date | null;
	/// Since when saves have been failing; null while they succeed.
	failingSince: Date | null;
}

export interface CodeEssayAnswerProps {
	/// Stem and epilogue in Markdown, as in the public essay question.
	stem: string;
	epilogue?: string;
	language: LanguageId;
	/// The server's saved answer; `""` when there is none.
	value: string;
	/// When the server saved `value`; null when there is no answer.
	valueSavedAt: Date | null;
	/// Called with the full code after each edit; `ExamAttempt` debounces and saves.
	onChange: (code: string) => void;
	save: CodeAnswerSaveState;
	/// From `canRunCode(exam)`.
	codeRun: boolean;
	runnerOrigin: string | null;
	draft: DraftRef;
	/// Code the editor starts with when there is no answer and no draft.
	/// Reserved for starter code from the question; nothing sets it yet.
	starterCode?: string;
}

/**
 * Renders the stem, the code editor and the epilogue.
 *
 * On mount it reads the local draft and compares it with `value`
 * (`compareDraft`). `same` drops the draft; `conflict` shows both versions
 * side by side, as plain text with their times, and keeps Run and the editor
 * off until the student picks one; the pick is written through `onChange`
 * when it is the draft. Each edit writes the draft and calls `onChange`.
 * When `value` is saved and equals the draft, the draft is removed.
 *
 * The footer shows "Saved at HH:MM", "Saving…", or, while saves fail, that
 * the server has not received the changes since `failingSince` and the draft
 * is kept in this browser. Running never saves anything.
 */
export function CodeEssayAnswer(_props: CodeEssayAnswerProps): JSX.Element {
	throw new Error("not implemented");
}
