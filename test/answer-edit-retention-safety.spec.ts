import { expect, test } from "@playwright/test";
import { replayEdits } from "@/services/answer-edits/codec";
import {
	AnswerEditMonitor,
	type MonitorCheckpoint,
	type PendingEditBatch,
} from "@/services/answer-edits/monitor";

const EPOCH = 1_800_000_000_000;
const TTL_MS = 100;
const DEFAULT_TTL_MS = 1_800_000;

function batch(monitor: AnswerEditMonitor) {
	const pending = monitor.collect();
	if (!pending) throw new Error("Expected pending batch");
	return pending;
}

function receipt(pending: PendingEditBatch) {
	return {
		batchId: pending.batchId,
		revision: pending.baseRevision + 1,
		lastSeq: pending.firstSeq + pending.edits.length - 1,
	};
}

function append(monitor: AnswerEditMonitor, atMs = 10) {
	monitor.recordChange({
		atMs,
		kind: "other",
		replacements: [
			{
				position: monitor.getState().text.length,
				deleteCount: 0,
				insertedText: "a",
			},
		],
	});
}

/// A v1 checkpoint with a confirmed receipt and no pending work.
const LEGACY: MonitorCheckpoint = {
	version: 1,
	state: {
		initialRevision: 0,
		initialSeq: 1,
		baseRevision: 1,
		firstSeq: 2,
		pauseMs: 1000,
		confirmedText: "a",
		text: "a",
		sessions: ["legacy"],
		receipts: [{ batchId: "legacy:1", revision: 1, lastSeq: 1 }],
		inFlight: null,
		queue: [],
		active: {
			sessionId: "legacy",
			timeOriginMs: 0,
			lastAtMs: 10,
			previousCadenceMs: null,
			observations: [],
			consumedInputs: [],
			edits: [],
			openEdit: null,
		},
	},
};

for (const scenario of [
	{
		name: "v2 preserves the saved 100ms TTL without override",
		version: 2,
		ttl: TTL_MS,
	},
	{
		name: "v2 explicit restore override wins over the saved TTL",
		version: 2,
		ttl: 250,
		override: 250,
	},
	{
		name: "v1 migration uses the default TTL without override",
		version: 1,
		ttl: DEFAULT_TTL_MS,
	},
] as const) {
	test(scenario.name, () => {
		let wall = EPOCH;
		const original = new AnswerEditMonitor({
			initialText: "",
			sessionId: "ttl-original",
			baseRevision: 0,
			firstSeq: 1,
			now: () => 0,
			retentionNow: () => wall,
			metadataTtlMs: TTL_MS,
		});
		const saved: MonitorCheckpoint =
			scenario.version === 1
				? structuredClone(LEGACY)
				: JSON.parse(JSON.stringify(original.exportCheckpoint()));
		expect(saved.version).toBe(scenario.version);
		const restored = AnswerEditMonitor.restore({
			checkpoint: saved,
			now: () => 0,
			retentionNow: () => wall,
			createSessionId: () => "ttl-restored",
			...("override" in scenario ? { metadataTtlMs: scenario.override } : {}),
		});
		append(restored);
		const accepted = receipt(batch(restored));
		restored.acknowledge(accepted);
		wall += scenario.ttl - 1;
		expect(() => restored.acknowledge(accepted)).not.toThrow();
		wall++;
		expect(() => restored.acknowledge(accepted)).toThrow();
		expect(restored.getState().text).toBe(scenario.version === 1 ? "aa" : "a");
		expect(restored.collect()).toBeNull();
	});
}

for (const consumed of [false, true]) {
	test(`GC rejects reuse of the same ID and timestamp after TTL, consumed=${consumed}`, () => {
		let wall = EPOCH;
		const monitor = new AnswerEditMonitor({
			initialText: "",
			sessionId: "token-session",
			baseRevision: 0,
			firstSeq: 1,
			now: () => 0,
			retentionNow: () => wall,
			metadataTtlMs: TTL_MS,
		});
		const input = { id: "reused", atMs: 10, kind: "typing" as const };
		const change = {
			atMs: 10,
			inputId: input.id,
			inputAtMs: input.atMs,
			kind: "typing" as const,
			replacements: [{ position: 0, deleteCount: 0, insertedText: "a" }],
		};
		monitor.observeInput(input);
		if (consumed) monitor.recordChange(change);
		wall += TTL_MS;
		const before = monitor.exportCheckpoint();
		expect.soft(() => monitor.observeInput(input)).toThrow();
		expect.soft(monitor.exportCheckpoint()).toEqual(before);
		expect.soft(() => monitor.recordChange(change)).toThrow();
		expect.soft(monitor.getState().text).toBe(consumed ? "a" : "");
		const pending = monitor.collect();
		if (consumed) {
			if (!pending) throw new Error("Expected original edit to survive GC");
			expect(replayEdits("", pending)).toBe("a");
		} else {
			expect(pending).toBeNull();
		}
	});
}

for (const elapsed of [TTL_MS - 1, TTL_MS]) {
	test(`input association expires at the exact TTL boundary: elapsed=${elapsed}`, () => {
		let wall = EPOCH;
		const monitor = new AnswerEditMonitor({
			initialText: "",
			sessionId: "boundary-session",
			baseRevision: 0,
			firstSeq: 1,
			now: () => 0,
			retentionNow: () => wall,
			metadataTtlMs: TTL_MS,
		});
		monitor.observeInput({ id: "boundary", atMs: 0, kind: "typing" });
		wall += elapsed;
		const change = {
			atMs: 0,
			inputId: "boundary",
			inputAtMs: 0,
			kind: "typing" as const,
			replacements: [{ position: 0, deleteCount: 0, insertedText: "a" }],
		};
		if (elapsed < TTL_MS) {
			monitor.recordChange(change);
			expect(replayEdits("", batch(monitor))).toBe("a");
		} else {
			expect(() => monitor.recordChange(change)).toThrow();
			expect(monitor.getState().text).toBe("");
			expect(monitor.collect()).toBeNull();
		}
	});
}

test("equal zero timestamps produce an observed zero interval before any GC", () => {
	const monitor = new AnswerEditMonitor({
		initialText: "",
		sessionId: "zero-session",
		baseRevision: 0,
		firstSeq: 1,
		now: () => 0,
		retentionNow: () => EPOCH,
		metadataTtlMs: TTL_MS,
	});
	for (const [position, id] of ["first", "second"].entries()) {
		monitor.observeInput({ id, atMs: 0, kind: "typing" });
		monitor.recordChange({
			atMs: 0,
			inputId: id,
			inputAtMs: 0,
			kind: "typing",
			replacements: [{ position, deleteCount: 0, insertedText: "a" }],
		});
	}
	const pending = batch(monitor);
	expect(replayEdits("", pending)).toBe("aa");
	expect(pending.edits).toHaveLength(1);
	expect(pending.edits[0]?.[6]).toEqual([1, 0, 0]);
});

test("GC watermark reaches the last event but retained observations remain associable", () => {
	let wall = EPOCH;
	const monitor = new AnswerEditMonitor({
		initialText: "",
		sessionId: "retained-session",
		baseRevision: 0,
		firstSeq: 1,
		now: () => 0,
		retentionNow: () => wall,
		metadataTtlMs: TTL_MS,
	});
	monitor.observeInput({ id: "expired", atMs: 10, kind: "typing" });
	wall += 50;
	monitor.observeInput({ id: "retained", atMs: 20, kind: "typing" });
	wall += 50;
	monitor.exportCheckpoint();
	expect
		.soft(() => monitor.observeInput({ id: "new", atMs: 20, kind: "typing" }))
		.toThrow();
	monitor.recordChange({
		atMs: 20,
		inputId: "retained",
		inputAtMs: 20,
		kind: "typing",
		replacements: [{ position: 0, deleteCount: 0, insertedText: "a" }],
	});
	monitor.observeInput({ id: "expired", atMs: 21, kind: "typing" });
	monitor.recordChange({
		atMs: 21,
		inputId: "expired",
		inputAtMs: 21,
		kind: "typing",
		replacements: [{ position: 1, deleteCount: 0, insertedText: "b" }],
	});
	expect(replayEdits("", batch(monitor))).toBe("ab");
});
