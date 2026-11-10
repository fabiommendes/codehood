import { expect, test } from "@playwright/test";
import { decodeEdits, replayEdits } from "@/services/answer-edits/codec";
import {
	AnswerEditMonitor,
	type MonitorCheckpoint,
} from "@/services/answer-edits/monitor";

function monitor(pauseMs = 1000) {
	return new AnswerEditMonitor({
		initialText: "",
		sessionId: "boundary-session",
		baseRevision: 0,
		firstSeq: 0,
		pauseMs,
		now: () => 0,
	});
}

function append(
	target: AnswerEditMonitor,
	text: string,
	observedAtMs: number,
	changedAtMs = observedAtMs,
) {
	const position = target.getState().text.length;
	const input = target.observeInput({ atMs: observedAtMs, kind: "typing" });
	target.recordChange({
		atMs: changedAtMs,
		kind: "typing",
		input,
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

function _restore(target: AnswerEditMonitor, sessionId: string) {
	const checkpoint = target.exportCheckpoint();
	expectFiniteNumbers(checkpoint);
	const json: MonitorCheckpoint = JSON.parse(JSON.stringify(checkpoint));
	expect(json).toEqual(checkpoint);
	return AnswerEditMonitor.restore({
		checkpoint: json,
		now: () => 0,
		createSessionId: () => sessionId,
	});
}

test.describe("answer edit monitor boundaries: finite cadence", () => {
	test("timestamps beyond the safe integer range are rejected before they reach a checkpoint", () => {
		const target = monitor(1e200);
		expect(() => append(target, "x", 1e200)).toThrow(/safe integer/);
		expect(target.getState().text).toBe("");
		expect(() =>
			target.observeInput({ atMs: 2 ** 53, kind: "typing" }),
		).toThrow(/safe integer/);
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
