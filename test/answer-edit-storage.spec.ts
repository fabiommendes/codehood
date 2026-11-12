import { expect, test } from "@playwright/test";
import { AnswerEditMonitor } from "@/services/answer-edits/monitor";
import type { LocalEditRecord } from "@/services/answer-edits/storage";
import { bundleForBrowser, STORAGE_MODULE } from "./helpers/answer-edit-bundle";

/// Only the public browser module is bundled; the production server need not expose source files.
declare global {
	interface Window {
		answerEditStorage: typeof import("@/services/answer-edits/storage");
	}
}

const REF = { attemptId: "attempt", questionId: "question", field: "answer" };
const SAVED_AT = 1_000;
const EXPIRES_AT = 10_000;
const RECORD_BYTES = 2 * 1024 * 1024;

function record(text: string, generation = 1): LocalEditRecord {
	const monitor = new AnswerEditMonitor({
		initialText: "",
		sessionId: "storage-session",
		baseRevision: 0,
		firstSeq: 1,
		now: () => 0,
	});
	monitor.recordChange({
		atMs: 1,
		kind: "paste",
		replacements: [
			{ position: 0, deleteCount: 0, insertedText: text || "deleted" },
		],
	});
	const outbox = monitor.collect();
	if (text === "") {
		monitor.recordChange({
			atMs: 2,
			kind: "delete",
			replacements: [{ position: 0, deleteCount: 7, insertedText: "" }],
		});
	}
	return {
		version: 1,
		generation,
		savedAt: SAVED_AT,
		expiresAt: EXPIRES_AT,
		text,
		checkpoint: monitor.exportCheckpoint(),
		outbox,
	};
}

/// Measure opaque exported checkpoints, without depending on their internal JSON layout.
function sizedRecord(bytes: number, generation: number): LocalEditRecord {
	const snapshot = (text: string, savedAt: number): LocalEditRecord => {
		const monitor = new AnswerEditMonitor({
			initialText: text,
			sessionId: "size-session",
			baseRevision: 0,
			firstSeq: 1,
			now: () => 0,
		});
		return {
			version: 1,
			generation,
			savedAt,
			expiresAt: 1_000_000_000_000,
			text,
			checkpoint: monitor.exportCheckpoint(),
			outbox: null,
		};
	};
	const size = (value: LocalEditRecord) =>
		Buffer.byteLength(JSON.stringify(value), "utf8");
	const copies = size(snapshot("a", 1)) - size(snapshot("", 1));
	for (let savedAt = 1; savedAt <= 100_000_000; savedAt *= 10) {
		const remaining = bytes - size(snapshot("", savedAt));
		if (remaining % copies !== 0) continue;
		const textBytes = remaining / copies;
		const candidate = snapshot(
			"é".repeat(Math.floor(textBytes / 2)) + "a".repeat(textBytes % 2),
			savedAt,
		);
		if (size(candidate) === bytes) return candidate;
	}
	throw new Error(`Cannot construct a valid ${bytes}-byte record`);
}

let browserBundle: string;
test.beforeAll(async () => {
	browserBundle = await bundleForBrowser("answerEditStorage", [STORAGE_MODULE]);
});

test.beforeEach(async ({ page }) => {
	await page.goto("/");
	await page.addScriptTag({ content: browserBundle });
});

test("IndexedDB atomically roundtrips text, checkpoint and outbox; rejects stale CAS, corrupt records and aborted transactions", async ({
	page,
}) => {
	const initial = record("Olá 👩🏽‍💻\ne\u0301 العربية");
	const empty = record("", 2);
	const atLimit = sizedRecord(RECORD_BYTES, 1);
	const aboveLimit = sizedRecord(RECORD_BYTES + 1, 2);
	const result = await page.evaluate(
		async ({ ref, initial, empty, atLimit, aboveLimit }) => {
			const { openIndexedDbEditStore } = window.answerEditStorage;
			const options = {
				ownerId: "alice",
				indexedDB,
				databasePrefix: "storage-atomic",
			};
			const store = await openIndexedDbEditStore(options);
			const reopened = await openIndexedDbEditStore(options);
			await store.commit(ref, initial, null);
			const roundtrip = await reopened.read(ref, 1000);
			await reopened.commit(ref, empty, 1);
			const deleted = await store.read(ref, 1000);
			const failures: {
				label: string;
				rejected: boolean;
				preserved: LocalEditRecord | null;
			}[] = [];
			const attempt = async (
				label: string,
				candidate: LocalEditRecord,
				expected: number | null,
			) => {
				let rejected = false;
				try {
					await store.commit(ref, candidate, expected);
				} catch {
					rejected = true;
				}
				failures.push({
					label,
					rejected,
					preserved: await reopened.read(ref, 1000),
				});
			};
			await attempt("old generation", initial, 1);
			await attempt(
				"null requires absence",
				{ ...initial, generation: 1 },
				null,
			);
			await attempt(
				"generation must increment exactly",
				{ ...empty, generation: 4 },
				2,
			);
			for (const [label, patch] of [
				["unknown version", { version: 2 }],
				["unsafe generation", { generation: Number.MAX_SAFE_INTEGER + 1 }],
				["zero generation", { generation: 0 }],
				["fractional generation", { generation: 3.5 }],
				["nonfinite savedAt", { savedAt: Number.NaN }],
				["nonfinite expiresAt", { expiresAt: Number.POSITIVE_INFINITY }],
				["empty TTL", { expiresAt: empty.savedAt }],
				["negative TTL", { expiresAt: empty.savedAt - 1 }],
				["invalid checkpoint", { checkpoint: { version: 1, state: {} } }],
				[
					"unknown checkpoint version",
					{ checkpoint: { ...empty.checkpoint, version: 99 } },
				],
				["checkpoint text mismatch", { text: "not the checkpoint text" }],
				["missing inflight outbox", { outbox: null }],
				[
					"divergent outbox",
					{ outbox: { ...empty.outbox, snapshot: "wrong" } },
				],
			] as const) {
				await attempt(
					label,
					{ ...empty, generation: 3, ...patch } as LocalEditRecord,
					2,
				);
			}
			const limitRef = { ...ref, field: "byte-limit" };
			await store.commit(limitRef, atLimit, null);
			const atLimitRoundtrip = await reopened.read(limitRef, 1000);
			let aboveLimitRejected = false;
			try {
				await store.commit(limitRef, aboveLimit, 1);
			} catch {
				aboveLimitRejected = true;
			}
			const afterAboveLimit = await reopened.read(limitRef, 1000);

			/// Fault injection stays at the browser transaction boundary, using a real database.
			const originalTransaction = IDBDatabase.prototype.transaction;
			IDBDatabase.prototype.transaction = function (
				...args: Parameters<typeof originalTransaction>
			) {
				const transaction = originalTransaction.apply(this, args);
				if (args[1] === "readwrite") queueMicrotask(() => transaction.abort());
				return transaction;
			};
			let aborted = false;
			try {
				await store.commit(ref, { ...initial, generation: 3 }, 2);
			} catch {
				aborted = true;
			} finally {
				IDBDatabase.prototype.transaction = originalTransaction;
			}
			const afterAbort = await reopened.read(ref, 1000);
			await store.remove(ref);
			const removed = await reopened.read(ref, 1000);
			return {
				roundtrip,
				deleted,
				failures,
				atLimitRoundtrip,
				aboveLimitRejected,
				afterAboveLimit,
				aborted,
				afterAbort,
				removed,
			};
		},
		{ ref: REF, initial, empty, atLimit, aboveLimit },
	);

	expect(result.roundtrip).toEqual(initial);
	expect(result.deleted).toEqual(empty);
	for (const failure of result.failures) {
		expect(failure.rejected, failure.label).toBe(true);
		expect(
			failure.preserved,
			`${failure.label} preserves the whole previous record`,
		).toEqual(empty);
	}
	expect(result.atLimitRoundtrip).toEqual(atLimit);
	expect(result.aboveLimitRejected).toBe(true);
	expect(result.afterAboveLimit).toEqual(atLimit);
	expect(result.aborted).toBe(true);
	expect(result.afterAbort).toEqual(empty);
	expect(result.removed).toBeNull();
});

test("IndexedDB reads a record whose checkpoint is of the previous version, and a new record can replace it", async ({
	page,
}) => {
	const current = record("written after the upgrade", 2);
	const old = record("written before the upgrade", 1);
	const legacy = JSON.parse(JSON.stringify(old));
	legacy.checkpoint.version = 2;
	delete legacy.checkpoint.state.baseReason;
	delete legacy.checkpoint.state.inFlight.base;
	const result = await page.evaluate(
		async ({ ref, legacy, current }) => {
			const options = {
				ownerId: "alice",
				indexedDB,
				databasePrefix: "storage-legacy",
			};
			const store =
				await window.answerEditStorage.openIndexedDbEditStore(options);
			const name = JSON.stringify([options.databasePrefix, options.ownerId]);
			await new Promise<void>((resolve, reject) => {
				const open = indexedDB.open(name, 1);
				open.onerror = () => reject(open.error);
				open.onsuccess = () => {
					const database = open.result;
					const transaction = database.transaction("records", "readwrite");
					transaction
						.objectStore("records")
						.put(
							legacy,
							JSON.stringify([ref.attemptId, ref.questionId, ref.field]),
						);
					transaction.oncomplete = () => {
						database.close();
						resolve();
					};
					transaction.onerror = () => reject(transaction.error);
				};
			});
			const read = await store.read(ref, 1000);
			let replaced = true;
			try {
				await store.commit(ref, current, legacy.generation);
			} catch {
				replaced = false;
			}
			return { read, replaced, after: await store.read(ref, 1000) };
		},
		{ ref: REF, legacy, current },
	);

	expect(result.read?.text).toBe("written before the upgrade");
	expect(result.read?.generation).toBe(1);
	expect(result.replaced).toBe(true);
	expect(result.after).toEqual(current);
});

test("IndexedDB isolates owners and fields, expires only own rows, fences concurrent and delayed writes on revoke", async ({
	page,
}) => {
	const initial = record("first");
	const newer = record("newest", 2);
	const result = await page.evaluate(
		async ({ ref, initial, newer }) => {
			const open = (ownerId: string) =>
				window.answerEditStorage.openIndexedDbEditStore({
					ownerId,
					indexedDB,
					databasePrefix: "storage-lifecycle",
				});
			const alice = await open("alice");
			const oldTab = await open("alice");
			const bob = await open("bob");
			const variants = [
				{ ...ref, attemptId: "another-attempt" },
				{ ...ref, questionId: "another-question" },
				{ ...ref, field: "another-field" },
			];
			await alice.commit(ref, initial, null);
			const otherOwnerBeforeWrite = await bob.read(ref, 1000);
			await bob.commit(ref, initial, null);
			await alice.commit(ref, newer, 1);
			let staleRejected = false;
			try {
				await oldTab.commit(ref, { ...initial, generation: 2 }, 1);
			} catch {
				staleRejected = true;
			}
			const afterStale = await alice.read(ref, 1000);
			const raceRef = { ...ref, field: "concurrent-cas" };
			await alice.commit(raceRef, initial, null);
			const candidates = [newer, { ...initial, generation: 2 }];
			const race = await Promise.allSettled([
				alice.commit(raceRef, candidates[0] as LocalEditRecord, 1),
				oldTab.commit(raceRef, candidates[1] as LocalEditRecord, 1),
			]);
			const raceStatuses = race.map((outcome) => outcome.status).sort();
			const raceWinners = candidates.filter(
				(_, index) => race[index]?.status === "fulfilled",
			);
			const raceStored = await alice.read(raceRef, 1000);
			for (const variant of variants)
				await alice.commit(variant, { ...initial, expiresAt: 20000 }, null);
			const beforeExpiry = await alice.read(ref, 9999);
			const expired = await alice.read(ref, 10000);
			const expiredGone = await oldTab.read(ref, 1000);
			const otherOwnerNotPurged = await bob.read(ref, 1000);
			const variantsAfterExpiry = await Promise.all(
				variants.map((variant) => alice.read(variant, 10000)),
			);

			const events: string[] = [];
			const pending = alice.commit(ref, initial, null).then(
				() => events.push("write settled"),
				() => events.push("write settled"),
			);
			await alice.revoke();
			events.push("revoke resolved");
			await pending;
			const fresh = await open("alice");
			const afterRevoke = await fresh.read(ref, 1000);
			const variantsAfterRevoke = await Promise.all(
				variants.map((variant) => fresh.read(variant, 1000)),
			);
			/// A retained callback can run after logout without reviving the old namespace.
			let callbackRejected = false;
			const delayedCallback = () => alice.commit(ref, initial, null);
			try {
				await delayedCallback();
			} catch {
				callbackRejected = true;
			}
			const afterCallback = await fresh.read(ref, 1000);
			await alice.revoke();
			const otherOwnerAfterRevoke = await bob.read(ref, 1000);
			return {
				otherOwnerBeforeWrite,
				staleRejected,
				afterStale,
				raceStatuses,
				raceWinners,
				raceStored,
				beforeExpiry,
				expired,
				expiredGone,
				otherOwnerNotPurged,
				variantsAfterExpiry,
				events,
				afterRevoke,
				variantsAfterRevoke,
				callbackRejected,
				afterCallback,
				otherOwnerAfterRevoke,
			};
		},
		{ ref: REF, initial, newer },
	);

	expect(result.otherOwnerBeforeWrite).toBeNull();
	expect(result.staleRejected).toBe(true);
	expect(result.afterStale).toEqual(newer);
	expect(result.raceStatuses).toEqual(["fulfilled", "rejected"]);
	expect(result.raceWinners).toEqual([result.raceStored]);
	expect(result.beforeExpiry).toEqual(newer);
	expect(result.expired).toBeNull();
	expect(result.expiredGone).toBeNull();
	expect(result.otherOwnerNotPurged).toEqual(initial);
	expect(result.variantsAfterExpiry).toEqual(
		Array(3).fill({ ...initial, expiresAt: 20000 }),
	);
	expect(result.events).toEqual(["write settled", "revoke resolved"]);
	expect(result.afterRevoke).toBeNull();
	expect(result.variantsAfterRevoke).toEqual([null, null, null]);
	expect(result.callbackRejected).toBe(true);
	expect(result.afterCallback).toBeNull();
	expect(result.otherOwnerAfterRevoke).toEqual(initial);
});
