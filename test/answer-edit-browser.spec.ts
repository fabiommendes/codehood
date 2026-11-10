import { expect, test } from "@playwright/test";
import { replayEdits } from "@/services/answer-edits/codec";
import type {
	AnswerEditCoordinator,
	AttemptTransport,
} from "@/services/answer-edits/coordinator";
import type { AnswerEditMonitor } from "@/services/answer-edits/monitor";
import {
	type EditStore,
	MAX_LOCAL_RECORD_BYTES,
} from "@/services/answer-edits/storage";
import { bundleForBrowser, STORAGE_MODULE } from "./helpers/answer-edit-bundle";

declare global {
	interface Window {
		retentionBrowser: typeof import("@/services/answer-edits/monitor") &
			typeof import("@/services/answer-edits/coordinator") &
			typeof import("@/services/answer-edits/storage") &
			Pick<
				typeof import("./helpers/answer-edit-coordinator"),
				"ManualScheduler"
			>;
		retentionLive: {
			coordinator: AnswerEditCoordinator;
			monitor: AnswerEditMonitor;
			store: EditStore;
			requests: Parameters<AttemptTransport["send"]>[0][];
			aborts: number;
			restoreTransactions: () => void;
		};
	}
}

const EPOCH = 1_800_000_000_000;
const REF = { attemptId: "attempt", questionId: "question", field: "answer" };
let browserBundle: string;

test.beforeAll(async () => {
	browserBundle = await bundleForBrowser("retentionBrowser", [
		'export * from "@/services/answer-edits/monitor";',
		'export * from "@/services/answer-edits/coordinator";',
		STORAGE_MODULE,
		'export { ManualScheduler } from "./test/helpers/answer-edit-coordinator";',
	]);
});

/// Use real browser stores and inject only transport, clocks and scheduling.
async function startSession(mode: "accepted" | "abort-ack" | "lost-ack") {
	const api = window.retentionBrowser;
	const epoch = 1_800_000_000_000;
	const field = { questionId: "question", field: "answer" };
	const store = await api.openIndexedDbEditStore({
		ownerId: "retention-owner",
		indexedDB,
		databasePrefix: "retention-browser",
	});
	const fallback = api.createTextRecoveryStore({
		ownerId: "retention-owner",
		storage: localStorage,
		keyPrefix: "retention-browser",
	});
	const requests: Parameters<AttemptTransport["send"]>[0][] = [];
	const originalTransaction = IDBDatabase.prototype.transaction;
	const coordinator = new api.AnswerEditCoordinator({
		ownerId: "retention-owner",
		attemptId: "attempt",
		store,
		fallback,
		scheduler: new api.ManualScheduler(),
		now: () => epoch,
		monotonicNow: () => 900_000,
		random: () => 0.5,
		createSessionId: () => "recovered-session",
		transport: {
			inspect: async () => ({
				text: "",
				revision: 0,
				nextSeq: 1,
				canWrite: true,
				receipts: [],
			}),
			send: async (request) => {
				requests.push(structuredClone(request));
				if (mode === "lost-ack") throw new Error("No acknowledgement received");
				if (mode === "abort-ack") {
					IDBDatabase.prototype.transaction = function (
						...args: Parameters<typeof originalTransaction>
					) {
						const transaction = originalTransaction.apply(this, args);
						if (args[1] === "readwrite") {
							window.retentionLive.aborts++;
							queueMicrotask(() => transaction.abort());
						}
						return transaction;
					};
				}
				return request.fields.map(({ questionId, field, batch }) => ({
					questionId,
					field,
					kind: "accepted" as const,
					receipt: {
						batchId: batch.batchId,
						revision: batch.baseRevision + 1,
						lastSeq: batch.firstSeq + batch.edits.length - 1,
					},
				}));
			},
		},
	});
	const monitor = new api.AnswerEditMonitor({
		initialText: "",
		sessionId: "browser-original",
		baseRevision: 0,
		firstSeq: 1,
		now: () => 900_000,
	});
	window.retentionLive = {
		coordinator,
		monitor,
		store,
		requests,
		aborts: 0,
		restoreTransactions: () => {
			IDBDatabase.prototype.transaction = originalTransaction;
		},
	};
	await coordinator.register(field, monitor);
	monitor.recordChange({
		atMs: 900_010,
		kind: "paste",
		replacements: [{ position: 0, deleteCount: 0, insertedText: "á🙂 محفوظ" }],
	});
	await coordinator.flush();
}

test.beforeEach(async ({ page }) => {
	await page.goto("/");
	await page.addScriptTag({ content: browserBundle });
});

test("browser ACK removes the durable outbox and stays removed after a new page", async ({
	page,
	context,
}) => {
	await page.evaluate<void, Parameters<typeof startSession>[0]>(
		startSession,
		"accepted",
	);
	const saved = await page.evaluate(
		async ({ ref, now }) => {
			const live = window.retentionLive;
			return {
				record: await live.store.read(ref, now),
				state: live.monitor.getState(),
				sent: live.requests.length,
			};
		},
		{ ref: REF, now: EPOCH },
	);
	expect(saved.sent).toBe(1);
	expect(saved.state.hasUnacknowledgedBatch).toBe(false);
	expect(saved.record).toMatchObject({ text: "á🙂 محفوظ", outbox: null });
	await page.close({ runBeforeUnload: false });
	const reopened = await context.newPage();
	await reopened.goto("/");
	await reopened.addScriptTag({ content: browserBundle });
	const durable = await reopened.evaluate(
		async ({ ref, now }) => {
			const store = await window.retentionBrowser.openIndexedDbEditStore({
				ownerId: "retention-owner",
				indexedDB,
				databasePrefix: "retention-browser",
			});
			return store.read(ref, now);
		},
		{ ref: REF, now: EPOCH + 101 },
	);
	expect(durable).toEqual(saved.record);
});

test("aborted browser ACK commit preserves the durable batch without claiming durability", async ({
	page,
}) => {
	await page.evaluate<void, Parameters<typeof startSession>[0]>(
		startSession,
		"abort-ack",
	);
	const result = await page.evaluate(
		async ({ ref, now }) => {
			const live = window.retentionLive;
			live.restoreTransactions();
			return {
				aborts: live.aborts,
				state: live.monitor.getState(),
				status: live.coordinator.getStatus({
					questionId: ref.questionId,
					field: ref.field,
				}),
				record: await live.store.read(ref, now),
				sent: live.requests[0]?.fields[0]?.batch,
			};
		},
		{ ref: REF, now: EPOCH },
	);
	expect(result.aborts).toBeGreaterThan(0);
	expect(result.state.hasUnacknowledgedBatch).toBe(false);
	expect(result.record?.outbox).toEqual(result.sent);
	expect(result.record?.text).toBe("á🙂 محفوظ");
	expect(result.status?.durability).not.toBe("durable");
});

test("renderer crash preserves an unacknowledged outbox for authenticated recovery", async ({
	page,
	context,
}) => {
	await page.evaluate<void, Parameters<typeof startSession>[0]>(
		startSession,
		"lost-ack",
	);
	const sent = await page.evaluate(
		() => window.retentionLive.requests[0]?.fields[0]?.batch,
	);
	expect(sent).toBeDefined();
	const cdp = await context.newCDPSession(page);
	const crashed = page.waitForEvent("crash");
	void cdp.send("Page.crash").catch(() => {});
	await crashed;
	await page.close({ runBeforeUnload: false });
	const reopened = await context.newPage();
	await reopened.goto("/");
	await reopened.addScriptTag({ content: browserBundle });
	const result = await reopened.evaluate(
		async ({ ref, now }) => {
			const api = window.retentionBrowser;
			const store = await api.openIndexedDbEditStore({
				ownerId: "retention-owner",
				indexedDB,
				databasePrefix: "retention-browser",
			});
			const inspections: unknown[] = [];
			const requests: Parameters<AttemptTransport["send"]>[0][] = [];
			const coordinator = new api.AnswerEditCoordinator({
				ownerId: "retention-owner",
				attemptId: ref.attemptId,
				store,
				fallback: api.createTextRecoveryStore({
					ownerId: "retention-owner",
					storage: localStorage,
					keyPrefix: "retention-browser",
				}),
				scheduler: new api.ManualScheduler(),
				now: () => now,
				monotonicNow: () => 0,
				random: () => 0.5,
				createSessionId: () => "after-abrupt-close",
				transport: {
					inspect: async (field) => {
						inspections.push(field);
						return {
							text: "",
							revision: 0,
							nextSeq: 1,
							canWrite: true,
							receipts: [],
						};
					},
					send: async (request) => {
						requests.push(structuredClone(request));
						return request.fields.map(({ questionId, field }) => ({
							questionId,
							field,
							kind: "retry" as const,
						}));
					},
				},
			});
			const recovery = await coordinator.recover(
				{ questionId: ref.questionId, field: ref.field },
				"",
			);
			await coordinator.flush();
			return {
				inspections,
				requests,
				state: recovery.handle.getState(),
				record: await store.read(ref, now),
			};
		},
		{ ref: REF, now: EPOCH + 10_000 },
	);
	expect(result.inspections).toEqual([REF]);
	expect(result.requests).toHaveLength(1);
	expect(result.requests[0]?.fields[0]?.batch).toEqual(sent);
	expect(result.state.text).toBe("á🙂 محفوظ");
	expect(result.record?.outbox).toEqual(sent);
});

test("oversized pending history is sent without durable primary storage and then commits again", async ({
	page,
}) => {
	const result = await page.evaluate(async () => {
		const api = window.retentionBrowser;
		const epoch = 1_800_000_000_000;
		const field = { questionId: "question", field: "answer" };
		const ref = { attemptId: "attempt", ...field };
		let atMs = 0;
		let sends = 0;
		let durabilityAtSend: string | undefined;
		const store = await api.openIndexedDbEditStore({
			ownerId: "load-owner",
			indexedDB,
			databasePrefix: "retention-load",
		});
		const fallback = api.createTextRecoveryStore({
			ownerId: "load-owner",
			storage: localStorage,
			keyPrefix: "retention-load",
		});
		const coordinator = new api.AnswerEditCoordinator({
			ownerId: "load-owner",
			attemptId: "attempt",
			store,
			fallback,
			scheduler: new api.ManualScheduler(),
			createSessionId: () => "saturation-coordinator",
			now: () => epoch + atMs,
			monotonicNow: () => atMs,
			random: () => 0.5,
			transport: {
				inspect: async () => ({
					text: "",
					revision: 0,
					nextSeq: 1,
					canWrite: true,
					receipts: [],
				}),
				send: async (request: Parameters<AttemptTransport["send"]>[0]) => {
					sends++;
					durabilityAtSend = coordinator.getStatus(field)?.durability;
					return request.fields.map(({ questionId, field, batch }) => ({
						questionId,
						field,
						kind: "accepted" as const,
						receipt: {
							batchId: batch.batchId,
							revision: batch.baseRevision + 1,
							lastSeq: batch.firstSeq + batch.edits.length - 1,
						},
					}));
				},
			},
		});
		const monitor = new api.AnswerEditMonitor({
			initialText: "",
			sessionId: "saturation",
			baseRevision: 0,
			firstSeq: 1,
			now: () => atMs,
		});
		await coordinator.register(field, monitor);
		await coordinator.persist();
		/// Twenty 128-KiB UTF-8 replacements in two seconds leave a small final answer.
		for (let index = 0; index < 20; index++) {
			atMs += 100;
			monitor.recordChange({
				atMs,
				kind: "paste",
				replacements: [
					{
						position: 0,
						deleteCount: monitor.getState().text.length,
						insertedText: (index % 2 ? "é" : "ç").repeat(65_536),
					},
				],
			});
		}
		atMs += 100;
		monitor.recordChange({
			atMs,
			kind: "other",
			replacements: [
				{
					position: 0,
					deleteCount: monitor.getState().text.length,
					insertedText: "Resposta final é 🙂",
				},
			],
		});
		const pending = monitor.collect();
		if (!pending) throw new Error("Expected pending history");
		const bytes = new TextEncoder().encode(
			JSON.stringify(monitor.exportCheckpoint()),
		).length;
		await coordinator.flush();
		const stored = await store.read(ref, epoch + atMs);
		const outcome = {
			bytes,
			sends,
			durabilityAtSend,
			status: coordinator.getStatus(field),
			fallback: fallback.read(ref, epoch + atMs),
			storedText: stored?.text,
			storedOutbox: stored?.outbox,
			monitorPending: monitor.collect(),
			storedBytes: stored
				? new TextEncoder().encode(JSON.stringify(stored)).length
				: 0,
			pending,
			text: monitor.getState().text,
		};
		await coordinator.dispose();
		return outcome;
	});
	expect(result.bytes).toBeGreaterThan(MAX_LOCAL_RECORD_BYTES);
	expect(result.pending.edits).toHaveLength(21);
	expect(result.sends).toBe(1);
	expect(result.durabilityAtSend).not.toBe("durable");
	expect(result.status).toMatchObject({
		durability: "durable",
		historyGap: false,
		savedText: "Resposta final é 🙂",
	});
	expect(result.fallback).toBeNull();
	expect(result.storedText).toBe("Resposta final é 🙂");
	expect(result.storedOutbox).toBeNull();
	expect(result.storedBytes).toBeLessThan(MAX_LOCAL_RECORD_BYTES);
	expect(result.monitorPending).toBeNull();
	expect(replayEdits("", result.pending)).toBe("Resposta final é 🙂");
	expect(result.text).toBe("Resposta final é 🙂");
});
