import { expect, test } from "@playwright/test";
import fc from "fast-check";
import {
	decodeEdits,
	type InputKind,
	replayEdits,
	type TextReplacement,
} from "@/services/answer-edits/codec";
import {
	AnswerEditMonitor,
	type DocumentChange,
	type MonitorOptions,
} from "@/services/answer-edits/monitor";

function monitor(initialText = "", options: Partial<MonitorOptions> = {}) {
	return new AnswerEditMonitor({
		initialText,
		sessionId: "answer-input-session",
		baseRevision: 0,
		firstSeq: 0,
		now: () => 0,
		...options,
	});
}

function patch(
	position: number,
	deleteCount = 0,
	insertedText = "",
): TextReplacement {
	return { position, deleteCount, insertedText };
}

function change(
	atMs: number,
	replacements: readonly TextReplacement[],
	kind: InputKind = "typing",
): DocumentChange {
	return { atMs, replacements, kind };
}

function inputChange(
	target: AnswerEditMonitor,
	atMs: number,
	replacement: TextReplacement,
	kind: InputKind = "typing",
) {
	const input = target.observeInput({ atMs, kind });
	target.recordChange({ ...change(atMs, [replacement], kind), input });
}

function collect(target: AnswerEditMonitor) {
	const batch = target.collect();
	expect(batch).not.toBeNull();
	if (batch === null) throw new Error("Expected an edit batch");
	return batch;
}

function edits(target: AnswerEditMonitor) {
	return decodeEdits(collect(target));
}

function expectDefined<T>(value: T | undefined): T {
	expect(value).toBeDefined();
	if (value === undefined) throw new Error("Expected a defined value");
	return value;
}

test.describe("answer edit monitor input: atomic validation and replay", () => {
	const invalidPatches: readonly (readonly [
		string,
		readonly TextReplacement[],
	])[] = [
		["negative position", [patch(-1, 0, "x")]],
		["deletion beyond end", [patch(7, 1)]],
		["overlapping patches", [patch(1, 3, "X"), patch(3, 1, "Y")]],
		[
			"valid prefix followed by invalid patch",
			[patch(0, 1, "X"), patch(8, 1, "Y")],
		],
	];
	for (const [name, replacements] of invalidPatches) {
		test(`rejects ${name} without changing text, grouping, timing or consuming input`, () => {
			const actual = monitor("abcdef");
			const control = monitor("abcdef");
			for (const target of [actual, control]) {
				inputChange(target, 10, patch(6, 0, "g"));
			}
			const tokens = [actual, control].map((target) =>
				target.observeInput({ atMs: 20, kind: "typing" }),
			);
			expect(() =>
				actual.recordChange({
					atMs: 100,
					kind: "typing",
					input: tokens[0],
					replacements,
				}),
			).toThrow();
			for (const [index, target] of [actual, control].entries()) {
				target.recordChange({
					...change(20, [patch(7, 0, "h")]),
					input: tokens[index],
				});
			}
			expect(collect(actual)).toEqual(collect(control));
		});
	}

	for (const atMs of [Number.NaN, -1, 9]) {
		for (const operation of ["observeInput", "recordChange"] as const) {
			test(`${operation} rejects time ${atMs} atomically after a change at 10`, () => {
				const actual = monitor();
				const control = monitor();
				for (const target of [actual, control])
					inputChange(target, 10, patch(0, 0, "a"));
				expect(() => {
					if (operation === "observeInput")
						actual.observeInput({ atMs, kind: "typing" });
					else actual.recordChange(change(atMs, [patch(1, 0, "bad")]));
				}).toThrow();
				for (const target of [actual, control])
					inputChange(target, 20, patch(1, 0, "b"));
				expect(collect(actual)).toEqual(collect(control));
			});
		}
	}

	for (const operation of ["observeInput", "recordChange"] as const) {
		test(`${operation} cannot move behind an observation even without a document change`, () => {
			const target = monitor();
			const input = target.observeInput({ atMs: 20, kind: "typing" });
			expect(() => {
				if (operation === "observeInput")
					target.observeInput({ atMs: 19, kind: "typing" });
				else target.recordChange(change(19, [patch(0, 0, "bad")]));
			}).toThrow();
			target.recordChange({ ...change(20, [patch(0, 0, "ok")]), input });
			expect(collect(target).snapshot).toBe("ok");
		});
	}

	for (const association of [
		"unknown",
		"different kind",
		"future observation",
	] as const) {
		test(`rejects ${association} association without partial changes`, () => {
			const actual = monitor();
			const control = monitor();
			const tokens = [actual, control].map((target) =>
				target.observeInput({ atMs: 20, kind: "typing" }),
			);
			const invalid = {
				atMs: association === "future observation" ? 19 : 100,
				kind:
					association === "different kind"
						? ("delete" as const)
						: ("typing" as const),
				input: association === "unknown" ? "missing" : tokens[0],
				replacements: [patch(0, 0, "bad")],
			};
			expect(() => actual.recordChange(invalid)).toThrow();
			for (const [index, target] of [actual, control].entries())
				target.recordChange({
					...change(20, [patch(0, 0, "ok")]),
					input: tokens[index],
				});
			expect(collect(actual)).toEqual(collect(control));
		});
	}

	for (const replacements of [[], [patch(0)], [patch(0, 3, "abc")]]) {
		test(`no-op ${JSON.stringify(replacements)} does not generate edits`, () => {
			const target = monitor("abc");
			target.recordChange(change(0, replacements));
			expect(target.collect()).toBeNull();
		});
	}

	for (const [initialText, replacements, expected] of [
		[
			"A😀BCe\u0301Z",
			[patch(1, 2, "x"), patch(5, 2, "é"), patch(8, 0, "!")],
			"AxBCéZ!",
		],
		[
			"abcdef",
			[patch(0, 2, "X"), patch(2, 2, "YZ"), patch(6, 0, "!")],
			"XYZef!",
		],
	] as const) {
		test(`replays pre-transaction UTF-16 replacements ${JSON.stringify(replacements)}`, () => {
			const target = monitor(initialText);
			target.recordChange(change(0, replacements, "other"));
			const batch = collect(target);
			expect({
				snapshot: batch.snapshot,
				replay: replayEdits(initialText, batch),
				origin: batch.timeOriginMs,
			}).toEqual({ snapshot: expected, replay: expected, origin: 0 });
		});
	}

	test("replays seeded sequences of arbitrary UTF-16 replacements exactly", () => {
		const text = fc
			.array(fc.integer({ min: 0, max: 0xffff }), { maxLength: 12 })
			.map((units) => String.fromCharCode(...units));
		fc.assert(
			fc.property(
				text,
				fc.array(fc.tuple(fc.nat(), fc.nat(), text), {
					minLength: 1,
					maxLength: 40,
				}),
				(initialText, steps) => {
					const target = monitor(initialText);
					let expected = initialText;
					for (const [
						index,
						[positionSeed, deleteSeed, insertedText],
					] of steps.entries()) {
						const position = positionSeed % (expected.length + 1);
						const deleteCount = deleteSeed % (expected.length - position + 1);
						target.recordChange(
							change(
								index,
								[patch(position, deleteCount, insertedText)],
								"other",
							),
						);
						expected =
							expected.slice(0, position) +
							insertedText +
							expected.slice(position + deleteCount);
					}
					const batch = target.collect();
					if (batch === null) expect(expected).toBe(initialText);
					else
						expect({
							snapshot: batch.snapshot,
							replay: replayEdits(initialText, batch),
						}).toEqual({ snapshot: expected, replay: expected });
				},
			),
			{ seed: 20260718, numRuns: 100 },
		);
	});
});

test.describe("answer edit monitor input: grouping boundaries", () => {
	for (const [gap, count] of [
		[999, 1],
		[1000, 1],
		[1001, 2],
	] as const) {
		test(`typing pause of ${gap} ms produces ${count} edits`, () => {
			const target = monitor();
			inputChange(target, 0, patch(0, 0, "a"));
			inputChange(target, gap, patch(1, 0, "b"));
			expect(edits(target)).toHaveLength(count);
		});
	}

	test("contiguous pure typing combines into one replayable edit", () => {
		const target = monitor();
		inputChange(target, 0, patch(0, 0, "😀"));
		inputChange(target, 10, patch(2, 0, "e\u0301"));
		inputChange(target, 20, patch(4, 0, "!"));
		expect(edits(target)).toEqual([
			{
				startMs: 0,
				durationMs: 20,
				position: 0,
				deleteCount: 0,
				insertedText: "😀e\u0301!",
				kind: "typing",
				timing: [2, 10, 0],
			},
		]);
	});

	for (const [name, initialText, first, second, secondKind] of [
		["position jump", "abc", patch(3, 0, "x"), patch(0, 0, "y"), "typing"],
		["cause switch", "abc", patch(3, 0, "x"), patch(3, 1), "delete"],
		["noncontiguous deletion", "abcdef", patch(5, 1), patch(0, 1), "delete"],
	] as const) {
		test(`${name} closes the preceding edit`, () => {
			const target = monitor(initialText);
			inputChange(
				target,
				0,
				first,
				name === "noncontiguous deletion" ? "delete" : "typing",
			);
			inputChange(target, 10, second, secondKind);
			expect(edits(target)).toHaveLength(2);
		});
	}

	for (const replacements of [
		[patch(3, 1), patch(2, 1)],
		[patch(0, 1), patch(0, 1)],
	] as const) {
		test(`contiguous deletions preserve replay ${JSON.stringify(replacements)}`, () => {
			const target = monitor("abcd");
			inputChange(target, 0, replacements[0], "delete");
			inputChange(target, 10, replacements[1], "delete");
			const batch = collect(target);
			expect(replayEdits("abcd", batch)).toBe(batch.snapshot);
			expect(batch.snapshot).toBe(replacements[0].position === 3 ? "ab" : "cd");
		});
	}

	test("closeEdit prevents otherwise contiguous typing from merging", () => {
		const target = monitor();
		inputChange(target, 0, patch(0, 0, "a"));
		target.closeEdit();
		inputChange(target, 10, patch(1, 0, "b"));
		expect(edits(target)).toHaveLength(2);
	});

	test("paste, undo, redo and composition transactions stay isolated even when contiguous", () => {
		for (const kind of ["paste", "undo", "redo", "composition"] as const) {
			const target = monitor();
			inputChange(target, 0, patch(0, 0, "a"), kind);
			inputChange(target, 10, patch(1, 0, "b"), kind);
			expect(
				edits(target).map((edit) => [edit.kind, edit.insertedText]),
				kind,
			).toEqual([
				[kind, "a"],
				[kind, "b"],
			]);
		}
	});

	test("multi-patch transactions do not merge with adjacent typing", () => {
		const target = monitor("abcd");
		inputChange(target, 0, patch(4, 0, "e"));
		target.recordChange(change(10, [patch(0, 1, "A"), patch(4, 1, "E")]));
		inputChange(target, 20, patch(5, 0, "!"));
		const batch = collect(target);
		expect({
			count: batch.edits.length,
			replay: replayEdits("abcd", batch),
		}).toEqual({ count: 4, replay: "AbcdE!" });
	});
});

test.describe("answer edit monitor input: intentions and timing", () => {
	test("observing intentions alone produces no edits", () => {
		const target = monitor("unchanged");
		target.observeInput({ atMs: 0, kind: "typing" });
		target.observeInput({ atMs: 100, kind: "paste" });
		expect(target.collect()).toBeNull();
		target.recordChange(change(100, [patch(9, 0, "!")], "other"));
		expect(collect(target).snapshot).toBe("unchanged!");
	});

	test("a token cannot be consumed twice", () => {
		const target = monitor();
		const used = target.observeInput({ atMs: 0, kind: "typing" });
		target.recordChange({ ...change(0, [patch(0, 0, "a")]), input: used });
		expect(() =>
			target.recordChange({ ...change(10, [patch(1, 0, "bad")]), input: used }),
		).toThrow();
		inputChange(target, 10, patch(1, 0, "b"));
		expect(collect(target).snapshot).toBe("ab");
	});

	test("a token from another session is rejected without mutation", () => {
		const foreign = monitor("", { sessionId: "other-session" });
		const token = foreign.observeInput({ atMs: 0, kind: "typing" });
		const target = monitor();
		expect(() =>
			target.recordChange({ ...change(0, [patch(0, 0, "x")]), input: token }),
		).toThrow();
		expect(target.getState().text).toBe("");
		expect(target.collect()).toBeNull();
	});

	test("only the latest pending observations stay associable", () => {
		const target = monitor();
		const first = target.observeInput({ atMs: 0, kind: "typing" });
		const tokens = Array.from({ length: 16 }, (_, index) =>
			target.observeInput({ atMs: index + 1, kind: "typing" }),
		);
		expect(() =>
			target.recordChange({ ...change(100, [patch(0, 0, "x")]), input: first }),
		).toThrow();
		target.recordChange({
			...change(100, [patch(0, 0, "x")]),
			input: tokens[0],
		});
		expect(target.getState().text).toBe("x");
	});

	test("equal timestamps stay valid however long the session lasts", () => {
		const target = monitor();
		for (const position of [0, 1]) {
			const input = target.observeInput({ atMs: 0, kind: "typing" });
			target.recordChange({
				...change(0, [patch(position, 0, "a")]),
				input,
			});
		}
		const pending = collect(target);
		expect(replayEdits("", pending)).toBe("aa");
		expect(pending.edits).toHaveLength(1);
		expect(pending.edits[0]?.[6]).toEqual([1, 0, 0]);
	});

	for (const [times, timing] of [
		[[0], null],
		[
			[0, 100],
			[1, 100, 0],
		],
		[
			[0, 100, 300, 600],
			[3, 200, 20000],
		],
		[
			[0, 0, 0],
			[2, 0, 0],
		],
	] as const) {
		test(`typing Welford statistics for event times ${times.join(",")}`, () => {
			const target = monitor();
			for (const [index, atMs] of times.entries()) {
				inputChange(target, atMs, patch(index, 0, "x"));
			}
			const decoded = edits(target);
			expect(decoded).toHaveLength(1);
			expect(expectDefined(decoded[0]).timing).toEqual(timing);
		});
	}

	test("contiguous deletes group and retain their cadence", () => {
		const target = monitor("abc");
		inputChange(target, 0, patch(0, 1), "delete");
		inputChange(target, 100, patch(0, 1), "delete");
		expect(edits(target).map((edit) => edit.timing)).toEqual([[1, 100, 0]]);
	});

	test("cadence uses observation timestamps rather than delayed change timestamps", () => {
		const target = monitor();
		const first = target.observeInput({ atMs: 0, kind: "typing" });
		target.recordChange({
			...change(40, [patch(0, 0, "a")]),
			input: first,
		});
		const second = target.observeInput({ atMs: 100, kind: "typing" });
		target.recordChange({
			...change(190, [patch(1, 0, "b")]),
			input: second,
		});
		expect(expectDefined(edits(target)[0]).timing).toEqual([1, 100, 0]);
	});

	test("unapplied and no-op intentions do not contribute cadence samples", () => {
		const target = monitor();
		inputChange(target, 0, patch(0, 0, "a"));
		target.observeInput({ atMs: 20, kind: "typing" });
		const noop = target.observeInput({ atMs: 30, kind: "typing" });
		target.recordChange({ ...change(30, [patch(1)]), input: noop });
		inputChange(target, 100, patch(1, 0, "b"));
		expect(expectDefined(edits(target)[0]).timing).toEqual([1, 100, 0]);
	});

	for (const kind of ["typing", "delete"] as const) {
		test(`unassociated ${kind} changes invent no cadence`, () => {
			const target = monitor("abcd");
			for (const atMs of [0, 10, 20])
				target.recordChange(
					change(
						atMs,
						[kind === "delete" ? patch(0, 1) : patch(0, 0, "x")],
						kind,
					),
				);
			expect(edits(target).every((edit) => edit.timing === null)).toBe(true);
		});
	}

	test("associated composition observations invent no cadence", () => {
		const target = monitor();
		for (const [index, atMs] of [0, 10, 20].entries())
			inputChange(target, atMs, patch(index, 0, "字"), "composition");
		expect(edits(target).map((edit) => edit.timing)).toEqual([
			null,
			null,
			null,
		]);
	});

	test("a pause outside an edit is excluded from its cadence", () => {
		const target = monitor();
		for (const [index, atMs] of [0, 100, 1101, 1301].entries())
			inputChange(target, atMs, patch(index, 0, "x"));
		expect(edits(target).map((edit) => edit.timing)).toEqual([
			[1, 100, 0],
			[1, 200, 0],
		]);
	});

	test("a multi-patch intention never duplicates cadence across sequential edits", () => {
		const target = monitor("abcdef");
		inputChange(target, 0, patch(6, 0, "g"));
		const transaction = target.observeInput({ atMs: 100, kind: "typing" });
		target.recordChange({
			...change(100, [patch(0, 1, "A"), patch(2, 1, "C"), patch(4, 1, "E")]),
			input: transaction,
		});
		inputChange(target, 200, patch(7, 0, "!"));
		const decoded = edits(target);
		expect(
			decoded.reduce((count, edit) => count + (edit.timing?.[0] ?? 0), 0),
		).toBeLessThanOrEqual(2);
		expect(decoded.slice(1, 4).map((edit) => edit.timing)).toEqual([
			null,
			null,
			null,
		]);
	});
});

test.describe("answer edit monitor input: observed pauses", () => {
	function delayedAppend(
		target: AnswerEditMonitor,
		text: string,
		observedAtMs: number,
		changedAtMs = observedAtMs,
	) {
		const input = target.observeInput({ atMs: observedAtMs, kind: "typing" });
		target.recordChange({
			...change(changedAtMs, [patch(target.getState().text.length, 0, text)]),
			input,
		});
	}

	test("timestamps beyond the safe integer range are rejected before they reach a checkpoint", () => {
		const target = monitor("", { pauseMs: 1e200 });
		expect(() => delayedAppend(target, "x", 1e200)).toThrow(/safe integer/);
		expect(target.getState().text).toBe("");
		expect(() =>
			target.observeInput({ atMs: 2 ** 53, kind: "typing" }),
		).toThrow(/safe integer/);
	});

	test("an observed 2000 ms pause closes delayed typing even when document changes are only 1000 ms apart", () => {
		const target = monitor();
		delayedAppend(target, "a", 0, 1000);
		delayedAppend(target, "b", 2000, 2000);
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
			delayedAppend(target, "a", 1, 1000);
			delayedAppend(target, "b", 1 + observedGap);
			const batch = collect(target);
			expect(decodeEdits(batch).map((edit) => edit.timing)).toEqual(
				expectedTimings,
			);
			expect(replayEdits("", batch)).toBe("ab");
		});
	}
});
