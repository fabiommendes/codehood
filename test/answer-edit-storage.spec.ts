import path from "node:path";
import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { AnswerEditMonitor } from "@/services/answer-edits/monitor";
import type {
	LocalEditRecord,
	TextRecovery,
} from "@/services/answer-edits/storage";

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

function recovery(text: string): TextRecovery {
	return {
		version: 1,
		savedAt: SAVED_AT,
		expiresAt: EXPIRES_AT,
		text,
		historyGap: true,
	};
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
					{ checkpoint: { ...empty.checkpoint, version: 2 } },
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

test("localStorage recovers empty and nonempty text with a gap, never history; isolates TTL and revoke and exposes storage failures", async ({
	page,
}) => {
	const initial = recovery("rascunho 👩🏽‍💻");
	const empty = recovery("");
	const result = await page.evaluate(
		({ ref, initial, empty, maxBytes }) => {
			const { createTextRecoveryStore } = window.answerEditStorage;
			const options = {
				ownerId: "alice",
				storage: localStorage,
				keyPrefix: "storage-fallback",
			};
			const alice = createTextRecoveryStore(options);
			const reopened = createTextRecoveryStore(options);
			const bob = createTextRecoveryStore({ ...options, ownerId: "bob" });
			const secret = "HISTORY_MUST_NOT_BE_PERSISTED";
			const boundedRef = { ...ref, field: "byte-limit" };
			const overhead = new TextEncoder().encode(
				JSON.stringify(empty),
			).byteLength;
			const textBytes = maxBytes - overhead;
			const bounded = {
				...empty,
				text: "é".repeat(Math.floor(textBytes / 2)) + "a".repeat(textBytes % 2),
			};
			alice.write(boundedRef, bounded);
			const atLimitRecovered = reopened.read(boundedRef, 1000);
			let aboveLimitRejected = false;
			try {
				alice.write(boundedRef, { ...bounded, text: `${bounded.text}a` });
			} catch {
				aboveLimitRejected = true;
			}
			const afterLimitFailure = reopened.read(boundedRef, 1000);
			const limitPreserved =
				afterLimitFailure?.text === bounded.text &&
				afterLimitFailure.version === 1 &&
				afterLimitFailure.historyGap === true &&
				afterLimitFailure.savedAt === bounded.savedAt &&
				afterLimitFailure.expiresAt === bounded.expiresAt;
			alice.write(ref, {
				...initial,
				checkpoint: { secret },
				outbox: { secret },
				history: [secret],
			} as TextRecovery);
			const roundtrip = reopened.read(ref, 1000);
			const storedHistory = Object.keys(localStorage)
				.filter((key) => key.startsWith(options.keyPrefix))
				.some((key) => localStorage.getItem(key)?.includes(secret));
			const otherOwnerBeforeWrite = bob.read(ref, 1000);
			bob.write(ref, initial);
			alice.write(ref, empty);
			const deleted = reopened.read(ref, 1000);
			const failures: {
				label: string;
				rejected: boolean;
				preserved: TextRecovery | null;
			}[] = [];
			for (const [label, patch] of [
				["unknown version", { version: 2 }],
				["missing gap", { historyGap: false }],
				["nonfinite savedAt", { savedAt: Number.NaN }],
				["nonfinite expiresAt", { expiresAt: Number.POSITIVE_INFINITY }],
				["invalid TTL", { expiresAt: empty.savedAt }],
				["UTF-8 limit", { text: "é".repeat(maxBytes / 2 + 1) }],
			] as const) {
				let rejected = false;
				try {
					alice.write(ref, { ...empty, ...patch } as TextRecovery);
				} catch {
					rejected = true;
				}
				failures.push({
					label,
					rejected,
					preserved: reopened.read(ref, 1000),
				});
			}
			const originalSetItem = Storage.prototype.setItem;
			let quotaRejected = false;
			Storage.prototype.setItem = () => {
				throw new DOMException("quota exhausted", "QuotaExceededError");
			};
			try {
				alice.write(ref, initial);
			} catch {
				quotaRejected = true;
			} finally {
				Storage.prototype.setItem = originalSetItem;
			}
			const afterQuota = reopened.read(ref, 1000);
			const originalGetItem = Storage.prototype.getItem;
			let readRejected = false;
			Storage.prototype.getItem = () => {
				throw new DOMException("denied", "SecurityError");
			};
			try {
				alice.read(ref, 1000);
			} catch {
				readRejected = true;
			} finally {
				Storage.prototype.getItem = originalGetItem;
			}
			const beforeExpiry = alice.read(ref, 9999);
			const expired = alice.read(ref, 10000);
			const expiredGone = reopened.read(ref, 1000);
			const otherOwnerNotPurged = bob.read(ref, 1000);
			alice.write(ref, initial);
			const otherField = { ...ref, field: "other" };
			alice.write(otherField, empty);
			alice.revoke();
			const fresh = createTextRecoveryStore(options);
			const afterRevoke = [fresh.read(ref, 1000), fresh.read(otherField, 1000)];
			let callbackRejected = false;
			try {
				alice.write(ref, initial);
			} catch {
				callbackRejected = true;
			}
			const afterCallback = fresh.read(ref, 1000);
			alice.revoke();
			const otherOwnerAfterRevoke = bob.read(ref, 1000);
			bob.remove(ref);
			const removed = bob.read(ref, 1000);
			return {
				atLimitRecoveredBytes: new TextEncoder().encode(
					JSON.stringify(atLimitRecovered),
				).byteLength,
				aboveLimitRejected,
				limitPreserved,
				roundtrip,
				storedHistory,
				otherOwnerBeforeWrite,
				deleted,
				failures,
				quotaRejected,
				afterQuota,
				readRejected,
				beforeExpiry,
				expired,
				expiredGone,
				otherOwnerNotPurged,
				afterRevoke,
				callbackRejected,
				afterCallback,
				otherOwnerAfterRevoke,
				removed,
			};
		},
		{ ref: REF, initial, empty, maxBytes: RECORD_BYTES },
	);

	expect(result.roundtrip).toEqual(initial);
	expect(result.atLimitRecoveredBytes).toBe(RECORD_BYTES);
	expect(result.aboveLimitRejected).toBe(true);
	expect(result.limitPreserved).toBe(true);
	expect(result.storedHistory).toBe(false);
	expect(result.otherOwnerBeforeWrite).toBeNull();
	expect(result.deleted).toEqual(empty);
	for (const failure of result.failures) {
		expect(failure.rejected, failure.label).toBe(true);
		expect(failure.preserved, failure.label).toEqual(empty);
	}
	expect(result.quotaRejected).toBe(true);
	expect(result.afterQuota).toEqual(empty);
	expect(result.readRejected).toBe(true);
	expect(result.beforeExpiry).toEqual(empty);
	expect(result.expired).toBeNull();
	expect(result.expiredGone).toBeNull();
	expect(result.otherOwnerNotPurged).toEqual(initial);
	expect(result.afterRevoke).toEqual([null, null]);
	expect(result.callbackRejected).toBe(true);
	expect(result.afterCallback).toBeNull();
	expect(result.otherOwnerAfterRevoke).toEqual(initial);
	expect(result.removed).toBeNull();
});
