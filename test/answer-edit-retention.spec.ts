import { expect, test } from "@playwright/test";
import { decodeEdits, replayEdits } from "@/services/answer-edits/codec";
import {
	AnswerEditMonitor,
	type PendingEditBatch,
} from "@/services/answer-edits/monitor";

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const EPOCH_MS = 1_800_000_000_000;

function harness(metadataTtlMs?: number) {
	let retentionTime = EPOCH_MS;
	const target = new AnswerEditMonitor({
		initialText: "",
		sessionId: "retention-session",
		baseRevision: 4,
		firstSeq: 12,
		now: () => 0,
		retentionNow: () => retentionTime,
		metadataTtlMs,
	});
	return {
		target,
		at: (elapsedMs: number) => {
			retentionTime = EPOCH_MS + elapsedMs;
		},
	};
}

function append(target: AnswerEditMonitor, atMs: number, inputAtMs?: number) {
	target.recordChange({
		atMs,
		kind: "typing",
		...(inputAtMs === undefined ? {} : { inputId: "input", inputAtMs }),
		replacements: [
			{
				position: target.getState().text.length,
				deleteCount: 0,
				insertedText: "x",
			},
		],
	});
}

function observe(target: AnswerEditMonitor, atMs: number) {
	target.observeInput({ id: "input", atMs, kind: "typing" });
}

function collect(target: AnswerEditMonitor) {
	const batch = target.collect();
	if (batch === null) throw new Error("Expected a pending batch");
	return batch;
}

function receipt(batch: Readonly<PendingEditBatch>) {
	return {
		batchId: batch.batchId,
		revision: batch.baseRevision + 1,
		lastSeq: batch.firstSeq + batch.edits.length - 1,
	};
}

// Inspect persisted values without depending on checkpoint field names or layout.
function containsObservation(value: unknown): boolean {
	if (value === null || typeof value !== "object") return false;
	const values = Object.values(value);
	return (
		(values.includes("input") &&
			values.includes(37) &&
			values.includes("typing")) ||
		values.some(containsObservation)
	);
}

for (const [policy, configuredTtl, ttl] of [
	["default 30 minutes", undefined, DEFAULT_TTL_MS],
	["configured 100 ms", 100, 100],
] as const) {
	test.describe(`answer edit retention: ${policy}`, () => {
		for (const consumed of [false, true]) {
			test(`input ID expires exactly at TTL, consumed ${consumed}`, () => {
				const { target, at } = harness(configuredTtl);
				observe(target, 10);
				if (consumed) append(target, 10, 10);
				at(ttl - 1);
				expect(() => observe(target, 20)).toThrow();
				at(ttl);
				expect(() => observe(target, 20)).not.toThrow();
				append(target, 20, 20);
				expect(replayEdits("", collect(target))).toBe(consumed ? "xx" : "x");
			});
		}

		test("pending association expires at the boundary and fallback invents no timing", () => {
			const { target, at } = harness(configuredTtl);
			observe(target, 10);
			append(target, 10, 10);
			target.observeInput({ id: "pending", atMs: 20, kind: "typing" });
			at(ttl);
			const before = target.getState();
			expect(() =>
				target.recordChange({
					atMs: 30,
					kind: "typing",
					inputId: "pending",
					inputAtMs: 20,
					replacements: [{ position: 1, deleteCount: 0, insertedText: "bad" }],
				}),
			).toThrow();
			expect(target.getState()).toEqual(before);
			append(target, 30);
			const batch = collect(target);
			expect(replayEdits("", batch)).toBe("xx");
			expect(decodeEdits(batch).every((edit) => edit.timing === null)).toBe(
				true,
			);
		});

		test("pending association remains valid one millisecond before TTL", () => {
			const { target, at } = harness(configuredTtl);
			observe(target, 10);
			at(ttl - 1);
			append(target, 20, 10);
			expect(replayEdits("", collect(target))).toBe("x");
		});

		test("lost ACK preserves retry beyond TTL and receipt TTL starts at local confirmation", () => {
			const { target, at } = harness(configuredTtl);
			append(target, 10);
			const first = collect(target);
			const frozen = structuredClone(first);
			append(target, 20);
			at(2 * ttl);
			expect(collect(target)).toEqual(frozen);
			target.acknowledge(receipt(first));
			const second = collect(target);
			expect(replayEdits(first.snapshot, second)).toBe("xx");
			at(3 * ttl - 1);
			expect(() => target.acknowledge({ ...receipt(first) })).not.toThrow();
			expect(() =>
				target.acknowledge({ ...receipt(first), revision: 999 }),
			).toThrow();
			expect(collect(target)).toEqual(second);
			at(3 * ttl);
			const before = target.getState();
			expect(() => target.acknowledge(receipt(first))).toThrow();
			expect(target.getState()).toEqual(before);
			expect(collect(target)).toEqual(second);
			target.acknowledge(receipt(second));
			append(target, 30);
			const third = collect(target);
			expect(third.baseRevision).toBe(6);
			expect(third.firstSeq).toBe(14);
			expect(replayEdits("xx", third)).toBe("xxx");
		});
	});
}

test.describe("answer edit retention: observation lifecycle", () => {
	test("consumed ID retention starts at consumption rather than observation", () => {
		const { target, at } = harness(100);
		observe(target, 10);
		at(90);
		append(target, 20, 10);
		at(100);
		expect(() => observe(target, 30)).toThrow();
		at(189);
		expect(() => observe(target, 30)).toThrow();
		at(190);
		expect(() => observe(target, 30)).not.toThrow();
	});

	test("an old token cannot consume a new observation with the same ID", () => {
		const { target, at } = harness(100);
		observe(target, 10);
		at(100);
		observe(target, 20);
		const before = target.getState();
		expect(() => append(target, 30, 10)).toThrow();
		expect(target.getState()).toEqual(before);
		append(target, 30, 20);
		expect(replayEdits("", collect(target))).toBe("x");
	});

	test("consumption drops the observation payload while retaining replay and duplicate protection", () => {
		const { target, at } = harness(100);
		observe(target, 37);
		append(target, 40, 37);
		expect(containsObservation(target.exportCheckpoint())).toBe(false);
		expect(() => observe(target, 50)).toThrow();
		at(100);
		expect(containsObservation(target.exportCheckpoint())).toBe(false);
		const batch = collect(target);
		expect(replayEdits("", batch)).toBe("x");
		expect(decodeEdits(batch).map((edit) => edit.timing)).toEqual([null]);
	});

	test("expired cadence does not contribute an interval to fresh input", () => {
		const { target, at } = harness(100);
		observe(target, 10);
		append(target, 10, 10);
		at(100);
		target.observeInput({ id: "fresh", atMs: 20, kind: "typing" });
		target.recordChange({
			atMs: 20,
			kind: "typing",
			inputId: "fresh",
			inputAtMs: 20,
			replacements: [{ position: 1, deleteCount: 0, insertedText: "x" }],
		});
		const batch = collect(target);
		expect(replayEdits("", batch)).toBe("xx");
		expect(decodeEdits(batch).every((edit) => edit.timing === null)).toBe(true);
	});
});
