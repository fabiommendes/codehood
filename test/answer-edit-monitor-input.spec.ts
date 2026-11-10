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
		retentionNow: () => 1_800_000_000_000,
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
	id: string,
	atMs: number,
	replacement: TextReplacement,
	kind: InputKind = "typing",
) {
	target.observeInput({ id, atMs, kind });
	target.recordChange({
		...change(atMs, [replacement], kind),
		inputId: id,
		inputAtMs: atMs,
	});
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
		["fractional position", [patch(0.5, 0, "x")]],
		["unsafe position", [patch(Number.MAX_SAFE_INTEGER + 1, 0, "x")]],
		["nonfinite position", [patch(Number.NaN, 0, "x")]],
		["position beyond end", [patch(9, 0, "x")]],
		["negative deletion", [patch(0, -1)]],
		["fractional deletion", [patch(0, 0.5)]],
		["unsafe deletion", [patch(0, Number.MAX_SAFE_INTEGER + 1)]],
		["nonfinite deletion", [patch(0, Number.POSITIVE_INFINITY)]],
		["deletion beyond end", [patch(7, 1)]],
		["unsorted patches", [patch(4, 0, "X"), patch(1, 0, "Y")]],
		["overlapping patches", [patch(1, 3, "X"), patch(3, 1, "Y")]],
		["duplicate positions", [patch(1, 0, "X"), patch(1, 0, "Y")]],
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
				inputChange(target, "first", 10, patch(6, 0, "g"));
				target.observeInput({ id: "second", atMs: 20, kind: "typing" });
			}
			expect(() =>
				actual.recordChange({
					atMs: 100,
					kind: "typing",
					inputId: "second",
					inputAtMs: 20,
					replacements,
				}),
			).toThrow();
			for (const target of [actual, control]) {
				target.recordChange({
					...change(20, [patch(7, 0, "h")]),
					inputId: "second",
					inputAtMs: 20,
				});
			}
			expect(collect(actual)).toEqual(collect(control));
		});
	}

	for (const atMs of [
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		-1,
		9,
	]) {
		for (const operation of ["observeInput", "recordChange"] as const) {
			test(`${operation} rejects time ${atMs} atomically after a change at 10`, () => {
				const actual = monitor();
				const control = monitor();
				for (const target of [actual, control])
					inputChange(target, "first", 10, patch(0, 0, "a"));
				expect(() => {
					if (operation === "observeInput")
						actual.observeInput({ id: "retry", atMs, kind: "typing" });
					else actual.recordChange(change(atMs, [patch(1, 0, "bad")]));
				}).toThrow();
				for (const target of [actual, control])
					inputChange(target, "retry", 20, patch(1, 0, "b"));
				expect(collect(actual)).toEqual(collect(control));
			});
		}
	}

	for (const operation of ["observeInput", "recordChange"] as const) {
		test(`${operation} cannot move behind an observation even without a document change`, () => {
			const target = monitor();
			target.observeInput({ id: "intent", atMs: 20, kind: "typing" });
			expect(() => {
				if (operation === "observeInput")
					target.observeInput({ id: "earlier", atMs: 19, kind: "typing" });
				else target.recordChange(change(19, [patch(0, 0, "bad")]));
			}).toThrow();
			target.recordChange({
				...change(20, [patch(0, 0, "ok")]),
				inputId: "intent",
				inputAtMs: 20,
			});
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
			for (const target of [actual, control])
				target.observeInput({ id: "known", atMs: 20, kind: "typing" });
			const invalid = {
				atMs: association === "future observation" ? 19 : 100,
				kind:
					association === "different kind"
						? ("delete" as const)
						: ("typing" as const),
				inputId: association === "unknown" ? "missing" : "known",
				inputAtMs: 20,
				replacements: [patch(0, 0, "bad")],
			};
			expect(() => actual.recordChange(invalid)).toThrow();
			for (const target of [actual, control])
				target.recordChange({
					...change(20, [patch(0, 0, "ok")]),
					inputId: "known",
					inputAtMs: 20,
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
		["", [patch(0, 0, "😀e\u0301\nאב")], "😀e\u0301\nאב"],
		["😀e\u0301\nאב", [patch(0, 7)], ""],
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
			inputChange(target, "a", 0, patch(0, 0, "a"));
			inputChange(target, "b", gap, patch(1, 0, "b"));
			expect(edits(target)).toHaveLength(count);
		});
	}

	test("contiguous pure typing combines into one replayable edit", () => {
		const target = monitor();
		inputChange(target, "a", 0, patch(0, 0, "😀"));
		inputChange(target, "b", 10, patch(2, 0, "e\u0301"));
		inputChange(target, "c", 20, patch(4, 0, "!"));
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
				"first",
				0,
				first,
				name === "noncontiguous deletion" ? "delete" : "typing",
			);
			inputChange(target, "second", 10, second, secondKind);
			expect(edits(target)).toHaveLength(2);
		});
	}

	for (const replacements of [
		[patch(3, 1), patch(2, 1)],
		[patch(0, 1), patch(0, 1)],
	] as const) {
		test(`contiguous deletions preserve replay ${JSON.stringify(replacements)}`, () => {
			const target = monitor("abcd");
			inputChange(target, "first", 0, replacements[0], "delete");
			inputChange(target, "second", 10, replacements[1], "delete");
			const batch = collect(target);
			expect(replayEdits("abcd", batch)).toBe(batch.snapshot);
			expect(batch.snapshot).toBe(replacements[0].position === 3 ? "ab" : "cd");
		});
	}

	test("closeEdit prevents otherwise contiguous typing from merging", () => {
		const target = monitor();
		inputChange(target, "first", 0, patch(0, 0, "a"));
		target.closeEdit();
		inputChange(target, "second", 10, patch(1, 0, "b"));
		expect(edits(target)).toHaveLength(2);
	});

	test("collect emits an active edit without an explicit closeEdit", () => {
		const target = monitor();
		inputChange(target, "first", 0, patch(0, 0, "a"));
		expect(edits(target).map((edit) => edit.insertedText)).toEqual(["a"]);
	});

	for (const kind of ["paste", "undo", "redo", "composition"] as const) {
		test(`${kind} transactions stay isolated even when contiguous`, () => {
			const target = monitor();
			inputChange(target, "first", 0, patch(0, 0, "a"), kind);
			inputChange(target, "second", 10, patch(1, 0, "b"), kind);
			expect(
				edits(target).map((edit) => [edit.kind, edit.insertedText]),
			).toEqual([
				[kind, "a"],
				[kind, "b"],
			]);
		});
	}

	test("multi-patch transactions do not merge with adjacent typing", () => {
		const target = monitor("abcd");
		inputChange(target, "first", 0, patch(4, 0, "e"));
		target.recordChange(change(10, [patch(0, 1, "A"), patch(4, 1, "E")]));
		inputChange(target, "last", 20, patch(5, 0, "!"));
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
		target.observeInput({ id: "typing", atMs: 0, kind: "typing" });
		target.observeInput({ id: "paste", atMs: 100, kind: "paste" });
		expect(target.collect()).toBeNull();
		target.recordChange(change(100, [patch(9, 0, "!")], "other"));
		expect(collect(target).snapshot).toBe("unchanged!");
	});

	for (const consumed of [false, true]) {
		test(`input IDs reject repetition ${consumed ? "after consumption" : "while pending"}`, () => {
			const target = monitor();
			target.observeInput({ id: "unique", atMs: 0, kind: "typing" });
			if (consumed)
				target.recordChange({
					...change(0, [patch(0, 0, "a")]),
					inputId: "unique",
					inputAtMs: 0,
				});
			expect(() =>
				target.observeInput({ id: "unique", atMs: 10, kind: "typing" }),
			).toThrow();
		});
	}

	test("a consumed observation cannot be reused by another change", () => {
		const target = monitor();
		inputChange(target, "used", 0, patch(0, 0, "a"));
		expect(() =>
			target.recordChange({
				...change(10, [patch(1, 0, "bad")]),
				inputId: "used",
				inputAtMs: 0,
			}),
		).toThrow();
		inputChange(target, "fresh", 10, patch(1, 0, "b"));
		expect(collect(target).snapshot).toBe("ab");
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
				inputChange(target, `event-${index}`, atMs, patch(index, 0, "x"));
			}
			const decoded = edits(target);
			expect(decoded).toHaveLength(1);
			expect(expectDefined(decoded[0]).timing).toEqual(timing);
		});
	}

	test("contiguous deletes retain valid cadence if grouped and no samples if isolated", () => {
		const target = monitor("abc");
		inputChange(target, "first", 0, patch(0, 1), "delete");
		inputChange(target, "second", 100, patch(0, 1), "delete");
		expect([[[1, 100, 0]], [null, null]]).toContainEqual(
			edits(target).map((edit) => edit.timing),
		);
	});

	test("cadence uses observation timestamps rather than delayed change timestamps", () => {
		const target = monitor();
		target.observeInput({ id: "first", atMs: 0, kind: "typing" });
		target.recordChange({
			...change(40, [patch(0, 0, "a")]),
			inputId: "first",
			inputAtMs: 0,
		});
		target.observeInput({ id: "second", atMs: 100, kind: "typing" });
		target.recordChange({
			...change(190, [patch(1, 0, "b")]),
			inputId: "second",
			inputAtMs: 100,
		});
		expect(expectDefined(edits(target)[0]).timing).toEqual([1, 100, 0]);
	});

	test("unapplied and no-op intentions do not contribute cadence samples", () => {
		const target = monitor();
		inputChange(target, "first", 0, patch(0, 0, "a"));
		target.observeInput({ id: "unapplied", atMs: 20, kind: "typing" });
		target.observeInput({ id: "noop", atMs: 30, kind: "typing" });
		target.recordChange({
			...change(30, [patch(1)]),
			inputId: "noop",
			inputAtMs: 30,
		});
		inputChange(target, "last", 100, patch(1, 0, "b"));
		expect(expectDefined(edits(target)[0]).timing).toEqual([1, 100, 0]);
	});

	for (const kind of ["typing", "delete", "composition"] as const) {
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
			inputChange(
				target,
				`composition-${index}`,
				atMs,
				patch(index, 0, "字"),
				"composition",
			);
		expect(edits(target).map((edit) => edit.timing)).toEqual([
			null,
			null,
			null,
		]);
	});

	test("a pause outside an edit is excluded from its cadence", () => {
		const target = monitor();
		for (const [index, atMs] of [0, 100, 1101, 1301].entries())
			inputChange(target, `event-${index}`, atMs, patch(index, 0, "x"));
		expect(edits(target).map((edit) => edit.timing)).toEqual([
			[1, 100, 0],
			[1, 200, 0],
		]);
	});

	test("a multi-patch intention never duplicates cadence across sequential edits", () => {
		const target = monitor("abcdef");
		inputChange(target, "first", 0, patch(6, 0, "g"));
		target.observeInput({ id: "transaction", atMs: 100, kind: "typing" });
		target.recordChange({
			...change(100, [patch(0, 1, "A"), patch(2, 1, "C"), patch(4, 1, "E")]),
			inputId: "transaction",
			inputAtMs: 100,
		});
		inputChange(target, "last", 200, patch(7, 0, "!"));
		const decoded = edits(target);
		expect(
			decoded.reduce((count, edit) => count + (edit.timing?.[0] ?? 0), 0),
		).toBeLessThanOrEqual(2);
		expect(
			decoded
				.slice(1, 4)
				.reduce((count, edit) => count + (edit.timing?.[0] ?? 0), 0),
		).toBeLessThanOrEqual(1);
	});
});
