import path from "node:path";
import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { replayEdits } from "@/services/answer-edits/codec";
import type { AttemptTransport } from "@/services/answer-edits/coordinator";
import { AnswerEditMonitor } from "@/services/answer-edits/monitor";

const MINUTE_MS = 60_000;
const STORAGE_LIMIT_BYTES = 2 * 1024 * 1024;

function checkpointBytes(monitor: AnswerEditMonitor) {
	return Buffer.byteLength(JSON.stringify(monitor.exportCheckpoint()), "utf8");
}

test("checkpoint stays small at 10 inputs per second across 90 minutes, delivery and reload", () => {
	test.setTimeout(180_000);
	let elapsed = 0;
	let monitor = new AnswerEditMonitor({
		initialText: "é",
		sessionId: "load-original",
		baseRevision: 0,
		firstSeq: 1,
		now: () => elapsed,
	});
	let deliveredText = "é";
	let deliveredEdits = 0;
	let peakBytes = 0;
	let deliveredBatches = 0;
	const samples: { minute: number; bytes: number }[] = [];
	/// Replacing one character models sustained corrections without growing the answer.
	/// Every input is observed and consumed, with 600 changes per minute-long batch.
	for (let minute = 1; minute <= 90; minute++) {
		for (let input = 0; input < 600; input++) {
			elapsed = (minute - 1) * MINUTE_MS + (input + 1) * 100;
			const token = monitor.observeInput({ atMs: elapsed, kind: "typing" });
			monitor.recordChange({
				atMs: elapsed,
				input: token,
				kind: "typing",
				replacements: [
					{ position: 0, deleteCount: 1, insertedText: input % 2 ? "é" : "ç" },
				],
			});
		}
		const pending = monitor.collect();
		if (!pending) throw new Error("Expected the minute's edits");
		expect(pending.baseRevision).toBe(deliveredBatches);
		expect(pending.firstSeq).toBe(deliveredEdits + 1);
		expect(pending.edits).toHaveLength(600);
		expect(replayEdits(deliveredText, pending)).toBe("é");
		peakBytes = Math.max(peakBytes, checkpointBytes(monitor));
		deliveredEdits += pending.edits.length;
		deliveredBatches++;
		deliveredText = pending.snapshot;
		monitor.acknowledge({
			batchId: pending.batchId,
			revision: deliveredBatches,
			lastSeq: deliveredEdits,
		});
		if (minute % 30 === 0)
			samples.push({ minute, bytes: checkpointBytes(monitor) });
		if (minute === 60) {
			monitor = AnswerEditMonitor.restore({
				checkpoint: JSON.parse(JSON.stringify(monitor.exportCheckpoint())),
				now: () => elapsed,
				createSessionId: () => "load-reloaded",
			});
		}
	}
	for (const sample of samples) expect(sample.bytes).toBeLessThan(8192);
	const settledBytes = checkpointBytes(monitor);
	expect(settledBytes).toBeLessThan(8192);
	expect(monitor.getState().text).toBe("é");
	expect(monitor.collect()).toBeNull();
	expect(deliveredBatches).toBe(90);
	expect(deliveredEdits).toBe(54_000);
	console.log(
		"checkpoint load",
		JSON.stringify({
			inputsPerSecond: 10,
			simulatedMinutes: 90,
			deliveredBatches,
			deliveredEdits,
			peakBytes,
			samples,
			settledBytes,
		}),
	);
});

declare global {
	interface Window {
		retentionLoad: typeof import("@/services/answer-edits/monitor") &
			typeof import("@/services/answer-edits/coordinator") &
			typeof import("@/services/answer-edits/storage") &
			typeof import("@/services/answer-edits/codec") &
			Pick<
				typeof import("./helpers/answer-edit-coordinator"),
				"ManualScheduler"
			>;
	}
}

test("oversized pending history is sent without durable primary storage and then commits again", async ({
	page,
}) => {
	const bundle = await build({
		stdin: {
			contents: [
				'export * from "@/services/answer-edits/monitor";',
				'export * from "@/services/answer-edits/coordinator";',
				'export * from "@/services/answer-edits/storage";',
				'export * from "@/services/answer-edits/codec";',
				'export { ManualScheduler } from "./test/helpers/answer-edit-coordinator";',
			].join("\n"),
			resolveDir: path.resolve("."),
		},
		alias: { "@": path.resolve("src") },
		bundle: true,
		write: false,
		platform: "browser",
		format: "iife",
		globalName: "retentionLoad",
		logLevel: "silent",
	});
	await page.goto("/");
	await page.addScriptTag({ content: bundle.outputFiles[0]?.text ?? "" });
	const result = await page.evaluate(async () => {
		const api = window.retentionLoad;
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
		const _before = await store.read(ref, epoch);
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
		const _frozen = structuredClone(pending);
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
			edits: pending.edits.length,
			insertedUtf8Bytes: pending.edits.reduce(
				(total, edit) => total + new TextEncoder().encode(edit[4]).length,
				0,
			),
			replay: api.replayEdits("", pending),
			text: monitor.getState().text,
		};
		await coordinator.dispose();
		return outcome;
	});
	expect(result.bytes).toBeGreaterThan(STORAGE_LIMIT_BYTES);
	expect(result.insertedUtf8Bytes).toBeGreaterThan(STORAGE_LIMIT_BYTES);
	expect(result.edits).toBe(21);
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
	expect(result.storedBytes).toBeLessThan(STORAGE_LIMIT_BYTES);
	expect(result.monitorPending).toBeNull();
	expect(result.replay).toBe("Resposta final é 🙂");
	expect(result.text).toBe(result.replay);
	console.log(
		"oversized pending saturation",
		JSON.stringify({
			checkpointBytes: result.bytes,
			insertedUtf8Bytes: result.insertedUtf8Bytes,
			pendingEdits: result.edits,
			sends: result.sends,
			durability: result.status?.durability,
		}),
	);
});
