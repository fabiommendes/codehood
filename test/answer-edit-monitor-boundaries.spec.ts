import { expect, test } from "@playwright/test";
import { decodeEdits, replayEdits } from "@/services/answer-edits/codec";
import {
	AnswerEditMonitor,
	type MonitorCheckpoint,
	type PendingEditBatch,
} from "@/services/answer-edits/monitor";

function monitor(pauseMs = 1000) {
	return new AnswerEditMonitor({
		initialText: "",
		sessionId: "boundary-session",
		baseRevision: 0,
		firstSeq: 0,
		pauseMs,
		now: () => 0,
		retentionNow: () => 1_800_000_000_000,
	});
}

function append(
	target: AnswerEditMonitor,
	text: string,
	observedAtMs: number,
	changedAtMs = observedAtMs,
) {
	const position = target.getState().text.length;
	const inputId = `input-${position}`;
	target.observeInput({ id: inputId, atMs: observedAtMs, kind: "typing" });
	target.recordChange({
		atMs: changedAtMs,
		kind: "typing",
		inputId,
		inputAtMs: observedAtMs,
		replacements: [{ position, deleteCount: 0, insertedText: text }],
	});
}

function collect(target: AnswerEditMonitor) {
	const batch = target.collect();
	expect(batch).not.toBeNull();
	if (batch === null) throw new Error("Expected an edit batch");
	return batch;
}

function expectFiniteNumbers(value: unknown) {
	if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
	else if (value !== null && typeof value === "object")
		for (const nested of Object.values(value)) expectFiniteNumbers(nested);
}

function restore(target: AnswerEditMonitor, sessionId: string) {
	const checkpoint = target.exportCheckpoint();
	expectFiniteNumbers(checkpoint);
	const json: MonitorCheckpoint = JSON.parse(JSON.stringify(checkpoint));
	expect(json).toEqual(checkpoint);
	return AnswerEditMonitor.restore({
		checkpoint: json,
		now: () => 0,
		retentionNow: () => 1_800_000_000_000,
		createSessionId: () => sessionId,
	});
}

function expectOverflowSafeBatch(batch: Readonly<PendingEditBatch>) {
	expectFiniteNumbers(batch);
	const edits = decodeEdits(batch);
	expectFiniteNumbers(edits);
	expect(edits.length).toBeGreaterThanOrEqual(2);
	expect(batch.snapshot).toBe("xxx");
	expect(replayEdits("", batch)).toBe("xxx");
	expect(edits.map((edit) => edit.insertedText).join("")).toBe("xxx");
	expect(
		edits.reduce((samples, edit) => samples + (edit.timing?.[0] ?? 0), 0),
	).toBe(3 - edits.length);
	for (const edit of edits) {
		expect(edit.kind).toBe("typing");
		if (edit.timing !== null) {
			expect(edit.timing[0]).toBe(1);
			expect([0, 1e200]).toContain(edit.timing[1]);
			expect(edit.timing[2]).toBe(0);
		}
	}
}

test.describe("answer edit monitor boundaries: finite cadence", () => {
	test("finite timestamps split an overflowing accumulator without losing typing or inventing samples", () => {
		const target = monitor(1e200);
		for (const atMs of [0, 0, 1e200]) append(target, "x", atMs);
		expect(target.getState().text).toBe("xxx");
		expectOverflowSafeBatch(collect(target));
	});

	test("overflow remains replayable through JSON checkpoints before collection and with an in-flight batch", () => {
		const target = monitor(1e200);
		for (const atMs of [0, 0, 1e200]) append(target, "x", atMs);
		const restored = restore(target, "before-collection-reload");
		expect(restored.getState().text).toBe("xxx");
		const batch = collect(restored);
		expectOverflowSafeBatch(batch);
		const retried = restore(restored, "in-flight-reload");
		expect(retried.getState().text).toBe("xxx");
		const retry = collect(retried);
		expect(retry).toEqual(batch);
		expectOverflowSafeBatch(retry);
		retried.acknowledge({
			batchId: retry.batchId,
			revision: retry.baseRevision + 1,
			lastSeq: retry.firstSeq + retry.edits.length - 1,
		});
		expect(retried.collect()).toBeNull();
		expect(retried.getState().text).toBe("xxx");
	});
});

test.describe("answer edit monitor boundaries: observed pauses", () => {
	test("an observed 2000 ms pause closes delayed typing even when document changes are only 1000 ms apart", () => {
		const target = monitor();
		append(target, "a", 0, 1000);
		append(target, "b", 2000, 2000);
		const batch = collect(target);
		expect(decodeEdits(batch).map((edit) => edit.timing)).toEqual([null, null]);
		expect(replayEdits("", batch)).toBe("ab");
		expect(batch.snapshot).toBe("ab");
	});

	for (const [observedGap, expectedTimings] of [
		[999, [[1, 999, 0]]],
		[1000, [[1, 1000, 0]]],
		[1001, [null, null]],
	] as const) {
		test(`observed gap ${observedGap} ms respects the pause boundary despite a delayed first change`, () => {
			const target = monitor();
			append(target, "a", 1, 1000);
			append(target, "b", 1 + observedGap);
			const batch = collect(target);
			expect(decodeEdits(batch).map((edit) => edit.timing)).toEqual(
				expectedTimings,
			);
			expect(replayEdits("", batch)).toBe("ab");
		});
	}
});
