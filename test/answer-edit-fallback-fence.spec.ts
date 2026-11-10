import { expect, test } from "@playwright/test";
import {
	createTextRecoveryStore,
	type TextRecovery,
} from "@/services/answer-edits/storage";
import { EPOCH, REF } from "./helpers/answer-edit-coordinator";

class HookedStorage implements Storage {
	private readonly entries = new Map<string, string>();
	beforeNextWrite: (() => void) | null = null;
	get length() {
		return this.entries.size;
	}
	clear() {
		this.entries.clear();
	}
	getItem(key: string) {
		return this.entries.get(key) ?? null;
	}
	key(index: number) {
		return [...this.entries.keys()][index] ?? null;
	}
	removeItem(key: string) {
		this.entries.delete(key);
	}
	setItem(key: string, value: string) {
		const hook = this.beforeNextWrite;
		this.beforeNextWrite = null;
		hook?.();
		this.entries.set(key, value);
	}
}

test("a fallback write interrupted by peer logout cannot resurrect old text or erase a fresh draft", () => {
	const storage = new HookedStorage();
	const open = () =>
		createTextRecoveryStore({
			ownerId: "owner",
			storage,
			keyPrefix: "fallback-fence",
		});
	const old = open();
	const peer = open();
	const oldDraft: TextRecovery = {
		version: 1,
		savedAt: EPOCH,
		expiresAt: EPOCH + 60_000,
		text: "private old-session draft",
		historyGap: true,
	};
	let revokedBeforeWrite = false;
	storage.beforeNextWrite = () => {
		peer.revoke();
		revokedBeforeWrite = true;
	};
	// A fenced writer may reject or finish writing an inaccessible old record.
	try {
		old.write(REF, oldDraft);
	} catch {
		// Revocation is allowed to reject an in-progress write.
	}
	expect(revokedBeforeWrite).toBe(true);
	const fresh = open();
	expect.soft(fresh.read(REF, EPOCH)).toBeNull();
	const freshDraft = { ...oldDraft, text: "fresh-session draft" };
	fresh.write(REF, freshDraft);
	old.revoke();
	peer.revoke();
	old.revoke();
	expect(fresh.read(REF, EPOCH)).toEqual(freshDraft);
});

test("a handle opened before a revoke is fenced while fresh handles and other owners keep working", () => {
	const storage = new HookedStorage();
	const open = (ownerId: string) =>
		createTextRecoveryStore({ ownerId, storage, keyPrefix: "fallback-fence" });
	const draft = (text: string): TextRecovery => ({
		version: 1,
		savedAt: EPOCH,
		expiresAt: EPOCH + 60_000,
		text,
		historyGap: true,
	});
	const old = open("owner");
	const peer = open("owner");
	const other = open("other");
	old.write(REF, draft("old text"));
	other.write(REF, draft("other text"));
	peer.revoke();
	expect(() => old.read(REF, EPOCH)).toThrow();
	expect(() => old.write(REF, draft("late"))).toThrow();
	expect(() => old.remove(REF)).toThrow();
	const fresh = open("owner");
	expect(fresh.read(REF, EPOCH)).toBeNull();
	fresh.write(REF, draft("fresh text"));
	expect(fresh.read(REF, EPOCH)?.text).toBe("fresh text");
	expect(other.read(REF, EPOCH)?.text).toBe("other text");
});
