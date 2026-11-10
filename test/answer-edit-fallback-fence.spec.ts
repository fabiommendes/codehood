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
