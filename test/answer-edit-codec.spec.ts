import { expect, test } from "@playwright/test";
import fc from "fast-check";
import {
	type AnswerEdit,
	applyReplacements,
	decodeEdits,
	encodeEdits,
	type InputKind,
	replayEdits,
	type TextReplacement,
} from "@/services/answer-edits/codec";

const propertyOptions = { seed: 20260717, numRuns: 200 };
const kindCodes: readonly (readonly [InputKind, number])[] = [
	["typing", 0],
	["paste", 1],
	["delete", 2],
	["undo", 3],
	["redo", 4],
	["composition", 5],
	["other", 6],
];
const utf16Text = fc
	.array(fc.integer({ min: 0, max: 0xffff }), { maxLength: 40 })
	.map((units) => String.fromCharCode(...units));
const timingArbitrary = fc.oneof(
	fc.constant(null),
	fc.tuple(
		fc.integer({ min: 1, max: 1000 }),
		fc.integer({ min: 0, max: 10000 }).map((value) => value / 4),
		fc.integer({ min: 0, max: 100000 }).map((value) => value / 4),
	),
);

function edit(overrides: Partial<AnswerEdit> = {}): AnswerEdit {
	return {
		startMs: 100,
		durationMs: 0,
		position: 0,
		deleteCount: 0,
		insertedText: "",
		kind: "typing",
		timing: null,
		...overrides,
	};
}

function envelope(tuple: readonly unknown[] = [0, 0, 0, 0, "", 0, null]) {
	return { version: 1, timeOriginMs: 100, edits: [tuple] };
}

function replacement(
	position: number,
	deleteCount: number,
	insertedText: string,
): TextReplacement {
	return { position, deleteCount, insertedText };
}

/// One value per rejection branch of the shared integer validator.
const invalidIntegers: readonly unknown[] = [
	-1,
	0.5,
	Number.MAX_SAFE_INTEGER + 1,
	Number.NaN,
	Number.POSITIVE_INFINITY,
	"0",
	null,
];
/// One value per rejection branch of the timing parser.
const invalidTimings: readonly (readonly [string, unknown])[] = [
	["not an array", {}],
	["missing", undefined],
	["too short", [1, 0]],
	["too long", [1, 0, 0, 0]],
	["zero count", [0, 0, 0]],
	["fractional count", [0.5, 0, 0]],
	["negative mean", [1, -1, 0]],
	["nonfinite variance", [1, 0, Number.NaN]],
];

test.describe("answer edit codec", () => {
	test("every input kind maps to its wire code in both directions, with and without timing", () => {
		for (const [kind, code] of kindCodes) {
			for (const timing of [null, [3, 12.5, 7.25] as const]) {
				const decoded = edit({ startMs: 105, kind, timing });
				const encoded = {
					version: 1,
					timeOriginMs: 100,
					edits: [[5, 0, 0, 0, "", code, timing]],
				};
				expect(encodeEdits([decoded], 100), kind).toEqual(encoded);
				expect(decodeEdits(encoded), kind).toEqual([decoded]);
			}
		}
	});

	test("roundtrips ordered edits without changing UTF-16 text or timing", () => {
		const editArbitrary = fc.record({
			delta: fc.integer({ min: 0, max: 1000 }),
			durationMs: fc.integer({ min: 0, max: 1000 }),
			position: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
			deleteCount: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
			insertedText: utf16Text,
			kind: fc.constantFrom(...kindCodes.map(([kind]) => kind)),
			timing: timingArbitrary,
		});
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 100000 }),
				fc.array(editArbitrary, { maxLength: 30 }),
				(origin, generated) => {
					let startMs = origin;
					const edits = generated.map(({ delta, ...fields }) => {
						startMs += delta;
						return { ...fields, startMs };
					});
					expect(decodeEdits(encodeEdits(edits, origin))).toEqual(edits);
				},
			),
			propertyOptions,
		);
	});

	test("each envelope starts relative to its own origin, then uses previous start times", () => {
		const first = [edit({ startMs: 105 }), edit({ startMs: 112 })];
		const second = [edit({ startMs: 112 }), edit({ startMs: 112 })];
		expect([encodeEdits(first, 100), encodeEdits(second, 110)]).toEqual([
			{
				version: 1,
				timeOriginMs: 100,
				edits: [
					[5, 0, 0, 0, "", 0, null],
					[7, 0, 0, 0, "", 0, null],
				],
			},
			{
				version: 1,
				timeOriginMs: 110,
				edits: [
					[2, 0, 0, 0, "", 0, null],
					[0, 0, 0, 0, "", 0, null],
				],
			},
		]);
	});

	test("decodes a later envelope independently and allows equal start times", () => {
		expect(
			decodeEdits({
				version: 1,
				timeOriginMs: 110,
				edits: [
					[2, 0, 0, 0, "", 0, null],
					[0, 0, 0, 0, "", 0, null],
				],
			}),
		).toEqual([edit({ startMs: 112 }), edit({ startMs: 112 })]);
	});

	test("an empty edit list retains its origin and decodes to no edits", () => {
		const empty = { version: 1, timeOriginMs: 12, edits: [] };
		expect(encodeEdits([], 12)).toEqual(empty);
		expect(decodeEdits(empty)).toEqual([]);
	});

	test("fractional times are rejected by encode and decode", () => {
		expect(() => encodeEdits([], 12.5)).toThrow(/safe integer/);
		expect(() => encodeEdits([edit({ startMs: 100.5 })], 100)).toThrow(
			/safe integer/,
		);
		expect(() => encodeEdits([edit({ durationMs: 0.5 })], 100)).toThrow(
			/safe integer/,
		);
		expect(() =>
			decodeEdits({ version: 1, timeOriginMs: 12.5, edits: [] }),
		).toThrow(/safe integer/);
		expect(() => decodeEdits(envelope([0.5, 0, 0, 0, "", 0, null]))).toThrow(
			/safe integer/,
		);
		expect(() => decodeEdits(envelope([0, 0.5, 0, 0, "", 0, null]))).toThrow(
			/safe integer/,
		);
	});

	test("safe integer boundaries and zero timing statistics are accepted", () => {
		const input = edit({
			position: Number.MAX_SAFE_INTEGER,
			deleteCount: Number.MAX_SAFE_INTEGER,
			timing: [Number.MAX_SAFE_INTEGER, 0, 0],
		});
		expect(decodeEdits(encodeEdits([input], 100))).toEqual([input]);
	});

	test("encode and decode reject every class of invalid integer", () => {
		for (const value of invalidIntegers) {
			const input = { ...edit(), position: value } as unknown as AnswerEdit;
			expect(() => encodeEdits([input], 100), String(value)).toThrow(TypeError);
			expect(
				() => decodeEdits(envelope([0, 0, value, 0, "", 0, null])),
				String(value),
			).toThrow(TypeError);
		}
	});

	for (const field of [
		"startMs",
		"durationMs",
		"position",
		"deleteCount",
	] as const) {
		test(`encode validates ${field}`, () => {
			const input = { ...edit(), [field]: -1 };
			expect(() => encodeEdits([input], 0)).toThrow(TypeError);
		});
	}

	for (const [label, index] of [
		["start delta", 0],
		["duration", 1],
		["position", 2],
		["deleteCount", 3],
		["kind code", 5],
	] as const) {
		test(`decode validates ${label}`, () => {
			const tuple: unknown[] = [0, 0, 0, 0, "", 0, null];
			tuple[index] = -1;
			expect(() => decodeEdits(envelope(tuple))).toThrow(TypeError);
		});
	}

	test("encode and decode validate the time origin", () => {
		expect(() => encodeEdits([], -1)).toThrow(TypeError);
		expect(() => decodeEdits({ ...envelope(), timeOriginMs: -1 })).toThrow(
			TypeError,
		);
	});

	test("encode rejects the first start before the envelope origin", () => {
		expect(() => encodeEdits([edit({ startMs: 99 })], 100)).toThrow();
	});

	test("encode rejects regressing start times", () => {
		expect(() =>
			encodeEdits([edit({ startMs: 110 }), edit({ startMs: 109 })], 100),
		).toThrow();
	});

	test("encode and decode reject text that is not a string", () => {
		const input = { ...edit(), insertedText: 42 } as unknown as AnswerEdit;
		expect(() => encodeEdits([input], 100)).toThrow(TypeError);
		expect(() => decodeEdits(envelope([0, 0, 0, 0, 42, 0, null]))).toThrow(
			TypeError,
		);
	});

	test("encode rejects unknown kinds and decode rejects the first unassigned code", () => {
		for (const kind of ["unknown", 0, null]) {
			const input = { ...edit(), kind } as unknown as AnswerEdit;
			expect(() => encodeEdits([input], 100), String(kind)).toThrow(TypeError);
		}
		expect(() => decodeEdits(envelope([0, 0, 0, 0, "", 7, null]))).toThrow(
			TypeError,
		);
	});

	test("encode and decode reject every class of malformed timing", () => {
		for (const [label, timing] of invalidTimings) {
			expect(
				() => encodeEdits([{ ...edit(), timing } as AnswerEdit], 100),
				label,
			).toThrow(TypeError);
			expect(
				() => decodeEdits(envelope([0, 0, 0, 0, "", 0, timing])),
				label,
			).toThrow(TypeError);
		}
	});

	test("decode rejects unsupported versions and malformed envelopes", () => {
		for (const [label, input] of [
			["version 2", { ...envelope(), version: 2 }],
			["string version", { ...envelope(), version: "1" }],
			["null", null],
			["array", []],
			["missing edits", { version: 1, timeOriginMs: 100 }],
			["non-array edits", { ...envelope(), edits: {} }],
			["non-tuple edit", { ...envelope(), edits: [null] }],
			["short tuple", envelope([0, 0, 0, 0, "", 0])],
		] as const) {
			expect(() => decodeEdits(input), label).toThrow(TypeError);
		}
	});
});

test.describe("answer edit replay", () => {
	const examples: readonly (readonly [
		string,
		string,
		readonly TextReplacement[],
		string,
	])[] = [
		["delete all", "abc", [replacement(0, 3, "")], ""],
		[
			"emoji occupies two UTF-16 units",
			"A😀B",
			[replacement(3, 1, "!")],
			"A😀!",
		],
		["split a surrogate pair", "😀", [replacement(1, 1, "")], "\ud83d"],
		[
			"combining mark stays decomposed",
			"cafe",
			[replacement(4, 0, "\u0301")],
			"cafe\u0301",
		],
		[
			"newlines are not normalized",
			"a\r\nb",
			[replacement(3, 0, "\n")],
			"a\r\n\nb",
		],
		[
			"sequential edits may return to earlier positions",
			"ab",
			[replacement(2, 0, "cd"), replacement(0, 1, "X"), replacement(3, 1, "!")],
			"Xbc!",
		],
	];
	for (const [label, initial, replacements, expected] of examples) {
		test(label, () => {
			const edits = replacements.map((change, index) =>
				edit({ ...change, startMs: 100 + index }),
			);
			expect(replayEdits(initial, encodeEdits(edits, 100))).toBe(expected);
		});
	}

	test("arbitrary UTF-16 edit histories match a code-unit array model", () => {
		const operation = fc.record({
			positionSelector: fc.nat(),
			deleteSelector: fc.nat(),
			insertedText: utf16Text,
		});
		fc.assert(
			fc.property(
				utf16Text,
				fc.array(operation, { maxLength: 30 }),
				(initial, operations) => {
					const units = initial.split("");
					const edits: AnswerEdit[] = [];
					for (const [index, operation] of operations.entries()) {
						const position = operation.positionSelector % (units.length + 1);
						const deleteCount =
							operation.deleteSelector % (units.length - position + 1);
						edits.push(
							edit({
								startMs: 100 + index,
								position,
								deleteCount,
								insertedText: operation.insertedText,
							}),
						);
						units.splice(
							position,
							deleteCount,
							...operation.insertedText.split(""),
						);
					}
					expect(replayEdits(initial, encodeEdits(edits, 100))).toBe(
						units.join(""),
					);
				},
			),
			propertyOptions,
		);
	});

	test("replay rejects an unsupported envelope version", () => {
		expect(() => replayEdits("abc", { ...envelope(), version: 2 })).toThrow();
	});

	test("replay rejects edits outside the document as it evolves", () => {
		const replay = (...edits: AnswerEdit[]) =>
			replayEdits("abc", encodeEdits(edits, 100));
		expect(() => replay(edit({ position: 4, insertedText: "x" }))).toThrow(
			/bounds/,
		);
		expect(() => replay(edit({ position: 2, deleteCount: 2 }))).toThrow(
			/bounds/,
		);
		/// Position 1 exists in the initial text but not after the deletion.
		expect(() =>
			replay(
				edit({ deleteCount: 3 }),
				edit({ startMs: 101, position: 1, insertedText: "x" }),
			),
		).toThrow(/bounds/);
		expect(replay(edit({ position: 3, insertedText: "x" }))).toBe("abcx");
	});
});

test.describe("pre-transaction replacements", () => {
	test("all coordinates refer to the original text despite length changes", () => {
		expect(
			applyReplacements("abcdefgh", [
				replacement(1, 2, "LONG"),
				replacement(5, 1, ""),
				replacement(8, 0, "!"),
			]),
		).toBe("aLONGdegh!");
	});

	test("adjacent replaced ranges do not overlap", () => {
		expect(
			applyReplacements("abcdef", [
				replacement(1, 2, "X"),
				replacement(3, 2, "Y"),
			]),
		).toBe("aXYf");
	});

	test("empty replacement list preserves UTF-16 exactly", () => {
		expect(applyReplacements("😀e\u0301\r\nאב", [])).toBe("😀e\u0301\r\nאב");
	});

	test("successful application does not mutate the replacement array or its entries", () => {
		const replacements = [replacement(0, 1, "XX"), replacement(2, 1, "Y")];
		const before = structuredClone(replacements);
		applyReplacements("abc", replacements);
		expect(replacements).toEqual(before);
	});

	const invalidReplacements: readonly (readonly [
		string,
		readonly TextReplacement[],
	])[] = [
		["negative position", [replacement(-1, 0, "X")]],
		["fractional deletion", [replacement(0, 0.5, "")]],
		["deletion past end", [replacement(2, 2, "")]],
		["position past end", [replacement(4, 0, "X")]],
		["overlapping ranges", [replacement(0, 2, "X"), replacement(1, 1, "Y")]],
		["descending positions", [replacement(2, 1, "X"), replacement(0, 1, "Y")]],
		["repeated position", [replacement(1, 0, "X"), replacement(1, 0, "Y")]],
	];
	for (const [label, replacements] of invalidReplacements) {
		test(`rejects ${label}`, () => {
			expect(() => applyReplacements("abc", replacements)).toThrow(TypeError);
		});
	}
});
