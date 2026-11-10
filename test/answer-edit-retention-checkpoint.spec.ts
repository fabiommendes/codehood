import { expect, test } from "@playwright/test";
import { replayEdits } from "@/services/answer-edits/codec";
import {
	AnswerEditMonitor,
	type MonitorCheckpoint,
	type PendingEditBatch,
} from "@/services/answer-edits/monitor";

const EPOCH_MS = 1_800_000_000_000;
const TTL_MS = 200;

function collect(target: AnswerEditMonitor) {
	const batch = target.collect();
	if (batch === null) throw new Error("Expected pending edits");
	return batch;
}

function receipt(batch: Readonly<PendingEditBatch>) {
	return {
		batchId: batch.batchId,
		revision: batch.baseRevision + 1,
		lastSeq: batch.firstSeq + batch.edits.length - 1,
	};
}

function checkpoint(target: AnswerEditMonitor): MonitorCheckpoint {
	return JSON.parse(JSON.stringify(target.exportCheckpoint()));
}

function append(target: AnswerEditMonitor, text: string, atMs: number) {
	target.recordChange({
		atMs,
		kind: "other",
		replacements: [
			{
				position: target.getState().text.length,
				deleteCount: 0,
				insertedText: text,
			},
		],
	});
}

function restore(
	saved: MonitorCheckpoint,
	sessionId: string,
	retentionNow: () => number,
) {
	return AnswerEditMonitor.restore({
		checkpoint: saved,
		now: () => 0,
		retentionNow,
		metadataTtlMs: TTL_MS,
		createSessionId: () => sessionId,
	});
}

test("v2 reload expires receipts exactly at epoch TTL and persists the wall-clock maximum without losing pending sessions", () => {
	let wall = EPOCH_MS;
	const retentionNow = () => wall;
	let target = new AnswerEditMonitor({
		initialText: "seed",
		sessionId: "epoch-original",
		baseRevision: 4,
		firstSeq: 12,
		now: () => 900_000,
		retentionNow,
		metadataTtlMs: TTL_MS,
	});
	append(target, "a", 900_010);
	const confirmed = collect(target);
	target.acknowledge(receipt(confirmed));
	append(target, "b", 900_020);
	const pending = collect(target);
	append(target, "c", 900_030);
	const saved = checkpoint(target);
	wall = EPOCH_MS + TTL_MS - 1;
	target = restore(saved, "before-boundary", retentionNow);
	expect(() => target.acknowledge(receipt(confirmed))).not.toThrow();
	expect(collect(target)).toEqual(pending);
	const beforeBoundary = checkpoint(target);
	wall++;
	target = restore(beforeBoundary, "at-boundary", retentionNow);
	const before = target.getState();
	expect(() => target.acknowledge(receipt(confirmed))).toThrow();
	expect(target.getState()).toEqual(before);
	expect(collect(target)).toEqual(pending);
	expect(() =>
		restore(checkpoint(target), "epoch-original", retentionNow),
	).toThrow();

	expect(saved.version).toBe(2);
	const highWater = checkpoint(target);
	wall = EPOCH_MS - 1_000_000;
	target = restore(highWater, "backwards-clock", retentionNow);
	expect(collect(target)).toEqual(pending);
	target.acknowledge(receipt(pending));
	append(target, "d", 1);
	const queued = collect(target);
	expect(replayEdits("seedab", queued)).toBe("seedabc");
	wall = EPOCH_MS + 2 * TTL_MS - 1;
	target = restore(checkpoint(target), "before-second-boundary", retentionNow);
	expect(() => target.acknowledge(receipt(pending))).not.toThrow();
	wall++;
	target = restore(checkpoint(target), "second-boundary", retentionNow);
	expect(() => target.acknowledge(receipt(pending))).toThrow();
	expect(collect(target)).toEqual(queued);
	target.acknowledge(receipt(queued));
	const fresh = collect(target);
	expect(replayEdits("seedabc", fresh)).toBe("seedabcd");
	expect(fresh).toMatchObject({
		baseRevision: 7,
		firstSeq: 15,
		sessionId: "backwards-clock",
	});
	target.acknowledge(receipt(fresh));
	expect(target.collect()).toBeNull();
});

test("long confirmed runs and repeated restores retain only window controls plus text and pending work", () => {
	let wall = EPOCH_MS;
	const retentionNow = () => wall;
	let target = new AnswerEditMonitor({
		initialText: "",
		sessionId: "long-0000",
		baseRevision: 0,
		firstSeq: 0,
		now: () => 0,
		retentionNow,
		metadataTtlMs: TTL_MS,
	});
	let text = "";
	const samples: { batches: number; bytes: number }[] = [];
	for (let index = 1; index <= 1200; index++) {
		wall = EPOCH_MS + index * 20;
		const next = (index % 2 ? "á🙂" : "ç🚀").repeat(8);
		const inputId = `long-input-${index}`;
		target.observeInput({ id: inputId, atMs: index, kind: "typing" });
		target.recordChange({
			atMs: index,
			inputId,
			inputAtMs: index,
			kind: "typing",
			replacements: [
				{ position: 0, deleteCount: text.length, insertedText: next },
			],
		});
		const batch = collect(target);
		expect(batch).toMatchObject({
			baseRevision: index - 1,
			firstSeq: index - 1,
		});
		expect(replayEdits(text, batch)).toBe(next);
		target.acknowledge(receipt(batch));
		text = next;
		if (index % 20 === 0)
			target = restore(
				checkpoint(target),
				`long-${String(index).padStart(4, "0")}`,
				retentionNow,
			);
		if (index === 120 || index === 1200)
			samples.push({
				batches: index,
				bytes: Buffer.byteLength(JSON.stringify(checkpoint(target)), "utf8"),
			});
	}
	console.log("retention checkpoint UTF-8 bytes", JSON.stringify(samples));
	expect(samples[1]?.bytes).toBeLessThanOrEqual(32 * 1024);
	expect(samples[1]?.bytes).toBeLessThanOrEqual(
		(samples[0]?.bytes ?? 0) + 4096,
	);

	append(target, "pending", 1201);
	const pending = collect(target);
	append(target, "queued", 1202);
	wall += 100 * TTL_MS;
	target = restore(checkpoint(target), "long-pending-reload", retentionNow);
	expect(collect(target)).toEqual(pending);
	expect(replayEdits(text, pending)).toBe(`${text}pending`);
	target.acknowledge(receipt(pending));
	const queued = collect(target);
	expect(replayEdits(pending.snapshot, queued)).toBe(`${text}pendingqueued`);
	target.acknowledge(receipt(queued));
	const compact = checkpoint(target);
	console.log(
		"retention checkpoint after pending drain UTF-8 bytes",
		Buffer.byteLength(JSON.stringify(compact), "utf8"),
	);
	expect(Buffer.byteLength(JSON.stringify(compact), "utf8")).toBeLessThan(8192);
	expect(JSON.stringify(compact)).not.toContain("long-0000");
	expect(JSON.stringify(compact)).not.toContain('long-input-1"');
	expect(target.collect()).toBeNull();
});

/// Captured through the public v1 API with an ACK, inflight batch, queued session and active edit.
const LEGACY_CHECKPOINT = {
	version: 1,
	state: {
		initialRevision: 4,
		initialSeq: 12,
		baseRevision: 5,
		firstSeq: 13,
		pauseMs: 1000,
		confirmedText: "seeda",
		text: "seedabcd",
		sessions: ["legacy-original", "legacy-middle"],
		receipts: [{ batchId: "legacy-original:12", revision: 5, lastSeq: 12 }],
		inFlight: {
			version: 1,
			batchId: "legacy-original:13",
			sessionId: "legacy-original",
			timeOriginMs: 10000,
			baseRevision: 5,
			firstSeq: 13,
			edits: [[20, 0, 5, 0, "b", 6, null]],
			snapshot: "seedab",
		},
		queue: [
			{
				sessionId: "legacy-original",
				timeOriginMs: 10000,
				edits: [
					{
						position: 6,
						deleteCount: 0,
						insertedText: "c",
						startMs: 10030,
						durationMs: 0,
						kind: "other",
						timing: null,
					},
				],
				snapshot: "seedabc",
			},
		],
		active: {
			sessionId: "legacy-middle",
			timeOriginMs: 0,
			lastAtMs: 1,
			previousCadenceMs: null,
			observations: [],
			consumedInputs: [],
			edits: [
				{
					position: 7,
					deleteCount: 0,
					insertedText: "d",
					startMs: 1,
					durationMs: 0,
					kind: "other",
					timing: null,
				},
			],
			openEdit: null,
		},
	},
} as const;

test("validated v1 migration keeps inflight and queue, expires legacy controls from migration time and rejects corruption", () => {
	let wall = EPOCH_MS;
	const retentionNow = () => wall;
	const legacy: MonitorCheckpoint = structuredClone(LEGACY_CHECKPOINT);
	const original = structuredClone(legacy);
	let target = restore(legacy, "migration-session", retentionNow);
	expect(legacy).toEqual(original);
	const legacyReceipt = {
		batchId: "legacy-original:12",
		revision: 5,
		lastSeq: 12,
	};
	expect(() => target.acknowledge(legacyReceipt)).not.toThrow();
	expect(collect(target)).toEqual(LEGACY_CHECKPOINT.state.inFlight);
	const migrated = checkpoint(target);
	wall += TTL_MS - 1;
	target = restore(migrated, "migration-before-ttl", retentionNow);
	expect(() => target.acknowledge(legacyReceipt)).not.toThrow();
	const beforeExpiry = checkpoint(target);
	wall++;
	target = restore(beforeExpiry, "migration-at-ttl", retentionNow);
	expect(() => target.acknowledge(legacyReceipt)).toThrow();
	expect(migrated.version).toBe(2);
	let text = "seeda";
	for (const [index, after] of ["seedab", "seedabc", "seedabcd"].entries()) {
		const batch = collect(target);
		expect(batch).toMatchObject({
			baseRevision: 5 + index,
			firstSeq: 13 + index,
			snapshot: after,
		});
		expect(replayEdits(text, batch)).toBe(after);
		target.acknowledge(receipt(batch));
		text = after;
	}
	wall += 2 * TTL_MS;
	const compact = checkpoint(target);
	expect(target.collect()).toBeNull();
	expect(JSON.stringify(compact)).not.toContain("legacy-original");
	expect(JSON.stringify(compact)).not.toContain("legacy-middle");
	append(target, "e", 1);
	const next = collect(target);
	expect(next).toMatchObject({
		baseRevision: 8,
		firstSeq: 16,
		snapshot: "seedabcde",
	});
	for (const invalid of [
		{ ...legacy, version: 99 },
		{ ...legacy, state: { ...LEGACY_CHECKPOINT.state, text: "tampered" } },
		{
			...legacy,
			state: {
				...LEGACY_CHECKPOINT.state,
				receipts: [{ ...legacyReceipt, lastSeq: 11 }],
			},
		},
		{ ...migrated, version: 99 },
		{ ...migrated, state: {} },
	]) {
		const before = structuredClone(invalid);
		expect(() =>
			restore(invalid as MonitorCheckpoint, "reject-corruption", retentionNow),
		).toThrow();
		expect(invalid).toEqual(before);
	}
	expect(collect(target)).toEqual(next);
});
