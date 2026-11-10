import { expect, test } from "@playwright/test";
import { decodeEdits, replayEdits } from "@/services/answer-edits/codec";
import {
	AnswerEditMonitor,
	type BatchReceipt,
	type MonitorOptions,
	type MonitorState,
	type PendingEditBatch,
} from "@/services/answer-edits/monitor";

function monitor(initialText = "", options: Partial<MonitorOptions> = {}) {
	return new AnswerEditMonitor({
		initialText,
		sessionId: "answer-batch-session",
		baseRevision: 4,
		firstSeq: 12,
		now: () => 100,
		...options,
	});
}

function append(target: AnswerEditMonitor, text: string, atMs: number) {
	target.recordChange({
		atMs,
		kind: "typing",
		replacements: [
			{
				position: target.getState().text.length,
				deleteCount: 0,
				insertedText: text,
			},
		],
	});
}

function collect(target: AnswerEditMonitor) {
	const batch = target.collect();
	expect(batch).not.toBeNull();
	if (batch === null) throw new Error("Expected an edit batch");
	return batch;
}

function receipt(batch: Readonly<PendingEditBatch>): BatchReceipt {
	return {
		batchId: batch.batchId,
		revision: batch.baseRevision + 1,
		lastSeq: batch.firstSeq + batch.edits.length - 1,
	};
}

function expectDeepFrozen(value: unknown) {
	if (value === null || typeof value !== "object") return;
	expect(Object.isFrozen(value)).toBe(true);
	for (const nested of Object.values(value)) expectDeepFrozen(nested);
}

function pendingMonitor() {
	const target = monitor("abc");
	append(target, "d", 110);
	const batch = collect(target);
	append(target, "e", 120);
	return { target, batch };
}

test.describe("answer edit monitor batches: collection and replay", () => {
	test("collect without document changes returns null and leaves a clean state", () => {
		const target = monitor("unchanged");
		target.observeInput({ atMs: 110, kind: "typing" });
		target.closeEdit();
		expect(target.collect()).toBeNull();
		expect(target.getState()).toEqual({
			text: "unchanged",
			hasPendingChanges: false,
			hasUnacknowledgedBatch: false,
		});
	});

	test("retry preserves the deeply frozen batch, including cadence, while text changes", () => {
		const target = monitor();
		for (const [atMs, position, insertedText] of [
			[110, 0, "a"],
			[130, 1, "b"],
		] as const) {
			const input = target.observeInput({ atMs, kind: "typing" });
			target.recordChange({
				atMs,
				kind: "typing",
				input,
				replacements: [{ position, deleteCount: 0, insertedText }],
			});
		}
		const batch = collect(target);
		const original = structuredClone(batch);
		expect(decodeEdits(batch).map((edit) => edit.timing)).toEqual([[1, 20, 0]]);
		expectDeepFrozen(batch);
		expect(Reflect.set(batch, "snapshot", "corrupted")).toBe(false);
		append(target, "c", 150);
		target.closeEdit();
		expect(target.collect()).toBe(batch);
		expect(target.collect()).toBe(batch);
		expect(batch).toEqual(original);
		expect(batch.snapshot).toBe("ab");
		expect(target.getState()).toEqual({
			text: "abc",
			hasPendingChanges: true,
			hasUnacknowledgedBatch: true,
		});
	});

	test("ACK advances by tuple count across multipatch batches with independent time deltas and replay", () => {
		const target = monitor("abcdef");
		target.recordChange({
			atMs: 125,
			kind: "other",
			replacements: [
				{ position: 0, deleteCount: 1, insertedText: "A" },
				{ position: 2, deleteCount: 1, insertedText: "C" },
				{ position: 4, deleteCount: 1, insertedText: "E" },
			],
		});
		const first = collect(target);
		expect(first).toMatchObject({
			baseRevision: 4,
			firstSeq: 12,
			timeOriginMs: 100,
			snapshot: "AbCdEf",
		});
		expect(first.edits).toHaveLength(3);
		expect(first.edits[0]?.[0]).toBe(25);
		append(target, "😀", 180);
		expect(target.collect()).toBe(first);
		target.acknowledge(receipt(first));
		expect(target.getState()).toEqual({
			text: "AbCdEf😀",
			hasPendingChanges: true,
			hasUnacknowledgedBatch: false,
		});
		const second = collect(target);
		expect(second).toMatchObject({
			baseRevision: 5,
			firstSeq: 15,
			timeOriginMs: 100,
			sessionId: first.sessionId,
			snapshot: "AbCdEf😀",
		});
		expect(second.batchId).not.toBe(first.batchId);
		expect(second.edits).toHaveLength(1);
		expect(second.edits[0]?.[0]).toBe(80);
		expect(decodeEdits(second).map((edit) => edit.startMs)).toEqual([180]);
		expect(replayEdits("abcdef", first)).toBe(first.snapshot);
		expect(replayEdits(replayEdits("abcdef", first), second)).toBe(
			second.snapshot,
		);
		target.acknowledge(receipt(second));
		append(target, "!", 200);
		const third = collect(target);
		expect(third).toMatchObject({ baseRevision: 6, firstSeq: 16 });
		expect(new Set([first.batchId, second.batchId, third.batchId]).size).toBe(
			3,
		);
		expect(replayEdits(second.snapshot, third)).toBe("AbCdEf😀!");
		target.acknowledge(receipt(third));
		expect(target.collect()).toBeNull();
		expect(target.getState()).toEqual({
			text: "AbCdEf😀!",
			hasPendingChanges: false,
			hasUnacknowledgedBatch: false,
		});
	});

	test("an empty snapshot is a valid pending batch and can be acknowledged", () => {
		const target = monitor("x", { baseRevision: 0, firstSeq: 0 });
		target.recordChange({
			atMs: 110,
			kind: "delete",
			replacements: [{ position: 0, deleteCount: 1, insertedText: "" }],
		});
		const batch = collect(target);
		expect(batch.snapshot).toBe("");
		expect(replayEdits("x", batch)).toBe("");
		expect(receipt(batch)).toEqual({
			batchId: batch.batchId,
			revision: 1,
			lastSeq: 0,
		});
		target.acknowledge(receipt(batch));
		expect(target.getState()).toEqual({
			text: "",
			hasPendingChanges: false,
			hasUnacknowledgedBatch: false,
		});
		expect(target.collect()).toBeNull();
	});
});

test.describe("answer edit monitor batches: receipts", () => {
	const invalidReceipts: [string, Partial<BatchReceipt>][] = [
		["unknown batch", { batchId: "unknown-batch" }],
		["stale revision", { revision: 4 }],
		["future revision", { revision: 6 }],
		["earlier sequence", { lastSeq: 11 }],
		["later sequence", { lastSeq: 13 }],
	];
	for (const [name, override] of invalidReceipts) {
		test(`rejects ${name} without changing the in-flight batch or retained changes`, () => {
			const { target, batch } = pendingMonitor();
			const before = structuredClone(target.getState());
			expect(() =>
				target.acknowledge({ ...receipt(batch), ...override }),
			).toThrow();
			expect(target.getState()).toEqual(before);
			expect(target.collect()).toBe(batch);
			target.acknowledge(receipt(batch));
			const next = collect(target);
			expect(next).toMatchObject({
				baseRevision: 5,
				firstSeq: 13,
				snapshot: "abcde",
			});
			expect(replayEdits(batch.snapshot, next)).toBe("abcde");
		});
	}

	for (const phase of [
		"with uncollected changes",
		"after all batches are acknowledged",
	] as const) {
		test(`rejects an unknown ACK ${phase}`, () => {
			const target = monitor();
			if (phase === "with uncollected changes") append(target, "a", 110);
			if (phase === "after all batches are acknowledged") {
				append(target, "a", 110);
				target.acknowledge(receipt(collect(target)));
			}
			const before = structuredClone(target.getState());
			expect(() =>
				target.acknowledge({
					batchId: "never-collected",
					revision: 5,
					lastSeq: 12,
				}),
			).toThrow();
			expect(target.getState()).toEqual(before);
			if (phase === "with uncollected changes") {
				const batch = collect(target);
				expect(batch).toMatchObject({
					baseRevision: 4,
					firstSeq: 12,
					snapshot: "a",
				});
			} else expect(target.collect()).toBeNull();
		});
	}

	test("identical old receipts are idempotent while a newer batch is in flight and after it is confirmed", () => {
		const { target, batch: first } = pendingMonitor();
		const firstReceipt = receipt(first);
		target.acknowledge(firstReceipt);
		const afterFirst = structuredClone(target.getState());
		target.acknowledge({ ...firstReceipt });
		expect(target.getState()).toEqual(afterFirst);
		const second = collect(target);
		const inFlight = structuredClone(target.getState());
		target.acknowledge({ ...firstReceipt });
		expect(target.getState()).toEqual(inFlight);
		expect(target.collect()).toBe(second);
		target.acknowledge(receipt(second));
		const confirmed = structuredClone(target.getState());
		for (const accepted of [firstReceipt, receipt(second), firstReceipt]) {
			target.acknowledge({ ...accepted });
			expect(target.getState()).toEqual(confirmed);
		}
		expect(target.collect()).toBeNull();
	});

	for (const field of ["revision", "lastSeq"] as const) {
		test(`rejects a historical receipt with divergent ${field} while a newer batch is in flight`, () => {
			const { target, batch: first } = pendingMonitor();
			const accepted = receipt(first);
			target.acknowledge(accepted);
			const second = collect(target);
			const before = structuredClone(target.getState());
			expect(() =>
				target.acknowledge({ ...accepted, [field]: accepted[field] + 1 }),
			).toThrow();
			expect(target.getState()).toEqual(before);
			expect(target.collect()).toBe(second);
			target.acknowledge({ ...accepted });
			expect(target.getState()).toEqual(before);
		});
	}
});

test.describe("answer edit monitor batches: subscriptions and disposal", () => {
	test("subscribers receive immutable text, collection and ACK states and unsubscribe removes the listener", () => {
		const target = monitor();
		const states: Readonly<MonitorState>[] = [];
		const unsubscribe = target.subscribe((state) => states.push(state));
		let start = states.length;
		append(target, "a", 110);
		expect(states.slice(start)).toContainEqual({
			text: "a",
			hasPendingChanges: true,
			hasUnacknowledgedBatch: false,
		});
		start = states.length;
		const batch = collect(target);
		expect(states.slice(start)).toContainEqual({
			text: "a",
			hasPendingChanges: true,
			hasUnacknowledgedBatch: true,
		});
		start = states.length;
		target.acknowledge(receipt(batch));
		expect(states.slice(start)).toContainEqual({
			text: "a",
			hasPendingChanges: false,
			hasUnacknowledgedBatch: false,
		});
		const saved = structuredClone(states);
		for (const state of states) expectDeepFrozen(state);
		unsubscribe();
		start = states.length;
		append(target, "b", 120);
		target.acknowledge(receipt(collect(target)));
		target.dispose();
		expect(states).toEqual(saved);
		expect(states).toHaveLength(start);
	});

	for (const operation of [
		"observeInput",
		"recordChange",
		"closeEdit",
		"collect",
		"acknowledge",
		"subscribe",
	] as const) {
		test(`${operation} rejects after idempotent dispose without losing pending text or notifying listeners`, () => {
			const { target, batch } = pendingMonitor();
			const states: Readonly<MonitorState>[] = [];
			target.subscribe((state) => states.push(state));
			const before = structuredClone(target.getState());
			target.dispose();
			target.dispose();
			const notificationCount = states.length;
			expect(target.getState()).toEqual(before);
			expect(() => {
				switch (operation) {
					case "observeInput":
						target.observeInput({ atMs: 130, kind: "typing" });
						break;
					case "recordChange":
						append(target, "bad", 130);
						break;
					case "closeEdit":
						target.closeEdit();
						break;
					case "collect":
						target.collect();
						break;
					case "acknowledge":
						target.acknowledge(receipt(batch));
						break;
					case "subscribe":
						target.subscribe((state) => states.push(state));
						break;
				}
			}).toThrow();
			target.dispose();
			expect(target.getState()).toEqual(before);
			expect(states).toHaveLength(notificationCount);
		});
	}
});
