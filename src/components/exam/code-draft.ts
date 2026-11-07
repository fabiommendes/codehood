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
export function draftKey(ref: DraftRef): string {
	const parts = [ref.username, ref.course, ref.exam, ref.question];
	return DRAFT_KEY_PREFIX + parts.map(encodeURIComponent).join(":");
}

/**
 * Compares a draft with the server's answer.
 *
 * @params serverCode `""` when the student never saved an answer.
 * @params serverSavedAt epoch milliseconds of the server's save; null when there is none.
 */
export function compareDraft(
	draft: CodeDraft | null,
	serverCode: string,
	serverSavedAt: number | null,
): DraftComparison {
	if (draft === null) return { kind: "none" };
	if (draft.code === serverCode) return { kind: "same" };
	if (serverSavedAt === null && serverCode === "" && draft.code.trim() === "") {
		return { kind: "same" };
	}
	const draftIsNewer = serverSavedAt === null || draft.savedAt > serverSavedAt;
	return { kind: "conflict", newer: draftIsNewer ? "draft" : "server" };
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
	/** Whether any draft is stored: one the server has not confirmed, since confirmed drafts are removed. */
	hasAny(): boolean;
}

/** A `DraftStore` over `storage` (`window.localStorage` in the browser). */
export function draftStore(storage: Storage): DraftStore {
	/// Runs `action`, returning `fallback` if the storage throws.
	function safely<T>(action: () => T, fallback: T): T {
		try {
			return action();
		} catch {
			return fallback;
		}
	}

	/// Every storage key that belongs to this module.
	function ownKeys(): string[] {
		const keys: string[] = [];
		for (let i = 0; i < storage.length; i++) {
			const key = storage.key(i);
			if (key?.startsWith(DRAFT_KEY_PREFIX)) keys.push(key);
		}
		return keys;
	}

	/// The draft stored under `key`, or null when absent or malformed.
	function parse(key: string): CodeDraft | null {
		const raw = storage.getItem(key);
		if (raw === null) return null;
		try {
			const value: unknown = JSON.parse(raw);
			if (
				typeof value === "object" &&
				value !== null &&
				"code" in value &&
				"savedAt" in value &&
				typeof value.code === "string" &&
				typeof value.savedAt === "number"
			) {
				return { code: value.code, savedAt: value.savedAt };
			}
		} catch {}
		return null;
	}

	const isExpired = (draft: CodeDraft, now: number) =>
		now - draft.savedAt > DRAFT_TTL_MS;

	/// Removes the own keys for which `doomed(key, draft)` holds.
	function removeWhere(
		doomed: (key: string, draft: CodeDraft | null) => boolean,
	): void {
		safely(() => {
			for (const key of ownKeys()) {
				if (doomed(key, parse(key))) storage.removeItem(key);
			}
		}, undefined);
	}

	return {
		read(ref, now) {
			return safely(() => {
				const key = draftKey(ref);
				const draft = parse(key);
				if (draft === null || isExpired(draft, now)) {
					storage.removeItem(key);
					return null;
				}
				return draft;
			}, null);
		},
		write(ref, draft) {
			safely(
				() => storage.setItem(draftKey(ref), JSON.stringify(draft)),
				undefined,
			);
		},
		remove(ref) {
			safely(() => storage.removeItem(draftKey(ref)), undefined);
		},
		clearExam(ref) {
			const prefix = draftKey({ ...ref, question: "" });
			removeWhere((key) => key.startsWith(prefix));
		},
		clearOthers(username, now) {
			const own = `${DRAFT_KEY_PREFIX}${encodeURIComponent(username)}:`;
			removeWhere(
				(key, draft) =>
					!key.startsWith(own) || draft === null || isExpired(draft, now),
			);
		},
		clearAll() {
			removeWhere(() => true);
		},
		hasAny() {
			return safely(() => ownKeys().some((key) => parse(key) !== null), false);
		},
	};
}

/// A store that holds nothing, for browsers that block `localStorage`.
const NO_DRAFTS: DraftStore = {
	read: () => null,
	write: () => {},
	remove: () => {},
	clearExam: () => {},
	clearOthers: () => {},
	clearAll: () => {},
	hasAny: () => false,
};

/**
 * A `DraftStore` over `window.localStorage`, or one that keeps nothing when
 * the browser blocks the access (the autosave then stands alone).
 */
export function browserDraftStore(): DraftStore {
	try {
		return draftStore(window.localStorage);
	} catch {
		return NO_DRAFTS;
	}
}

/**
 * The offset `serverNow - clientNow` implied by a request: the server stamped
 * `serverMs` somewhere between `sentMs` and `receivedMs` on the client's
 * clock, so the midpoint is the best guess, off by at most half the round trip.
 */
export function measureClockOffset(
	serverMs: number,
	sentMs: number,
	receivedMs: number,
): number {
	return serverMs - (sentMs + receivedMs) / 2;
}
