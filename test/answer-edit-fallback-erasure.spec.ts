import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { build } from "esbuild";
import {
	createTextRecoveryStore,
	type TextRecovery,
	type TextRecoveryStore,
} from "@/services/answer-edits/storage";

import { rig } from "./helpers/answer-edit-coordinator";

const REF = { attemptId: "attempt", questionId: "question", field: "answer" };
const REMOVE_REF = { ...REF, field: "remove-me" };
const PREFIX = "fallback-erasure";
const NOW = 1000;
const PRIVATE = "PRIVATE-REVOKED-GENERATION";
const FRESH = "CURRENT-SESSION-TEXT";
const BOB = "OTHER-OWNER-TEXT";
const INDEPENDENT = "OTHER-PREFIX-TEXT";

class InterleavedStorage implements Storage {
	readonly entries = new Map<string, string>();
	beforeWrite: ((key: string, value: string) => void) | null = null;
	beforeRemove: ((key: string) => void) | null = null;
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
		this.beforeRemove?.(key);
		this.entries.delete(key);
	}
	setItem(key: string, value: string) {
		this.beforeWrite?.(key, value);
		this.entries.set(key, value);
	}
	physicalText(text: string) {
		return [...this.entries].filter(([, value]) => value.includes(text));
	}
}

function injectedFixture() {
	const storage = new InterleavedStorage();
	const open = () =>
		createTextRecoveryStore({
			ownerId: "alice",
			storage,
			keyPrefix: PREFIX,
		});
	const draft = (text: string): TextRecovery => ({
		version: 1,
		savedAt: NOW,
		expiresAt: NOW + 10_000,
		text,
		historyGap: true,
	});
	return { storage, open, draft };
}

interface ErasureFixture {
	open(owner?: string, prefix?: string): TextRecoveryStore;
	old: TextRecoveryStore;
	peer: TextRecoveryStore;
	fresh: TextRecoveryStore | null;
	bob: TextRecoveryStore;
	independent: TextRecoveryStore;
	draft(text: string): TextRecovery;
	physicalText(text: string): [string, string][];
	orphanEntries: [string, string][];
	restoreOrphans(): void;
	intercepted: number;
	ready: Promise<void>;
}

declare global {
	interface Window {
		erasure: ErasureFixture;
	}
}

let browserBundle: string;
test.beforeAll(async () => {
	const bundle = await build({
		stdin: {
			contents: 'export * from "@/services/answer-edits/storage";',
			resolveDir: path.resolve("src"),
		},
		alias: { "@": path.resolve("src") },
		bundle: true,
		write: false,
		platform: "browser",
		format: "iife",
		globalName: "answerEditStorage",
		logLevel: "silent",
	});
	browserBundle = bundle.outputFiles[0]?.text ?? "";
});

async function install(page: Page) {
	await page.goto("/");
	await page.addScriptTag({ content: browserBundle });
	await page.evaluate(
		({ prefix, now }) => {
			const open = (ownerId = "alice", keyPrefix = prefix) =>
				window.answerEditStorage.createTextRecoveryStore({
					ownerId,
					storage: localStorage,
					keyPrefix,
				});
			window.erasure = {
				open,
				old: open(),
				peer: open(),
				fresh: null,
				bob: open("bob"),
				independent: open("alice", `${prefix}-independent`),
				draft: (text) => ({
					version: 1,
					savedAt: now,
					expiresAt: now + 10_000,
					text,
					historyGap: true,
				}),
				physicalText: (text) =>
					Object.entries(localStorage).filter(([, value]) =>
						value.includes(text),
					),
				orphanEntries: [],
				restoreOrphans() {
					for (const [key, value] of this.orphanEntries)
						localStorage.setItem(key, value);
				},
				intercepted: 0,
				ready: Promise.resolve(),
			};
		},
		{ prefix: PREFIX, now: NOW },
	);
}

async function assertCleanAndPreserved(page: Page) {
	const result = await page.evaluate(
		({ ref, now, privateText }) => {
			const fixture = window.erasure;
			/// Inspect physical erasure before reads can themselves reconcile the store.
			const privateEntries = fixture.physicalText(privateText);
			return {
				privateEntries,
				fresh: fixture.fresh?.read(ref, now)?.text,
				bob: fixture.bob.read(ref, now)?.text,
				independent: fixture.independent.read(ref, now)?.text,
			};
		},
		{ ref: REF, now: NOW, privateText: PRIVATE },
	);
	expect
		.soft(
			result.privateEntries,
			"revoked text is physically absent from localStorage",
		)
		.toEqual([]);
	expect
		.soft(result.fresh, "the current generation survives cleanup")
		.toBe(FRESH);
	expect.soft(result.bob, "another owner survives cleanup").toBe(BOB);
	expect
		.soft(result.independent, "another prefix survives cleanup")
		.toBe(INDEPENDENT);
}

for (const operation of ["write", "remove", "expiry"] as const) {
	test(`fallback ${operation} compensates a physical write interleaved with revoke`, async ({
		page,
	}) => {
		await install(page);
		const outcome = await page.evaluate(
			({
				operation,
				ref,
				removeRef,
				privateText,
				freshText,
				bob,
				independent,
				now,
			}) => {
				const fixture = window.erasure;
				fixture.old.write(ref, fixture.draft(privateText));
				fixture.old.write(removeRef, {
					...fixture.draft("delete this field"),
					expiresAt: now + 1,
				});
				fixture.bob.write(ref, fixture.draft(bob));
				fixture.independent.write(ref, fixture.draft(independent));
				const nativeSet = Storage.prototype.setItem;
				Storage.prototype.setItem = function (key, value) {
					if (this === localStorage && value.includes(privateText)) {
						Storage.prototype.setItem = nativeSet;
						fixture.intercepted++;
						fixture.peer.revoke();
						fixture.fresh = fixture.open();
						fixture.fresh.write(ref, fixture.draft(freshText));
					}
					nativeSet.call(this, key, value);
				};
				try {
					if (operation === "write")
						fixture.old.write(ref, fixture.draft(`${privateText}-late`));
					else if (operation === "remove") fixture.old.remove(removeRef);
					else fixture.old.read(removeRef, now + 1);
				} catch {
					/// Rejecting the interrupted operation is allowed, retaining its text is not.
				} finally {
					Storage.prototype.setItem = nativeSet;
				}
				return fixture.intercepted;
			},
			{
				operation,
				ref: REF,
				removeRef: REMOVE_REF,
				privateText: PRIVATE,
				freshText: FRESH,
				bob: BOB,
				independent: INDEPENDENT,
				now: NOW,
			},
		);
		expect(
			outcome,
			"the writer crossed the final native setItem boundary after revoke",
		).toBe(1);
		await assertCleanAndPreserved(page);
	});
}

test("a real second page revokes a writer suspended at native setItem and resumed text is physically erased", async ({
	page,
	context,
}) => {
	await install(page);
	const remote = await context.newPage();
	await install(remote);
	/// Synchronize initial storage population before arming the race, not after logout.
	await remote.evaluate(() => {
		window.erasure.ready = new Promise<void>((resolve) => {
			const observe = (event: StorageEvent) => {
				if (event.key !== "erasure-fixture-ready") return;
				removeEventListener("storage", observe);
				resolve();
			};
			addEventListener("storage", observe);
		});
	});
	await page.evaluate(
		({ ref, privateText }) => {
			window.erasure.old.write(ref, window.erasure.draft(privateText));
			localStorage.setItem("erasure-fixture-ready", "ready");
		},
		{ ref: REF, privateText: PRIVATE },
	);
	await remote.evaluate(() => window.erasure.ready);

	const cdp = await context.newCDPSession(page);
	await cdp.send("Debugger.enable");
	await page.evaluate((privateText) => {
		const nativeSet = Storage.prototype.setItem;
		Storage.prototype.setItem = function (key, value) {
			if (this === localStorage && value.includes(privateText)) {
				Storage.prototype.setItem = nativeSet;
				window.erasure.intercepted++;
				// biome-ignore lint/suspicious/noDebugger: CDP deterministically suspends the real writer until the other page revokes it.
				debugger;
			}
			nativeSet.call(this, key, value);
		};
	}, PRIVATE);
	const paused = new Promise<void>((resolve) =>
		cdp.once("Debugger.paused", () => resolve()),
	);
	const writer = page.evaluate(
		({ ref, privateText }) => {
			try {
				window.erasure.old.write(
					ref,
					window.erasure.draft(`${privateText}-late`),
				);
			} catch {
				/// Revocation may reject the resumed operation.
			}
			return window.erasure.intercepted;
		},
		{ ref: REF, privateText: PRIVATE },
	);
	try {
		await paused;
		await remote.evaluate(
			({ ref, freshText, bob, independent }) => {
				const fixture = window.erasure;
				fixture.peer.revoke();
				fixture.fresh = fixture.open();
				fixture.fresh.write(ref, fixture.draft(freshText));
				fixture.bob.write(ref, fixture.draft(bob));
				fixture.independent.write(ref, fixture.draft(independent));
			},
			{ ref: REF, freshText: FRESH, bob: BOB, independent: INDEPENDENT },
		);
	} finally {
		await cdp.send("Debugger.resume");
	}
	expect(await writer, "the first page really paused at the late write").toBe(
		1,
	);
	await cdp.detach();
	/// Read the writer's own Storage cache immediately after it resumes.
	expect
		.soft(
			await page.evaluate((text) => window.erasure.physicalText(text), PRIVATE),
		)
		.toEqual([]);
	/// Repeating an old revoke from the other page must also preserve its current session.
	await remote.evaluate(() => {
		window.erasure.peer.revoke();
		window.erasure.peer.revoke();
	});
	await assertCleanAndPreserved(remote);
});

test("concurrent fallback token rotations never physically erase the fresh peer session", () => {
	const { storage, open, draft } = injectedFixture();
	const first = open();
	const peer = open();
	first.write(REF, draft(PRIVATE));
	let interrupted = false;
	let freshBeforeResume: [string, string][] = [];
	storage.beforeWrite = (key, value) => {
		/// Revoke rotates the existing token, not a record containing answer text.
		const previous = storage.getItem(key);
		if (previous === null || previous === value || previous.includes(PRIVATE))
			return;
		storage.beforeWrite = null;
		interrupted = true;
		peer.revoke();
		const fresh = open();
		fresh.write(REF, draft(FRESH));
		freshBeforeResume = storage.physicalText(FRESH);
	};
	try {
		first.revoke();
	} finally {
		storage.beforeWrite = null;
	}
	expect(
		interrupted,
		"A paused before its token write while B rotated the same token",
	).toBe(true);
	expect(
		freshBeforeResume,
		"B persisted fresh text before A resumed",
	).toHaveLength(1);
	/// A fresh read could reconcile and erase evidence, so inspect Storage directly.
	expect(
		storage.physicalText(FRESH),
		"A must not physically erase B's fresh generation",
	).toEqual(freshBeforeResume);
});

test("fallback operations never enumerate or clear origin Storage", () => {
	const { storage, open, draft } = injectedFixture();
	const forbidden: string[] = [];
	const deny = (operation: string): never => {
		forbidden.push(operation);
		throw new Error(`Origin-wide Storage ${operation} is forbidden`);
	};
	Object.defineProperty(storage, "length", { get: () => deny("length") });
	storage.key = () => deny("key");
	storage.clear = () => deny("clear");
	storage.setItem("unrelated-origin-key", "unrelated-origin-value");
	const old = open();
	const peer = open();
	old.write(REF, draft(PRIVATE));
	expect(old.read(REF, NOW)?.text).toBe(PRIVATE);
	old.write(REMOVE_REF, { ...draft("expired"), expiresAt: NOW + 1 });
	expect(old.read(REMOVE_REF, NOW + 1)).toBeNull();
	old.write(REMOVE_REF, draft("removed"));
	old.remove(REMOVE_REF);
	expect(old.read(REMOVE_REF, NOW)).toBeNull();
	const orphanEntries = storage.physicalText(PRIVATE);
	storage.beforeWrite = (_key, value) => {
		if (!value.includes(PRIVATE)) return;
		storage.beforeWrite = null;
		peer.revoke();
	};
	try {
		old.write(REF, draft(`${PRIVATE}-late`));
	} catch {
		/// Revocation may reject the stale write, but must still compensate it.
	} finally {
		storage.beforeWrite = null;
	}
	expect(storage.physicalText(PRIVATE)).toEqual([]);
	/// A writer killed before compensating leaves text no new session can read.
	for (const [key, value] of orphanEntries) storage.setItem(key, value);
	const fresh = open();
	expect(fresh.read(REF, NOW)).toBeNull();
	fresh.write(REF, draft(FRESH));
	old.revoke();
	old.revoke();
	expect(storage.physicalText(PRIVATE)).toEqual([]);
	expect(fresh.read(REF, NOW)?.text).toBe(FRESH);
	expect(storage.getItem("unrelated-origin-key")).toBe(
		"unrelated-origin-value",
	);
	expect(
		forbidden,
		"even swallowed enumeration errors must be detected",
	).toEqual([]);
});

test("repeating a rejected coordinator logout retries fallback cleanup", async () => {
	const h = rig();
	const failure = new DOMException("Cleanup denied", "SecurityError");
	let cleanupCalls = 0;
	h.fallback.revoke = () => {
		cleanupCalls++;
		if (cleanupCalls === 1) throw failure;
	};
	await expect(h.coordinator.logout()).rejects.toBe(failure);
	await h.coordinator.logout();
	expect(cleanupCalls).toBe(2);
	await h.coordinator.dispose();
});

test("fallback post-write compensation propagates removal failure and retries physical erasure", () => {
	const { storage, open, draft } = injectedFixture();
	const old = open();
	const peer = open();
	old.write(REF, draft(PRIVATE));
	const failure = new DOMException(
		"Compensation temporarily denied",
		"SecurityError",
	);
	let interrupted = false;
	let denied = 0;
	storage.beforeWrite = (_key, value) => {
		if (!value.includes(PRIVATE)) return;
		storage.beforeWrite = null;
		interrupted = true;
		peer.revoke();
		/// Only deny removal after revoke has completed and the stale write resumes.
		storage.beforeRemove = (key) => {
			if (!storage.getItem(key)?.includes(PRIVATE)) return;
			denied++;
			throw failure;
		};
	};
	let caught: unknown;
	try {
		old.write(REF, draft(`${PRIVATE}-late`));
	} catch (error) {
		caught = error;
	} finally {
		storage.beforeWrite = null;
		storage.beforeRemove = null;
	}
	expect(interrupted).toBe(true);
	expect(
		denied,
		"post-write compensation attempted physical removal",
	).toBeGreaterThan(0);
	expect
		.soft(caught, "the injected Storage error must reach the caller")
		.toBe(failure);
	expect(
		storage.physicalText(PRIVATE),
		"failed compensation left a real persisted draft",
	).toHaveLength(1);
	old.revoke();
	old.revoke();
	expect(
		storage.physicalText(PRIVATE),
		"retry after Storage recovery erases the stale draft",
	).toEqual([]);
});
