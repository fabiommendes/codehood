/**
 * Browser-side drafts of code answers, kept in `localStorage` so a lost
 * autosave does not lose the student's code.
 *
 * A draft belongs to one user, exam and question. The server's autosaved
 * answer stays the answer; the draft only exists to offer the student their
 * newer local copy when the two differ. Drafts are removed at logout, when
 * another user opens an authenticated page in the same browser, when the
 * exam is submitted or closed, and after `DRAFT_TTL_MS`.
 *
 * Times are compared on the server's clock: a draft records the client time
 * plus the offset `serverNow - clientNow` measured when the page loaded.
 */

/// Prefix of every `localStorage` key this module writes.
export const DRAFT_KEY_PREFIX = "codehood:code-draft:";

/// How long a draft is kept after its last write.
export const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** A local copy of a code answer and when it was written. */
export interface CodeDraft {
	code: string;
	/// Epoch milliseconds on the server's clock (client time + offset).
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
 * chooses, and `newer` says which was written last on the server's clock
 * (the one an automatic submission at the deadline keeps).
 */
export type DraftComparison =
	| { kind: "none" }
	| { kind: "same" }
	| { kind: "conflict"; newer: "draft" | "server" };

/** The `localStorage` key of the draft for `ref`. Each part is URI-encoded. */
export function draftKey(_ref: DraftRef): string {
	throw new Error("not implemented");
}

/**
 * Compares a draft with the server's answer.
 *
 * @params serverCode `""` when the student never saved an answer.
 * @params serverSavedAt epoch milliseconds of the server's save; null when there is none.
 */
export function compareDraft(
	_draft: CodeDraft | null,
	_serverCode: string,
	_serverSavedAt: number | null,
): DraftComparison {
	throw new Error("not implemented");
}

/** Reads, writes and removes drafts; storage errors (quota, privacy mode) are swallowed. */
export interface DraftStore {
	/** The draft for `ref`, or null; an expired draft is removed and reads as null. */
	read(ref: DraftRef, now: number): CodeDraft | null;
	write(ref: DraftRef, draft: CodeDraft): void;
	remove(ref: DraftRef): void;
	/** Removes every draft of one exam for one user (on submit or close). */
	clearExam(ref: Omit<DraftRef, "question">): void;
	/** Removes the drafts of every user but `username`, and every expired draft. */
	clearOthers(username: string, now: number): void;
	/** Removes every key starting with `DRAFT_KEY_PREFIX`, for every user (logout). */
	clearAll(): void;
}

/** A `DraftStore` over `storage` (`window.localStorage` in the browser). */
export function draftStore(_storage: Storage): DraftStore {
	throw new Error("not implemented");
}
