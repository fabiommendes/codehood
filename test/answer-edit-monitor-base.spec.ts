import { expect, test } from "@playwright/test";
import fc from "fast-check";
import { parseCheckpoint } from "@/services/answer-edits/checkpoint";
import { replayEdits } from "@/services/answer-edits/codec";
import {
	AnswerEditMonitor,
	type BatchReceipt,
	type MonitorCheckpoint,
	type PendingEditBatch,
} from "@/services/answer-edits/monitor";

function monitor(
	initialText: string,
	baseRevision: number,
	firstSeq = baseRevision === 0 ? 0 : 7,
) {
	return new AnswerEditMonitor({
		initialText,
		sessionId: "base-session",
		baseRevision,
		firstSeq,
		now: () => 0,
	});
}

function type(target: AnswerEditMonitor, text: string, atMs: number) {
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

function collect(target: AnswerEditMonitor): Readonly<PendingEditBatch> {
	const batch = target.collect();
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

/// The text a batch starts from: its explicit base, or the previous snapshot.
function startOf(batch: Readonly<PendingEditBatch>, previous: string): string {
	return batch.base ? batch.base.text : previous;
}

function roundTrip(checkpoint: MonitorCheckpoint): MonitorCheckpoint {
	return JSON.parse(JSON.stringify(checkpoint));
}

function reload(target: AnswerEditMonitor, sessionId: string) {
	return AnswerEditMonitor.restore({
		checkpoint: roundTrip(target.exportCheckpoint()),
		now: () => 0,
		createSessionId: () => sessionId,
	});
}

test.describe("answer edit monitor base: first batch of a field", () => {
	test("a monitor created at revision 0 sends its initial text as the start base", () => {
		const target = monitor("draft", 0);
		type(target, "!", 10);
		const batch = collect(target);
		expect(batch.base).toEqual({ reason: "start", text: "draft" });
		expect(batch.snapshot).toBe("draft!");
		expect(replayEdits(batch.base?.text ?? "", batch)).toBe(batch.snapshot);
	});

	test("an empty initial text is still an explicit start base", () => {
		const target = monitor("", 0);
		type(target, "hi", 10);
		expect(collect(target).base).toEqual({ reason: "start", text: "" });
	});

	test("a monitor created at a later revision sends no base key at all", () => {
		const target = monitor("draft", 3);
		type(target, "!", 10);
		const batch = collect(target);
		expect(Object.hasOwn(batch, "base")).toBe(false);
		expect(Object.keys(batch).sort()).toEqual([
			"baseRevision",
			"batchId",
			"edits",
			"firstSeq",
			"sessionId",
			"snapshot",
			"timeOriginMs",
			"version",
		]);
	});

	test("the base is deeply frozen and survives retries unchanged", () => {
		const target = monitor("abc", 0);
		type(target, "d", 10);
		const batch = collect(target);
		expect(Object.isFrozen(batch.base)).toBe(true);
		type(target, "e", 20);
		expect(target.collect()).toBe(batch);
	});

	test("only the first batch carries the start base; the acknowledgement removes the mark", () => {
		const target = monitor("abc", 0);
		type(target, "d", 10);
		const first = collect(target);
		type(target, "e", 20);
		target.acknowledge(receipt(first));
		const second = collect(target);
		expect(second.base).toBeUndefined();
		expect(Object.hasOwn(second, "base")).toBe(false);
		expect(second.baseRevision).toBe(1);
		expect(replayEdits(first.snapshot, second)).toBe(second.snapshot);
	});

	test("an unacknowledged first batch keeps its base on every collect", () => {
		const target = monitor("abc", 0);
		type(target, "d", 10);
		const first = collect(target);
		type(target, "e", 20);
		expect(collect(target).base).toEqual({ reason: "start", text: "abc" });
		expect(collect(target)).toBe(first);
	});

	test("an idempotent repeated receipt of the first batch does not bring the base back", () => {
		const target = monitor("abc", 0);
		type(target, "d", 10);
		const first = collect(target);
		target.acknowledge(receipt(first));
		target.acknowledge(receipt(first));
		type(target, "e", 20);
		expect(collect(target).base).toBeUndefined();
	});
});

test.describe("answer edit monitor base: rebase", () => {
	test("the first batch after a rebase carries the text the rebase kept", () => {
		const target = monitor("abc", 4);
		type(target, "d", 10);
		type(target, "e", 20);
		target.rebase({ baseRevision: 9, firstSeq: 40 });
		expect(target.collect()).toBeNull();
		type(target, "f", 30);
		const batch = collect(target);
		expect(batch.base).toEqual({ reason: "rebase", text: "abcde" });
		expect(batch.baseRevision).toBe(9);
		expect(batch.firstSeq).toBe(40);
		expect(batch.snapshot).toBe("abcdef");
		expect(replayEdits("abcde", batch)).toBe("abcdef");
		expect(replayEdits(batch.base?.text ?? "", batch)).toBe(batch.snapshot);
	});

	test("a rebase to revision 0 is a rebase base, not a start base", () => {
		const target = monitor("abc", 2);
		type(target, "d", 10);
		target.rebase({ baseRevision: 0, firstSeq: 0 });
		type(target, "e", 20);
		expect(collect(target).base).toEqual({ reason: "rebase", text: "abcd" });
	});

	test("a rebase after the start batch was acknowledged still marks the next batch", () => {
		const target = monitor("abc", 0);
		type(target, "d", 10);
		target.acknowledge(receipt(collect(target)));
		type(target, "e", 20);
		target.rebase({ baseRevision: 5, firstSeq: 3 });
		type(target, "f", 30);
		expect(collect(target).base).toEqual({ reason: "rebase", text: "abcde" });
	});

	test("a rebase with a batch in flight drops it and replaces the start base", () => {
		const target = monitor("abc", 0);
		type(target, "d", 10);
		const lost = collect(target);
		expect(lost.base?.reason).toBe("start");
		type(target, "e", 20);
		target.rebase({ baseRevision: 6, firstSeq: 11 });
		type(target, "f", 30);
		const batch = collect(target);
		expect(batch.base).toEqual({ reason: "rebase", text: "abcde" });
		expect(batch.batchId).not.toBe(lost.batchId);
		expect(replayEdits("abcde", batch)).toBe("abcdef");
	});

	test("two rebases before any edit leave the base at the latest text", () => {
		const target = monitor("abc", 4);
		type(target, "d", 10);
		target.rebase({ baseRevision: 5, firstSeq: 1 });
		type(target, "e", 20);
		target.rebase({ baseRevision: 8, firstSeq: 2 });
		type(target, "f", 30);
		const batch = collect(target);
		expect(batch.base).toEqual({ reason: "rebase", text: "abcde" });
		expect(replayEdits("abcde", batch)).toBe("abcdef");
	});

	test("after the rebase batch is acknowledged the next one has no base", () => {
		const target = monitor("abc", 4);
		target.rebase({ baseRevision: 9, firstSeq: 40 });
		type(target, "d", 10);
		const first = collect(target);
		target.acknowledge(receipt(first));
		type(target, "e", 20);
		expect(collect(target).base).toBeUndefined();
	});
});

test.describe("answer edit monitor base: adoptBase", () => {
	test("adopting a base never creates one", () => {
		const target = monitor("abc", 4);
		type(target, "d", 10);
		target.adoptBase({ baseRevision: 0, firstSeq: 0 });
		expect(collect(target).base).toBeUndefined();
	});

	test("adopting a nonzero revision drops the start base, since the server holds the text", () => {
		const target = monitor("abc", 0);
		type(target, "d", 10);
		target.adoptBase({ baseRevision: 3, firstSeq: 9 });
		const batch = collect(target);
		expect(batch.base).toBeUndefined();
		expect(batch.baseRevision).toBe(3);
		expect(replayEdits("abc", batch)).toBe("abcd");
	});

	test("adopting revision 0 keeps the start base", () => {
		const target = monitor("abc", 0);
		type(target, "d", 10);
		target.adoptBase({ baseRevision: 0, firstSeq: 0 });
		expect(collect(target).base).toEqual({ reason: "start", text: "abc" });
	});

	test("adopting keeps a pending rebase base", () => {
		const target = monitor("abc", 4);
		target.rebase({ baseRevision: 9, firstSeq: 40 });
		type(target, "d", 10);
		target.adoptBase({ baseRevision: 11, firstSeq: 44 });
		expect(collect(target).base).toEqual({ reason: "rebase", text: "abc" });
	});
});

test.describe("answer edit monitor base: checkpoint version 3", () => {
	test("exports version 3, with the mark only while a base is pending", () => {
		const target = monitor("abc", 0);
		expect(target.exportCheckpoint().version).toBe(3);
		const pending = parseCheckpoint(target.exportCheckpoint());
		expect(pending.baseReason).toBe("start");
		type(target, "d", 10);
		target.acknowledge(receipt(collect(target)));
		expect(parseCheckpoint(target.exportCheckpoint()).baseReason).toBeNull();
		target.rebase({ baseRevision: 5, firstSeq: 0 });
		expect(parseCheckpoint(target.exportCheckpoint()).baseReason).toBe(
			"rebase",
		);
	});

	test("a restored monitor sends the start base with edits that were not collected yet", () => {
		const original = monitor("abc", 0);
		type(original, "d", 10);
		type(original, "e", 20);
		const restored = reload(original, "second-session");
		type(restored, "f", 5);
		const first = collect(restored);
		expect(first.base).toEqual({ reason: "start", text: "abc" });
		expect(first.sessionId).toBe("base-session");
		expect(replayEdits("abc", first)).toBe(first.snapshot);
		restored.acknowledge(receipt(first));
		const second = collect(restored);
		expect(second.base).toBeUndefined();
		expect(replayEdits(first.snapshot, second)).toBe("abcdef");
	});

	test("a restored in-flight batch is identical to the one that was sent, base included", () => {
		const original = monitor("abc", 0);
		type(original, "d", 10);
		const sent = structuredClone(collect(original));
		const restored = reload(original, "second-session");
		expect(collect(restored)).toEqual(sent);
		expect(sent.base).toEqual({ reason: "start", text: "abc" });
	});

	test("a restored rebase mark and an in-flight rebase batch survive a reload", () => {
		const original = monitor("abc", 4);
		type(original, "d", 10);
		original.rebase({ baseRevision: 9, firstSeq: 40 });
		const pending = reload(original, "second-session");
		type(pending, "e", 5);
		const batch = structuredClone(collect(pending));
		expect(batch.base).toEqual({ reason: "rebase", text: "abcd" });
		const again = reload(pending, "third-session");
		expect(collect(again)).toEqual(batch);
		again.acknowledge(receipt(batch as PendingEditBatch));
		type(again, "f", 7);
		expect(collect(again).base).toBeUndefined();
	});

	test("a checkpoint of version 2 is refused with a TypeError, never anything else", () => {
		const exported = roundTrip(monitor("abc", 4).exportCheckpoint());
		const old = { ...exported, version: 2 };
		expect(() => parseCheckpoint(old)).toThrow(TypeError);
		expect(() =>
			AnswerEditMonitor.restore({
				checkpoint: old as unknown as MonitorCheckpoint,
				now: () => 0,
			}),
		).toThrow(TypeError);
	});

	test("a version 3 state without the mark is invalid", () => {
		const exported = roundTrip(monitor("abc", 4).exportCheckpoint()) as {
			version: 3;
			state: Record<string, unknown>;
		};
		delete exported.state.baseReason;
		expect(() => parseCheckpoint(exported)).toThrow(TypeError);
	});

	type Corruption = [
		name: string,
		corrupt: (checkpoint: {
			state: {
				baseReason: string | null;
				confirmedText: string;
				inFlight: {
					base?: { reason: string; text: string };
					snapshot: string;
				} | null;
			};
		}) => void,
	];
	const corruptions: Corruption[] = [
		["an in-flight base without the mark", (c) => (c.state.baseReason = null)],
		[
			"a mark that disagrees with the in-flight base reason",
			(c) => (c.state.baseReason = "rebase"),
		],
		[
			"an in-flight base text that is not the confirmed text",
			(c) => {
				if (c.state.inFlight?.base) c.state.inFlight.base.text = "other";
			},
		],
		[
			"an in-flight batch that lost its base while the mark is set",
			(c) => {
				if (c.state.inFlight) delete c.state.inFlight.base;
			},
		],
		[
			"an unknown base reason",
			(c) => {
				if (c.state.inFlight?.base) c.state.inFlight.base.reason = "x";
				c.state.baseReason = "x";
			},
		],
	];
	for (const [name, corrupt] of corruptions) {
		test(`rejects ${name}`, () => {
			const target = monitor("abc", 0);
			type(target, "d", 10);
			collect(target);
			const exported = roundTrip(target.exportCheckpoint());
			expect(() => parseCheckpoint(exported)).not.toThrow();
			corrupt(exported as never);
			expect(() => parseCheckpoint(exported)).toThrow(TypeError);
		});
	}

	test("rejects an in-flight batch carrying a base while no mark is pending", () => {
		const target = monitor("abc", 4);
		type(target, "d", 10);
		collect(target);
		const exported = roundTrip(target.exportCheckpoint()) as unknown as {
			state: { inFlight: Record<string, unknown> };
		};
		exported.state.inFlight.base = { reason: "start", text: "abc" };
		expect(() => parseCheckpoint(exported)).toThrow(TypeError);
	});

	test("rejects a batch whose snapshot does not follow from its base", () => {
		const target = monitor("abc", 0);
		type(target, "d", 10);
		collect(target);
		const exported = roundTrip(target.exportCheckpoint()) as unknown as {
			state: { inFlight: { snapshot: string } };
		};
		exported.state.inFlight.snapshot = "abcX";
		expect(() => parseCheckpoint(exported)).toThrow(TypeError);
	});
});

test.describe("answer edit monitor base: replay property", () => {
	const unit = fc.oneof(
		fc.integer({ min: 0, max: 0xffff }).map((n) => String.fromCharCode(n)),
		fc.constantFrom("a", "é", "\u{1F600}", "\u{1F468}‍\u{1F469}", "\n"),
	);
	const text = fc.array(unit, { maxLength: 6 }).map((units) => units.join(""));
	const step = fc.oneof(
		fc.record({
			op: fc.constant("edit" as const),
			position: fc.nat(),
			deleteCount: fc.nat(),
			insertedText: text,
		}),
		fc.constant({ op: "collect" as const }),
		fc.constant({ op: "ack" as const }),
		fc.constant({ op: "retry" as const }),
		fc.constant({ op: "rebase" as const }),
		fc.constant({ op: "reload" as const }),
	);

	test("applying a batch's edits to its base yields its snapshot and the reported text", () => {
		fc.assert(
			fc.property(
				text,
				fc.constantFrom(0, 3),
				fc.array(step, { minLength: 1, maxLength: 50 }),
				(initialText, baseRevision, steps) => {
					let target = monitor(initialText, baseRevision);
					let atMs = 0;
					let sessions = 0;
					let revision = baseRevision;
					let seq = baseRevision === 0 ? 0 : 7;
					/// The text the server holds after the last acknowledged batch.
					let confirmed = initialText;
					let inFlight: Readonly<PendingEditBatch> | null = null;
					let needsBase = baseRevision === 0;
					for (const item of steps) {
						switch (item.op) {
							case "edit": {
								const current = target.getState().text;
								const position = item.position % (current.length + 1);
								const deleteCount =
									item.deleteCount % (current.length - position + 1);
								atMs += 5;
								target.recordChange({
									atMs,
									kind: "other",
									replacements: [
										{
											position,
											deleteCount,
											insertedText: item.insertedText,
										},
									],
								});
								break;
							}
							case "collect":
							case "retry": {
								const batch = target.collect();
								if (batch === null) break;
								inFlight = batch;
								const start = startOf(batch, confirmed);
								expect(replayEdits(start, batch)).toBe(batch.snapshot);
								if (needsBase) expect(batch.base).toBeDefined();
								else expect(batch.base).toBeUndefined();
								break;
							}
							case "ack": {
								if (inFlight === null) break;
								target.acknowledge(receipt(inFlight));
								confirmed = inFlight.snapshot;
								revision = inFlight.baseRevision + 1;
								seq = inFlight.firstSeq + inFlight.edits.length;
								inFlight = null;
								needsBase = false;
								break;
							}
							case "rebase": {
								revision += 4;
								seq += 9;
								target.rebase({ baseRevision: revision, firstSeq: seq });
								confirmed = target.getState().text;
								inFlight = null;
								needsBase = true;
								break;
							}
							case "reload": {
								sessions += 1;
								target = reload(target, `reloaded-${sessions}`);
								break;
							}
						}
					}
					/// Draining every pending batch must land exactly on the reported text.
					for (let batch = target.collect(); batch; batch = target.collect()) {
						expect(replayEdits(startOf(batch, confirmed), batch)).toBe(
							batch.snapshot,
						);
						target.acknowledge(receipt(batch));
						confirmed = batch.snapshot;
					}
					expect(confirmed).toBe(target.getState().text);
				},
			),
			{ seed: 20261112, numRuns: 200 },
		);
	});
});
