import { expect, test } from "@playwright/test";
import fc from "fast-check";
import {
	parseCheckpoint,
	validCheckpointState,
} from "@/services/answer-edits/checkpoint";
import { decodeEdits, replayEdits } from "@/services/answer-edits/codec";
import {
	AnswerEditMonitor,
	type BatchReceipt,
	type MonitorCheckpoint,
	type PendingEditBatch,
} from "@/services/answer-edits/monitor";

function monitor() {
	return new AnswerEditMonitor({
		initialText: "seed",
		sessionId: "original-session",
		baseRevision: 4,
		firstSeq: 12,
		now: () => 10_000,
	});
}

function append(target: AnswerEditMonitor, text: string, atMs: number) {
	const input = target.observeInput({ atMs, kind: "typing" });
	target.recordChange({
		atMs,
		kind: "typing",
		input,
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

/// Mutable view of the fields a parsed JSON checkpoint exposes to the corruption table.
interface CorruptibleState {
	baseRevision: number;
	receipts: [
		{ batchId: string; revision: number; lastSeq: number },
		...{ batchId: string; revision: number; lastSeq: number }[],
	];
	inFlight: { snapshot: string; batchId: string; baseRevision: number };
	active: {
		lastAtMs: number;
		openEdit: { lastAtMs: number };
	};
}

function jsonCheckpoint(target: AnswerEditMonitor): MonitorCheckpoint {
	return JSON.parse(JSON.stringify(target.exportCheckpoint()));
}

function restore(target: AnswerEditMonitor, sessionId: string, origin = 0) {
	return AnswerEditMonitor.restore({
		checkpoint: jsonCheckpoint(target),
		now: () => origin,
		createSessionId: () => sessionId,
	});
}

function expectDeepFrozen(value: unknown) {
	if (value === null || typeof value !== "object") return;
	expect(Object.isFrozen(value)).toBe(true);
	for (const nested of Object.values(value)) expectDeepFrozen(nested);
}

function overwriteJsonLeaves(value: unknown) {
	if (value === null || typeof value !== "object") return;
	expect(Object.isFrozen(value)).toBe(false);
	for (const [key, nested] of Object.entries(value)) {
		if (nested !== null && typeof nested === "object")
			overwriteJsonLeaves(nested);
		else expect(Reflect.set(value, key, null)).toBe(true);
	}
}

function expectBatch(
	batch: Readonly<PendingEditBatch>,
	expected: {
		sessionId: string;
		origin: number;
		start: number;
		baseRevision: number;
		firstSeq: number;
		before: string;
		after: string;
	},
) {
	expect(batch).toMatchObject({
		sessionId: expected.sessionId,
		timeOriginMs: expected.origin,
		baseRevision: expected.baseRevision,
		firstSeq: expected.firstSeq,
		snapshot: expected.after,
	});
	expect(batch.edits).toHaveLength(1);
	expect(batch.edits[0]?.[0]).toBe(expected.start - expected.origin);
	expect(decodeEdits(batch).map((edit) => edit.startMs)).toEqual([
		expected.start,
	]);
	expect(replayEdits(expected.before, batch)).toBe(expected.after);
}

test.describe("answer edit monitor checkpoints: export", () => {
	test("exports a deeply immutable JSON snapshot detached from subsequent changes and ACKs", () => {
		const target = monitor();
		append(target, "a", 10_010);
		const first = collect(target);
		append(target, "b", 10_020);
		const checkpoint = target.exportCheckpoint();
		const serialized = JSON.stringify(checkpoint);
		expect(checkpoint.version).toBe(3);
		expect(JSON.parse(serialized)).toEqual(checkpoint);
		expectDeepFrozen(checkpoint);
		expect(Reflect.set(checkpoint, "version", 99)).toBe(false);
		expect(Reflect.set(checkpoint, "state", null)).toBe(false);
		target.acknowledge(receipt(first));
		append(target, "c", 10_030);
		target.acknowledge(receipt(collect(target)));
		expect(JSON.stringify(checkpoint)).toBe(serialized);
		const restored = AnswerEditMonitor.restore({
			checkpoint: JSON.parse(serialized),
			now: () => 0,
			createSessionId: () => "detached-session",
		});
		expect(restored.getState().text).toBe("seedab");
		expect(collect(restored)).toEqual(first);
		restored.acknowledge(receipt(first));
		const second = collect(restored);
		expect(replayEdits(first.snapshot, second)).toBe("seedab");
		restored.acknowledge(receipt(second));
		expect(restored.collect()).toBeNull();
	});

	test("periodic exports during continuous typing preserve grouping, duration and cadence", () => {
		fc.assert(
			fc.property(
				fc.array(fc.integer({ min: 0, max: 1000 }), {
					minLength: 2,
					maxLength: 25,
				}),
				(gaps) => {
					const actual = monitor();
					const control = monitor();
					let atMs = 10_000;
					for (const gap of gaps) {
						atMs += gap;
						for (const target of [actual, control]) append(target, "x", atMs);
						const before = structuredClone(actual.getState());
						actual.exportCheckpoint();
						actual.exportCheckpoint();
						expect(actual.getState()).toEqual(before);
					}
					const batch = collect(actual);
					const expected = collect(control);
					expect(batch).toEqual(expected);
					expect(decodeEdits(batch)).toHaveLength(1);
					expect(decodeEdits(batch)[0]?.timing?.[0]).toBe(gaps.length - 1);
					expect(replayEdits("seed", batch)).toBe(
						`seed${"x".repeat(gaps.length)}`,
					);
				},
			),
			{ seed: 20260719, numRuns: 50 },
		);
	});

	test("export between observation and change does not consume an intention or reset cadence", () => {
		const actual = monitor();
		const control = monitor();
		const tokens = [actual, control].map((target) => {
			append(target, "a", 10_010);
			return target.observeInput({ atMs: 10_030, kind: "typing" });
		});
		actual.exportCheckpoint();
		for (const [index, target] of [actual, control].entries()) {
			target.recordChange({
				atMs: 10_080,
				input: tokens[index],
				kind: "typing",
				replacements: [{ position: 5, deleteCount: 0, insertedText: "b" }],
			});
		}
		const batch = collect(actual);
		expect(batch).toEqual(collect(control));
		expect(decodeEdits(batch).map((edit) => edit.timing)).toEqual([[1, 20, 0]]);
	});

	for (const inFlight of [false, true]) {
		test(`export after dispose transfers pending changes with in-flight batch ${inFlight}`, () => {
			const target = monitor();
			append(target, "a", 10_010);
			const first = inFlight ? collect(target) : null;
			if (inFlight) append(target, "b", 10_020);
			const before = structuredClone(target.getState());
			target.dispose();
			target.dispose();
			expectDeepFrozen(target.exportCheckpoint());
			const restored = restore(target, "after-dispose");
			expect(target.getState()).toEqual(before);
			expect(restored.getState().text).toBe(before.text);
			let text = "seed";
			let batch = restored.collect();
			if (first) expect(batch).toEqual(first);
			while (batch !== null) {
				text = replayEdits(text, batch);
				expect(text).toBe(batch.snapshot);
				restored.acknowledge(receipt(batch));
				batch = restored.collect();
			}
			expect(text).toBe(before.text);
			expect(restored.getState().hasPendingChanges).toBe(false);
		});
	}
});

test.describe("answer edit monitor checkpoints: validation", () => {
	const corruptions: [string, (checkpoint: MonitorCheckpoint) => unknown][] = [
		["null checkpoint", () => null],
		["unknown version", (checkpoint) => ({ ...checkpoint, version: 99 })],
		["truncated state", (checkpoint) => ({ ...checkpoint, state: {} })],
	];

	for (const [name, corrupt] of corruptions) {
		test(`rejects ${name} atomically without mutating the JSON argument or source monitor`, () => {
			const target = monitor();
			append(target, "a", 10_010);
			const first = collect(target);
			append(target, "b", 10_020);
			const original = JSON.stringify(target.exportCheckpoint());
			const candidate = JSON.parse(
				JSON.stringify(corrupt(jsonCheckpoint(target))),
			);
			const before = structuredClone(candidate);
			expect(() =>
				AnswerEditMonitor.restore({
					checkpoint: candidate as MonitorCheckpoint,
					now: () => 0,
					createSessionId: () => "rejected-session",
				}),
			).toThrow();
			expect(candidate).toEqual(before);
			expect(JSON.stringify(target.exportCheckpoint())).toBe(original);
			expect(target.collect()).toBe(first);
			target.acknowledge(receipt(first));
			append(target, "c", 10_030);
			const next = collect(target);
			// Retrying collect closes b even while returning the original batch;
			// c therefore starts a separate edit after the ACK.
			const edits = decodeEdits(next);
			expect(edits).toHaveLength(2);
			expect(edits.map((edit) => edit.startMs)).toEqual([10_020, 10_030]);
			expect(replayEdits(first.snapshot, next)).toBe("seedabc");
			const recovered = restore(target, "valid-after-rejection");
			expect(collect(recovered)).toEqual(next);
		});
	}

	/// Each corruption keeps the shape valid and breaks exactly one consistency rule.
	const inconsistencies: [string, (state: CorruptibleState) => void][] = [
		[
			"an in-flight snapshot that differs from its replay",
			(state) => {
				state.inFlight.snapshot = "tampered";
			},
		],
		[
			"an in-flight batch identifier from another sequence",
			(state) => {
				state.inFlight.batchId = "original-session:999";
			},
		],
		[
			"an in-flight batch behind the confirmed counters",
			(state) => {
				state.inFlight.baseRevision -= 1;
			},
		],
		[
			"a duplicate receipt",
			(state) => {
				state.receipts.push({ ...state.receipts[0] });
			},
		],
		[
			"a receipt ahead of the confirmed revision",
			(state) => {
				state.receipts[0].revision = state.baseRevision + 1;
			},
		],
		[
			"a receipt whose batch identifier has no sequence",
			(state) => {
				state.receipts[0].batchId = "original-session";
			},
		],
		[
			"an open edit whose duration disagrees with its last event",
			(state) => {
				state.active.openEdit.lastAtMs += 5;
				state.active.lastAtMs += 5;
			},
		],
	];
	for (const [name, corrupt] of inconsistencies) {
		test(`rejects ${name}`, () => {
			const target = monitor();
			append(target, "a", 10_010);
			target.acknowledge(receipt(collect(target)));
			append(target, "b", 10_020);
			collect(target);
			append(target, "c", 10_030);
			const checkpoint = jsonCheckpoint(target);
			expect(parseCheckpoint(checkpoint).text).toBe("seedabc");
			corrupt(checkpoint.state as CorruptibleState);
			expect(() => parseCheckpoint(checkpoint)).toThrow(
				/Invalid monitor checkpoint/,
			);
		});
	}

	for (const now of [-1, Number.NaN]) {
		test(`rejects restore clock ${now} without changing checkpoint or source`, () => {
			const target = monitor();
			append(target, "a", 10_010);
			const checkpoint = jsonCheckpoint(target);
			const before = structuredClone(checkpoint);
			expect(() =>
				AnswerEditMonitor.restore({
					checkpoint,
					now: () => now,
					createSessionId: () => "invalid-clock",
				}),
			).toThrow();
			expect(checkpoint).toEqual(before);
			expect(jsonCheckpoint(target)).toEqual(before);
			expect(replayEdits("seed", collect(restore(target, "valid-clock")))).toBe(
				"seeda",
			);
		});
	}

	for (const sessionId of ["", "original-session", "middle-session"]) {
		test(`rejects empty or historical injected session ID ${JSON.stringify(sessionId)}`, () => {
			const original = monitor();
			append(original, "a", 10_010);
			const middle = restore(original, "middle-session");
			append(middle, "b", 10);
			const checkpoint = jsonCheckpoint(middle);
			const before = structuredClone(checkpoint);
			expect(() =>
				AnswerEditMonitor.restore({
					checkpoint,
					now: () => 0,
					createSessionId: () => sessionId,
				}),
			).toThrow();
			expect(checkpoint).toEqual(before);
			expect(jsonCheckpoint(middle)).toEqual(before);
		});
	}

	test("restore does not transfer pending observations to the new session", () => {
		const original = monitor();
		append(original, "a", 10_010);
		const token = original.observeInput({ atMs: 10_020, kind: "typing" });
		const restored = restore(original, "restored-session", 10_020);
		expect(() =>
			restored.recordChange({
				atMs: 10_030,
				kind: "typing",
				input: token,
				replacements: [{ position: 5, deleteCount: 0, insertedText: "b" }],
			}),
		).toThrow();
		expect(restored.getState().text).toBe("seeda");
		const fresh = restored.observeInput({ atMs: 10_030, kind: "typing" });
		expect(fresh).not.toBe(token);
	});

	test("checkpoint carries only text, pending work and a bounded receipt list", () => {
		let target = monitor();
		for (let index = 1; index <= 200; index++) {
			append(target, "x", 10_000 + index);
			const batch = collect(target);
			target.acknowledge(receipt(batch));
			if (index % 50 === 0)
				target = restore(target, `session-${index}`, 10_000);
		}
		const state = JSON.stringify(target.exportCheckpoint());
		expect(state).not.toContain("observations");
		expect(state.length).toBeLessThan(8192);
		expect(target.collect()).toBeNull();
	});

	test("an acknowledgement older than the retained receipts is no longer a retry", () => {
		const target = monitor();
		const receipts: BatchReceipt[] = [];
		for (let index = 1; index <= 40; index++) {
			append(target, "x", 10_000 + index);
			const batch = collect(target);
			receipts.push(receipt(batch));
			target.acknowledge(receipts.at(-1) as BatchReceipt);
		}
		expect(() =>
			target.acknowledge(receipts[39] as BatchReceipt),
		).not.toThrow();
		expect(() => target.acknowledge(receipts[0] as BatchReceipt)).toThrow();
	});

	test("restore does not freeze or retain the caller's mutable JSON object", () => {
		const original = monitor();
		append(original, "a", 10_010);
		const checkpoint = jsonCheckpoint(original);
		const before = structuredClone(checkpoint);
		const restored = AnswerEditMonitor.restore({
			checkpoint,
			now: () => 0,
			createSessionId: () => "detached-input",
		});
		expect(checkpoint).toEqual(before);
		expect(Object.isFrozen(checkpoint)).toBe(false);
		overwriteJsonLeaves(checkpoint.state);
		expect(Reflect.set(checkpoint, "state", null)).toBe(true);
		append(restored, "b", 10);
		const first = collect(restored);
		expect(replayEdits("seed", first)).toBe("seeda");
		restored.acknowledge(receipt(first));
		expect(replayEdits(first.snapshot, collect(restored))).toBe("seedab");
		expect(jsonCheckpoint(original)).toEqual(before);
	});
});

test.describe("answer edit monitor checkpoints: reload and delivery", () => {
	test("sequence numbers count every tuple in a restored multipatch batch", () => {
		const target = monitor();
		target.recordChange({
			atMs: 10_025,
			kind: "other",
			replacements: [
				{ position: 0, deleteCount: 1, insertedText: "S" },
				{ position: 2, deleteCount: 1, insertedText: "E" },
				{ position: 4, deleteCount: 0, insertedText: "!" },
			],
		});
		const first = collect(target);
		expect(first.edits).toHaveLength(3);
		expect(replayEdits("seed", first)).toBe("SeEd!");
		append(target, "a", 10_050);
		const restored = restore(target, "multipatch-reload");
		append(restored, "b", 0);
		expect(collect(restored)).toEqual(first);
		restored.acknowledge(receipt(first));
		const old = collect(restored);
		expectBatch(old, {
			sessionId: "original-session",
			origin: 10_000,
			start: 10_050,
			baseRevision: 5,
			firstSeq: 15,
			before: "SeEd!",
			after: "SeEd!a",
		});
		restored.acknowledge(receipt(old));
		const fresh = collect(restored);
		expectBatch(fresh, {
			sessionId: "multipatch-reload",
			origin: 0,
			start: 0,
			baseRevision: 6,
			firstSeq: 16,
			before: "SeEd!a",
			after: "SeEd!ab",
		});
		restored.acknowledge(receipt(fresh));
		expect(restored.collect()).toBeNull();
	});

	test("multiple reloads preserve in-flight identity and drain old sessions before new ones with independent clocks", () => {
		const original = monitor();
		append(original, "p", 10_010);
		const past = collect(original);
		const pastReceipt = receipt(past);
		original.acknowledge(pastReceipt);
		append(original, "a", 10_040);
		const inFlight = collect(original);
		const savedBatch = structuredClone(inFlight);
		append(original, "b", 10_080);
		append(original, "c", 10_100);
		const second = restore(original, "second-session", 0);
		append(second, "d", 5);
		append(second, "e", 15);
		expect(collect(second)).toEqual(savedBatch);
		const third = restore(second, "third-session", 0);
		append(third, "f", 2);
		append(third, "g", 12);
		const fourth = restore(third, "fourth-session", 0);
		append(fourth, "h", 1);
		append(fourth, "i", 11);
		expect(fourth.getState().text).toBe("seedpabcdefghi");
		const beforeOldAck = structuredClone(fourth.getState());
		fourth.acknowledge({ ...pastReceipt });
		expect(fourth.getState()).toEqual(beforeOldAck);
		const retry = collect(fourth);
		expect(retry).toEqual(savedBatch);
		expect(collect(fourth)).toBe(retry);
		expectBatch(retry, {
			sessionId: "original-session",
			origin: 10_000,
			start: 10_040,
			baseRevision: 5,
			firstSeq: 13,
			before: "seedp",
			after: "seedpa",
		});
		fourth.acknowledge(receipt(retry));
		let text = retry.snapshot;
		let revision = 6;
		let seq = 14;
		const batches = [retry];
		for (const expected of [
			{
				sessionId: "original-session",
				origin: 10_000,
				start: 10_080,
				after: "seedpabc",
				timing: [1, 20, 0],
			},
			{
				sessionId: "second-session",
				origin: 0,
				start: 5,
				after: "seedpabcde",
				timing: [1, 10, 0],
			},
			{
				sessionId: "third-session",
				origin: 0,
				start: 2,
				after: "seedpabcdefg",
				timing: [1, 10, 0],
			},
			{
				sessionId: "fourth-session",
				origin: 0,
				start: 1,
				after: "seedpabcdefghi",
				timing: [1, 10, 0],
			},
		]) {
			const batch = collect(fourth);
			expectBatch(batch, {
				...expected,
				before: text,
				baseRevision: revision,
				firstSeq: seq,
			});
			expect(decodeEdits(batch).map((edit) => edit.timing)).toEqual([
				expected.timing,
			]);
			fourth.acknowledge({ ...pastReceipt });
			expect(fourth.collect()).toBe(batch);
			fourth.acknowledge(receipt(batch));
			batches.push(batch);
			text = batch.snapshot;
			revision++;
			seq += batch.edits.length;
		}
		expect(new Set(batches.map((batch) => batch.batchId)).size).toBe(
			batches.length,
		);
		for (const batch of [past, ...batches])
			fourth.acknowledge({ ...receipt(batch) });
		expect(fourth.collect()).toBeNull();
		expect(fourth.getState()).toEqual({
			text,
			hasPendingChanges: false,
			hasUnacknowledgedBatch: false,
		});
		append(fourth, "!", 21);
		const next = collect(fourth);
		expectBatch(next, {
			sessionId: "fourth-session",
			origin: 0,
			start: 21,
			baseRevision: revision,
			firstSeq: seq,
			before: text,
			after: `${text}!`,
		});
		fourth.acknowledge(receipt(next));
		expect(fourth.collect()).toBeNull();
		expect(original.collect()).toBe(inFlight);
		expect(original.getState().text).toBe("seedpabc");
	});

	test("restore with only an open edit closes it without adding events or mixing the new session", () => {
		const target = monitor();
		append(target, "a", 10_010);
		append(target, "b", 10_030);
		const restored = restore(target, "open-edit-session");
		append(restored, "c", 0);
		const old = collect(restored);
		expectBatch(old, {
			sessionId: "original-session",
			origin: 10_000,
			start: 10_010,
			baseRevision: 4,
			firstSeq: 12,
			before: "seed",
			after: "seedab",
		});
		expect(decodeEdits(old)).toEqual([
			{
				startMs: 10_010,
				durationMs: 20,
				position: 4,
				deleteCount: 0,
				insertedText: "ab",
				kind: "typing",
				timing: [1, 20, 0],
			},
		]);
		restored.acknowledge(receipt(old));
		const fresh = collect(restored);
		expectBatch(fresh, {
			sessionId: "open-edit-session",
			origin: 0,
			start: 0,
			baseRevision: 5,
			firstSeq: 13,
			before: "seedab",
			after: "seedabc",
		});
		expect(decodeEdits(fresh)[0]?.timing).toBeNull();
		restored.acknowledge(receipt(fresh));
		expect(restored.collect()).toBeNull();
	});

	for (const acknowledged of [false, true]) {
		test(`restore without pending changes keeps counters and historical receipts, previously acknowledged ${acknowledged}`, () => {
			const target = monitor();
			let previous: BatchReceipt | undefined;
			if (acknowledged) {
				append(target, "a", 10_010);
				previous = receipt(collect(target));
				target.acknowledge(previous);
			}
			const restored = restore(target, "clean-session", 1);
			expect(restored.collect()).toBeNull();
			expect(restored.getState()).toEqual(target.getState());
			if (previous) restored.acknowledge({ ...previous });
			append(restored, "!", 2);
			const batch = collect(restored);
			expectBatch(batch, {
				sessionId: "clean-session",
				origin: 1,
				start: 2,
				baseRevision: acknowledged ? 5 : 4,
				firstSeq: acknowledged ? 13 : 12,
				before: acknowledged ? "seeda" : "seed",
				after: acknowledged ? "seeda!" : "seed!",
			});
			if (previous) {
				restored.acknowledge({ ...previous });
				expect(restored.collect()).toBe(batch);
				expect(() =>
					restored.acknowledge({
						...previous,
						revision: previous.revision + 1,
					}),
				).toThrow();
			}
			restored.acknowledge(receipt(batch));
			expect(restored.collect()).toBeNull();
		});
	}

	test("a lost ACK retries the identical batch after JSON reload and accepts the delayed receipt idempotently", () => {
		const target = monitor();
		append(target, "a", 10_010);
		const sent = collect(target);
		const serverReceipt = receipt(sent);
		const restored = restore(target, "lost-ack-session");
		const retried = collect(restored);
		expect(retried).toEqual(sent);
		expect(replayEdits("seed", retried)).toBe("seeda");
		restored.acknowledge(serverReceipt);
		const reloaded = restore(restored, "after-lost-ack");
		reloaded.acknowledge({ ...serverReceipt });
		expect(reloaded.collect()).toBeNull();
		append(reloaded, "b", 0);
		const next = collect(reloaded);
		expectBatch(next, {
			sessionId: "after-lost-ack",
			origin: 0,
			start: 0,
			baseRevision: 5,
			firstSeq: 13,
			before: "seeda",
			after: "seedab",
		});
		reloaded.acknowledge({ ...serverReceipt });
		expect(reloaded.collect()).toBe(next);
		reloaded.acknowledge(receipt(next));
		expect(reloaded.collect()).toBeNull();
	});

	test("the default session factory produces distinct UUIDs across clean reloads", () => {
		let target = monitor();
		const sessions = new Set(["original-session"]);
		for (let index = 0; index < 3; index++) {
			target = AnswerEditMonitor.restore({
				checkpoint: jsonCheckpoint(target),
				now: () => 0,
			});
			append(target, "x", 0);
			const batch = collect(target);
			expect(batch.sessionId).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
			);
			expect(sessions.has(batch.sessionId)).toBe(false);
			sessions.add(batch.sessionId);
			target.acknowledge(receipt(batch));
		}
	});

	test("fractional clocks far from the origin survive collect, export, parse and restore", () => {
		fc.assert(
			fc.property(
				fc.double({ min: 300, max: 2300, noNaN: true }),
				fc.array(
					fc.record({
						gap: fc.double({ min: 0, max: 600_000, noNaN: true }),
						text: fc.constantFrom("a", "bc", "d"),
					}),
					{ minLength: 1, maxLength: 12 },
				),
				(origin, steps) => {
					const target = new AnswerEditMonitor({
						initialText: "",
						sessionId: "fractional-session",
						baseRevision: 0,
						firstSeq: 1,
						now: () => origin,
					});
					let atMs = origin + 60_000;
					for (const step of steps) {
						atMs += step.gap;
						append(target, step.text, atMs);
					}
					const text = target.getState().text;
					const batch = collect(target);
					const state = parseCheckpoint(jsonCheckpoint(target));
					expect(state.text).toBe(text);
					expect(Number.isSafeInteger(state.active.timeOriginMs)).toBe(true);
					for (const tuple of batch.edits)
						expect(Number.isSafeInteger(tuple[0])).toBe(true);
					const restored = AnswerEditMonitor.restore({
						checkpoint: jsonCheckpoint(target),
						now: () => 0,
						createSessionId: () => "fractional-restored",
					});
					expect(restored.getState().text).toBe(text);
					expect(restored.collect()).toEqual(batch);
				},
			),
			{ seed: 20261110, numRuns: 500 },
		);
	});

	test("rounding keeps event order and ties valid", () => {
		const target = new AnswerEditMonitor({
			initialText: "",
			sessionId: "rounding-session",
			baseRevision: 0,
			firstSeq: 1,
			now: () => 10.4,
		});
		append(target, "a", 10.6);
		append(target, "b", 10.6);
		append(target, "c", 11.4);
		const batch = collect(target);
		expect(batch.timeOriginMs).toBe(10);
		expect(batch.edits.map((tuple) => tuple[0])).toEqual([1]);
	});

	test("a checkpoint already validated and frozen is not validated again, but tampered copies are", () => {
		const target = monitor();
		append(target, "a", 10_010);
		const exported = target.exportCheckpoint() as {
			version: 3;
			state: { text: string };
		};
		const state = parseCheckpoint(exported);
		expect(state.text).toBe("seeda");
		expect(validCheckpointState(exported)).toBe(exported.state);
		const clone = JSON.parse(JSON.stringify(exported));
		clone.state.text = "tampered";
		expect(() => validCheckpointState(clone)).toThrow(TypeError);
		const unvalidated = JSON.parse(JSON.stringify(exported));
		expect(validCheckpointState(unvalidated)).not.toBe(unvalidated.state);
	});
});
