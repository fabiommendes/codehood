/**
 * Browser-side drafts of code answers, kept in `localStorage` so a lost
 * autosave does not lose the student's code.
 *
 * A draft belongs to one user, exam and question. Every draft is removed at
 * logout. The server's autosaved answer stays the answer; the draft only
 * exists to offer the student their newer local copy when the two differ.
 */

/// Prefix of every `localStorage` key this module writes.
export const DRAFT_KEY_PREFIX = "codehood:code-draft:";

/** A local copy of a code answer and when it was written. */
export interface CodeDraft {
	code: string;
	/// Epoch milliseconds.
	savedAt: number;
}

/** Identifies the answer a draft belongs to. */
export interface DraftRef {
	username: string;
	/// Course reference as in URLs (`discipline/edition/instructor`).
	course: string;
	exam: string;
	question: string;
}

/**
 * How the local draft and the server's answer relate when the question opens.
 *
 * `none`: no draft; use the server's answer. `same`: the draft matches the
 * server's answer; the draft is dropped. `conflict`: they differ; the student
 * chooses, seeing both side by side as plain text with their times.
 */
export type DraftComparison = "none" | "same" | "conflict";

/** The `localStorage` key of the draft for `ref`. Each part is URI-encoded. */
export function draftKey(_ref: DraftRef): string {
	throw new Error("not implemented");
}

/** Compares a draft with the server's answer (`""` when the student never saved one). */
export function compareDraft(
	_draft: CodeDraft | null,
	_serverCode: string,
): DraftComparison {
	throw new Error("not implemented");
}

/** Reads, writes and removes drafts; storage errors (quota, privacy mode) are swallowed. */
export interface DraftStore {
	read(ref: DraftRef): CodeDraft | null;
	write(ref: DraftRef, draft: CodeDraft): void;
	remove(ref: DraftRef): void;
	/** Removes every key starting with `DRAFT_KEY_PREFIX`, for every user. */
	clearAll(): void;
}

/** A `DraftStore` over `storage` (`window.localStorage` in the browser). */
export function draftStore(_storage: Storage): DraftStore {
	throw new Error("not implemented");
}
