import { expect, test } from "@playwright/test";
import {
	type CodeDraft,
	compareDraft,
	DRAFT_KEY_PREFIX,
	DRAFT_TTL_MS,
	type DraftRef,
	draftKey,
	draftStore,
} from "@/components/exam/code-draft";

/// An in-memory `Storage`; `fail` makes operations throw.
class FakeStorage implements Storage {
	data = new Map<string, string>();
	fail: { set?: Error; all?: Error } = {};
	get length() {
		if (this.fail.all) throw this.fail.all;
		return this.data.size;
	}
	key(i: number) {
		return [...this.data.keys()][i] ?? null;
	}
	getItem(k: string) {
		if (this.fail.all) throw this.fail.all;
		return this.data.get(k) ?? null;
	}
	setItem(k: string, v: string) {
		if (this.fail.set) throw this.fail.set;
		if (this.fail.all) throw this.fail.all;
		this.data.set(k, v);
	}
	removeItem(k: string) {
		if (this.fail.all) throw this.fail.all;
		this.data.delete(k);
	}
	clear() {
		this.data.clear();
	}
}

const REF: DraftRef = {
	username: "ada",
	course: "cs101/2026-1/turing",
	exam: "practice-js",
	question: "q1",
};
const NOW = 1_800_000_000_000;
const draft = (code: string, savedAt = NOW): CodeDraft => ({ code, savedAt });

test("draftKey URI-encodes each part so a colon in the username cannot collide", () => {
	const a = draftKey({ ...REF, username: "a:b", course: "c" });
	const b = draftKey({ ...REF, username: "a", course: "b:c" });
	expect(a).not.toBe(b);
	expect(a.startsWith(DRAFT_KEY_PREFIX)).toBe(true);
	expect(a).toContain("a%3Ab");
});

test("compareDraft: no draft, same code, and conflicts decided by the server clock", () => {
	expect(compareDraft(null, "x", 1)).toEqual({ kind: "none" });
	expect(compareDraft(draft("x"), "x", 1)).toEqual({ kind: "same" });
	expect(compareDraft(draft("", 5), "", null)).toEqual({ kind: "same" });
	expect(compareDraft(draft("a", 10), "b", 5)).toEqual({
		kind: "conflict",
		newer: "draft",
	});
	expect(compareDraft(draft("a", 5), "b", 10)).toEqual({
		kind: "conflict",
		newer: "server",
	});
	expect(compareDraft(draft("a", 5), "", null)).toEqual({
		kind: "conflict",
		newer: "draft",
	});
	expect(compareDraft(draft("", 5), "b", 3)).toEqual({
		kind: "conflict",
		newer: "draft",
	});
});

test("read returns what was written; an expired draft reads as null and is removed", () => {
	const storage = new FakeStorage();
	const store = draftStore(storage);
	store.write(REF, draft("code", NOW));
	expect(store.read(REF, NOW + DRAFT_TTL_MS)).toEqual(draft("code", NOW));
	expect(store.read(REF, NOW + DRAFT_TTL_MS + 1)).toBeNull();
	expect(storage.data.size).toBe(0);
});

test("clearOthers keeps the current user's drafts and drops other users' and expired ones", () => {
	const storage = new FakeStorage();
	const store = draftStore(storage);
	store.write(REF, draft("mine", NOW));
	store.write({ ...REF, question: "q2" }, draft("old", NOW - DRAFT_TTL_MS - 1));
	store.write({ ...REF, username: "bob" }, draft("his", NOW));
	store.write({ ...REF, username: "adam" }, draft("adam", NOW));
	storage.setItem("theme", "dark");

	store.clearOthers("ada", NOW);

	expect([...storage.data.keys()].sort()).toEqual(
		[draftKey(REF), "theme"].sort(),
	);
});

test("clearExam removes only the drafts of that exam and user", () => {
	const storage = new FakeStorage();
	const store = draftStore(storage);
	store.write(REF, draft("a"));
	store.write({ ...REF, question: "q2" }, draft("b"));
	store.write({ ...REF, exam: "other" }, draft("c"));
	store.write({ ...REF, username: "bob" }, draft("d"));

	store.clearExam({ username: "ada", course: REF.course, exam: REF.exam });

	expect(storage.data.size).toBe(2);
	expect(store.read({ ...REF, exam: "other" }, NOW)).not.toBeNull();
	expect(store.read({ ...REF, username: "bob" }, NOW)).not.toBeNull();
});

test("remove drops one draft", () => {
	const store = draftStore(new FakeStorage());
	store.write(REF, draft("a"));
	store.remove(REF);
	expect(store.read(REF, NOW)).toBeNull();
});

test("clearAll removes the draft keys of every user and keeps the rest", () => {
	const storage = new FakeStorage();
	const store = draftStore(storage);
	store.write(REF, draft("a"));
	store.write({ ...REF, username: "bob" }, draft("b"));
	storage.setItem("theme", "dark");

	store.clearAll();

	expect([...storage.data.keys()]).toEqual(["theme"]);
});

test("the store swallows quota errors and storage that throws on access", () => {
	const storage = new FakeStorage();
	const store = draftStore(storage);
	storage.fail.set = new DOMException("full", "QuotaExceededError");
	expect(() => store.write(REF, draft("a"))).not.toThrow();

	storage.fail = { all: new DOMException("denied", "SecurityError") };
	expect(store.read(REF, NOW)).toBeNull();
	expect(() => store.remove(REF)).not.toThrow();
	expect(() => store.clearAll()).not.toThrow();
	expect(() => store.clearOthers("ada", NOW)).not.toThrow();
	expect(() =>
		store.clearExam({ username: "ada", course: "c", exam: "e" }),
	).not.toThrow();
});
