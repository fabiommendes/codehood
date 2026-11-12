/**
 * The pure computation behind the instructor's per-answer summary (spec
 * `dev/specs/to-review/historico-de-edicao-no-servidor.md`, R33 and R34). No
 * database: batches are assembled by hand and every expected number is
 * worked out in a comment, not by the algorithm under test.
 *
 * The spec gives no signature, so this file assumes the minimal one:
 *
 *   // src/services/answer-edits/summary.ts
 *   summarizeAnswerEdits({
 *     batches,     // of one field, in revision order
 *     markers,     // the field's AnswerEditGap rows: { reason, receivedAt }
 *     anchorText,  // AnswerEditField.text, or null when the field has no anchor
 *     answerText,  // text of the last Submission, or null when unanswered
 *     incomplete,  // a limit of R16 or R18 was reached for the field or the attempt
 *   }): {
 *     state: "complete" | "incomplete" | "none",
 *     activeMs: number,
 *     firstAt: Date | null,                 // receivedAt of the first batch
 *     lastAt: Date | null,                  // receivedAt of the last batch
 *     kinds: Record<InputKind, number>,     // edits per input kind
 *     pastes: { count: number, chars: number },
 *     largeInsertions: { kind: InputKind, length: number, receivedAt: Date }[],
 *     gaps: (
 *       | { type: "marker", reason: string, receivedAt: Date }
 *       | { type: "rebase", removed: number, inserted: number, receivedAt: Date }
 *       | { type: "final", removed: number, inserted: number }
 *     )[],
 *   }
 *
 * where a batch is { sessionId, timeOriginMs, edits (EditTuple[]),
 * receivedAt, baseReason: "start" | "rebase" | null, baseText: string | null,
 * gapBefore: string | null }, the columns of AnswerEditBatch.
 */
import { expect, test } from "@playwright/test";
import {
	type AnswerEdit,
	type EditTuple,
	encodeEdits,
	type InputKind,
} from "@/services/answer-edits/codec";
import { summarizeAnswerEdits } from "@/services/answer-edits/summary";

const AT = (minutes: number) =>
	new Date(Date.UTC(2026, 2, 1, 10, minutes, 0, 0));

function edit(
	startMs: number,
	durationMs: number,
	kind: InputKind,
	insertedText = "x",
	deleteCount = 0,
	position = 0,
): AnswerEdit {
	return {
		startMs,
		durationMs,
		kind,
		insertedText,
		deleteCount,
		position,
		timing: null,
	};
}

interface BatchOptions {
	session?: string;
	/// Defaults to the start of the first edit.
	origin?: number;
	receivedAt?: Date;
	baseReason?: "start" | "rebase" | null;
	baseText?: string | null;
	gapBefore?: string | null;
}

function batch(edits: AnswerEdit[], options: BatchOptions = {}) {
	const origin = options.origin ?? edits[0]?.startMs ?? 0;
	return {
		sessionId: options.session ?? "s1",
		timeOriginMs: origin,
		edits: encodeEdits(edits, origin).edits as EditTuple[],
		receivedAt: options.receivedAt ?? AT(0),
		baseReason: options.baseReason ?? null,
		baseText: options.baseText ?? null,
		gapBefore: options.gapBefore ?? null,
	};
}

type Input = Parameters<typeof summarizeAnswerEdits>[0];

function summarize(input: Partial<Input> & Pick<Input, "batches">) {
	return summarizeAnswerEdits({
		markers: [],
		anchorText: null,
		answerText: null,
		incomplete: false,
		...input,
	});
}

/// Active time of one session of edits, each `[startMs, durationMs]`.
function activeOf(starts: [number, number][]) {
	return summarize({
		batches: [batch(starts.map(([s, d]) => edit(s, d, "typing")))],
	}).activeMs;
}

test.describe("R34: active time", () => {
	test("adds the gaps between consecutive starts and the duration of the last edit", () => {
		// 4000 - 0 + 10000 - 4000 = 10000, plus the last edit's 300; the 100 and 200 of the earlier edits do not count.
		expect(
			activeOf([
				[0, 100],
				[4000, 200],
				[10_000, 300],
			]),
		).toBe(10_300);
	});

	test("one edit is worth its own duration", () => {
		expect(activeOf([[5000, 750]])).toBe(750);
	});

	test("a history without batches has no active time", () => {
		expect(summarize({ batches: [] }).activeMs).toBe(0);
	});

	test("an interval of exactly 60 s counts in full", () => {
		// 60000 + the last duration 20.
		expect(
			activeOf([
				[0, 10],
				[60_000, 20],
			]),
		).toBe(60_020);
	});

	test("an interval just under 60 s counts as it is", () => {
		// 59999 + 20.
		expect(
			activeOf([
				[0, 10],
				[59_999, 20],
			]),
		).toBe(60_019);
	});

	test("an interval over 60 s is limited to 60 s", () => {
		// 60001 limited to 60000, + 20.
		expect(
			activeOf([
				[0, 10],
				[60_001, 20],
			]),
		).toBe(60_020);
		// Ten minutes, limited to 60000, + 20.
		expect(
			activeOf([
				[0, 10],
				[600_000, 20],
			]),
		).toBe(60_020);
	});

	test("each interval is limited on its own", () => {
		// 10000 (kept) + 60000 (130000 limited) + 5000 (kept), plus the last 8.
		expect(
			activeOf([
				[0, 1],
				[10_000, 1],
				[140_000, 1],
				[145_000, 8],
			]),
		).toBe(75_008);
	});

	test("sessions are summed apart: nothing counts between the end of one and the start of the next", () => {
		const a = batch([edit(0, 100, "typing"), edit(5000, 200, "typing")], {
			session: "a",
		});
		const b = batch(
			[edit(1_000_000, 50, "typing"), edit(1_002_000, 300, "typing")],
			{ session: "b" },
		);
		// Session a: 5000 + 200. Session b: 2000 + 300. Total 7500.
		expect(summarize({ batches: [a, b] }).activeMs).toBe(7500);
	});

	test("batches of one session continue each other, so the interval between them counts", () => {
		const one = batch([edit(0, 100, "typing"), edit(20_000, 100, "typing")]);
		const two = batch([edit(50_000, 700, "typing")]);
		// 20000 + 30000 across the batch boundary, plus the last duration 700.
		expect(summarize({ batches: [one, two] }).activeMs).toBe(50_700);
	});
});

test.describe("R34: first and last edit come from receivedAt", () => {
	test("are the arrival times of the first and of the last batch", () => {
		const batches = [
			batch([edit(0, 1, "typing")], { receivedAt: AT(5) }),
			batch([edit(10, 1, "typing")], { receivedAt: AT(6) }),
			batch([edit(20, 1, "typing")], { receivedAt: AT(40) }),
		];
		const summary = summarize({ batches });
		expect(summary.firstAt).toEqual(AT(5));
		expect(summary.lastAt).toEqual(AT(40));
	});

	test("one batch is both", () => {
		const summary = summarize({
			batches: [batch([edit(0, 1, "typing")], { receivedAt: AT(7) })],
		});
		expect(summary.firstAt).toEqual(AT(7));
		expect(summary.lastAt).toEqual(AT(7));
	});

	test("without batches there is no time to show", () => {
		const summary = summarize({ batches: [] });
		expect(summary.firstAt).toBeNull();
		expect(summary.lastAt).toBeNull();
	});
});

test.describe("R34: edits per input kind", () => {
	test("counts every edit under its kind, across batches", () => {
		const one = batch([
			edit(0, 1, "typing"),
			edit(1, 1, "typing"),
			edit(2, 1, "paste"),
		]);
		const two = batch(
			[
				edit(3, 1, "delete"),
				edit(4, 1, "typing"),
				edit(5, 1, "undo"),
				edit(6, 1, "delete"),
			],
			{ origin: 3 },
		);
		expect(summarize({ batches: [one, two] }).kinds).toEqual({
			typing: 3,
			paste: 1,
			delete: 2,
			undo: 1,
			redo: 0,
			composition: 0,
			other: 0,
		});
	});
});

test.describe("R34: pastes", () => {
	test("counts the paste edits and the characters they inserted", () => {
		const one = batch([
			edit(0, 1, "paste", "hello world"),
			edit(10, 1, "typing", "x"),
		]);
		const two = batch([edit(20, 1, "paste", "abc")]);
		// 2 pastes, 11 + 3 characters; the typed "x" is not a paste.
		expect(summarize({ batches: [one, two] }).pastes).toEqual({
			count: 2,
			chars: 14,
		});
	});

	test("a paste over a selection counts only what it inserted", () => {
		const summary = summarize({
			batches: [batch([edit(0, 1, "paste", "abc", 5)])],
		});
		expect(summary.pastes).toEqual({ count: 1, chars: 3 });
	});

	test("no paste, no count", () => {
		const summary = summarize({ batches: [batch([edit(0, 1, "typing")])] });
		expect(summary.pastes).toEqual({ count: 0, chars: 0 });
	});
});

test.describe("R34: large insertions", () => {
	const large = (length: number, kind: InputKind, start = 0) =>
		edit(start, 1, kind, "a".repeat(length));

	test("an insertion of exactly 100 UTF-16 units is large; 99 is not", () => {
		const summary = summarize({
			batches: [
				batch([large(99, "typing", 0), large(100, "typing", 1)], {
					receivedAt: AT(3),
				}),
			],
		});
		expect(summary.largeInsertions).toEqual([
			{ kind: "typing", length: 100, receivedAt: AT(3) },
		]);
	});

	test("any cause qualifies, and each entry carries the arrival time of its batch", () => {
		const one = batch([large(100, "paste", 0), large(120, "undo", 1)], {
			receivedAt: AT(1),
		});
		const two = batch([large(250, "composition", 10)], { receivedAt: AT(2) });
		expect(summarize({ batches: [one, two] }).largeInsertions).toEqual([
			{ kind: "paste", length: 100, receivedAt: AT(1) },
			{ kind: "undo", length: 120, receivedAt: AT(1) },
			{ kind: "composition", length: 250, receivedAt: AT(2) },
		]);
	});

	test("a paste of 100 units is both a paste and a large insertion", () => {
		const summary = summarize({ batches: [batch([large(100, "paste")])] });
		expect(summary.pastes).toEqual({ count: 1, chars: 100 });
		expect(summary.largeInsertions).toHaveLength(1);
	});

	test("the size is in UTF-16 units: 50 emoji outside the BMP are 100 units and large", () => {
		// "😀" is two units, so 50 of them are 100 units but only 50 code points.
		const summary = summarize({
			batches: [batch([edit(0, 1, "paste", "😀".repeat(50))])],
		});
		expect(summary.largeInsertions).toEqual([
			{ kind: "paste", length: 100, receivedAt: AT(0) },
		]);
	});

	test("49 emoji and one letter are 99 units and not large, though they are 50 code points", () => {
		const summary = summarize({
			batches: [batch([edit(0, 1, "paste", `${"😀".repeat(49)}a`)])],
		});
		expect(summary.largeInsertions).toEqual([]);
	});

	test("keeps at most 20, the first ones in the order of the history", () => {
		// Lengths 100 to 124 are 25 large insertions; the first 20 are 100 to 119.
		const edits = Array.from({ length: 25 }, (_, i) =>
			large(100 + i, "paste", i),
		);
		const lengths = summarize({
			batches: [batch(edits)],
		}).largeInsertions.map((entry) => entry.length);
		expect(lengths).toEqual(Array.from({ length: 20 }, (_, i) => 100 + i));
	});

	test("an edit that only deletes is not an insertion", () => {
		const summary = summarize({
			batches: [batch([edit(0, 1, "delete", "", 500)])],
		});
		expect(summary.largeInsertions).toEqual([]);
	});
});

test.describe("R34: gaps", () => {
	test("each marker is a gap with its reason and arrival time", () => {
		const summary = summarize({
			batches: [batch([edit(0, 1, "typing")])],
			markers: [
				{ reason: "input-lost", receivedAt: AT(4) },
				{ reason: "storage-full", receivedAt: AT(9) },
			],
		});
		expect(summary.gaps).toHaveLength(2);
		expect(summary.gaps).toEqual(
			expect.arrayContaining([
				{ type: "marker", reason: "input-lost", receivedAt: AT(4) },
				{ type: "marker", reason: "storage-full", receivedAt: AT(9) },
			]),
		);
		expect(summary.state).toBe("complete");
	});

	test("a rebase that lost text is a gap sized by the common prefix and suffix", () => {
		const summary = summarize({
			batches: [
				batch([edit(0, 1, "typing")]),
				batch([edit(10, 1, "typing")], {
					receivedAt: AT(8),
					baseReason: "rebase",
					gapBefore: "The quick brown fox",
					baseText: "The slow brown fox",
				}),
			],
		});
		// Prefix "The " (4), suffix " brown fox" (10): "quick" (5) left, "slow" (4) came.
		expect(summary.gaps).toEqual([
			{ type: "rebase", removed: 5, inserted: 4, receivedAt: AT(8) },
		]);
	});

	const deductions: [string, string, string, number, number][] = [
		["a pure insertion", "abc", "abXc", 0, 1],
		["a pure removal", "abXc", "abc", 1, 0],
		[
			"a suffix that must not overlap the prefix (insertion)",
			"aa",
			"aaa",
			0,
			1,
		],
		["a suffix that must not overlap the prefix (removal)", "aaa", "aa", 1, 0],
		["a repeated block removed", "abcabc", "abc", 3, 0],
		["nothing in common", "hello", "world", 5, 5],
		["everything removed", "x", "", 1, 0],
		["from an empty anchor", "", "text", 0, 4],
	];
	for (const [label, before, after, removed, inserted] of deductions) {
		test(`deduces ${label}: "${before}" to "${after}" is ${removed} out, ${inserted} in`, () => {
			const summary = summarize({
				batches: [
					batch([edit(0, 1, "typing")], {
						baseReason: "rebase",
						gapBefore: before,
						baseText: after,
					}),
				],
			});
			expect(summary.gaps).toEqual([
				{ type: "rebase", removed, inserted, receivedAt: AT(0) },
			]);
		});
	}

	test("a rebase with no gapBefore lost nothing and is no gap", () => {
		const summary = summarize({
			batches: [
				batch([edit(0, 1, "typing")], {
					baseReason: "rebase",
					baseText: "same text",
					gapBefore: null,
				}),
			],
		});
		expect(summary.gaps).toEqual([]);
	});

	test("the first batch of a field starts from its text and is no gap", () => {
		const summary = summarize({
			batches: [
				batch([edit(0, 1, "typing")], {
					baseReason: "start",
					baseText: "a draft the student had",
				}),
			],
		});
		expect(summary.gaps).toEqual([]);
	});

	test("an empty gapBefore is a gap, unlike a missing one", () => {
		const summary = summarize({
			batches: [
				batch([edit(0, 1, "typing")], {
					baseReason: "rebase",
					gapBefore: "",
					baseText: "text",
				}),
			],
		});
		expect(summary.gaps).toEqual([
			{ type: "rebase", removed: 0, inserted: 4, receivedAt: AT(0) },
		]);
	});

	test("a final gap appears when the anchor text differs from the last answer", () => {
		const summary = summarize({
			batches: [batch([edit(0, 1, "typing")])],
			anchorText: "hello world",
			answerText: "hello brave world",
		});
		// Prefix "hello " (6), suffix "world" (5): nothing out, "brave " (6) in.
		expect(summary.gaps).toEqual([{ type: "final", removed: 0, inserted: 6 }]);
	});

	test("a final gap counts what the answer lost as well", () => {
		const summary = summarize({
			batches: [batch([edit(0, 1, "typing")])],
			anchorText: "one two three",
			answerText: "one three",
		});
		// Prefix "one " (4), suffix "three" (5): "two " (4) out.
		expect(summary.gaps).toEqual([{ type: "final", removed: 4, inserted: 0 }]);
	});

	test("no final gap when the anchor holds the answer", () => {
		const summary = summarize({
			batches: [batch([edit(0, 1, "typing")])],
			anchorText: "same",
			answerText: "same",
		});
		expect(summary.gaps).toEqual([]);
	});

	test("no final gap while the question is unanswered or has no anchor", () => {
		const batches = [batch([edit(0, 1, "typing")])];
		expect(
			summarize({ batches, anchorText: "typed", answerText: null }).gaps,
		).toEqual([]);
		expect(
			summarize({ batches: [], anchorText: null, answerText: "saved" }).gaps,
		).toEqual([]);
	});

	test("all three kinds of gap show together", () => {
		const summary = summarize({
			batches: [
				batch([edit(0, 1, "typing")]),
				batch([edit(10, 1, "typing")], {
					receivedAt: AT(2),
					baseReason: "rebase",
					gapBefore: "abc",
					baseText: "abXc",
				}),
			],
			markers: [{ reason: "input-lost", receivedAt: AT(1) }],
			anchorText: "abXc!",
			answerText: "abXc! ok",
		});
		expect(summary.gaps).toHaveLength(3);
		expect(summary.gaps).toEqual(
			expect.arrayContaining([
				{ type: "marker", reason: "input-lost", receivedAt: AT(1) },
				{ type: "rebase", removed: 0, inserted: 1, receivedAt: AT(2) },
				{ type: "final", removed: 0, inserted: 3 },
			]),
		);
	});
});

test.describe("R34: state", () => {
	test("complete: batches and no limit reached", () => {
		expect(summarize({ batches: [batch([edit(0, 1, "typing")])] }).state).toBe(
			"complete",
		);
	});

	test("incomplete: a limit was reached, though batches were stored before it", () => {
		expect(
			summarize({
				batches: [batch([edit(0, 1, "typing")])],
				incomplete: true,
			}).state,
		).toBe("incomplete");
	});

	test("incomplete wins over none when the limit refused the very first batch", () => {
		expect(
			summarize({ batches: [], answerText: "answered", incomplete: true })
				.state,
		).toBe("incomplete");
	});

	test("none: answered, with no batch at all", () => {
		const summary = summarize({ batches: [], answerText: "answered" });
		expect(summary.state).toBe("none");
		expect(summary.activeMs).toBe(0);
		expect(summary.pastes).toEqual({ count: 0, chars: 0 });
		expect(summary.largeInsertions).toEqual([]);
		expect(summary.gaps).toEqual([]);
	});
});

test.describe("R33: no replay", () => {
	test("positions that fit no text still summarize: only the tuples are read", () => {
		const summary = summarize({
			batches: [
				batch([
					edit(0, 10, "typing", "x", 0, 9999),
					edit(500, 20, "paste", "yz", 4000, 123_456),
				]),
			],
		});
		expect(summary.activeMs).toBe(520);
		expect(summary.pastes).toEqual({ count: 1, chars: 2 });
	});
});
