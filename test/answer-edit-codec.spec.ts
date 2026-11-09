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

test.describe("answer edit codec", () => {
	for (const [kind, code] of kindCodes) {
		for (const timing of [null, [3, 12.5, 7.25] as const]) {
			test(`${kind} uses code ${code} with ${timing === null ? "no intervals" : "interval statistics"}`, () => {
				const input = edit({ startMs: 105.5, kind, timing });
				expect(encodeEdits([input], 100)).toEqual({
					version: 1,
					timeOriginMs: 100,
					edits: [[5.5, 0, 0, 0, "", code, timing]],
				});
			});

			test(`${kind} decodes code ${code} with ${timing === null ? "no intervals" : "interval statistics"}`, () => {
				expect(decodeEdits(envelope([5.5, 0, 0, 0, "", code, timing]))).toEqual(
					[edit({ startMs: 105.5, kind, timing })],
				);
			});
		}
	}

	test("roundtrips ordered edits without changing UTF-16 text or timing", () => {
		const editArbitrary = fc.record({
			delta: fc.integer({ min: 0, max: 1000 }),
			durationMs: fc.integer({ min: 0, max: 1000 }).map((n) => n / 4),
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

	test("an empty edit list retains its origin", () => {
		expect(encodeEdits([], 12.5)).toEqual({
			version: 1,
			timeOriginMs: 12.5,
			edits: [],
		});
	});

	test("an empty envelope decodes to no edits", () => {
		expect(decodeEdits({ version: 1, timeOriginMs: 12.5, edits: [] })).toEqual(
			[],
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

	for (const version of [0, 2, -1, "1", null]) {
		test(`rejects unsupported version ${JSON.stringify(version)}`, () => {
			expect(() => decodeEdits({ ...envelope(), version })).toThrow();
		});
	}

	for (const value of [-1, NaN, Infinity, -Infinity, "100", null]) {
		for (const field of ["startMs", "durationMs"] as const) {
			test(`encode rejects ${field} = ${String(value)}`, () => {
				const input = { ...edit(), [field]: value } as unknown as AnswerEdit;
				expect(() => encodeEdits([input], 0)).toThrow();
			});
		}
		test(`encode rejects origin = ${String(value)}`, () => {
			expect(() => encodeEdits([], value as number)).toThrow();
		});
		test(`decode rejects origin = ${String(value)}`, () => {
			expect(() =>
				decodeEdits({ ...envelope(), timeOriginMs: value }),
			).toThrow();
		});
	}

	test("encode rejects the first start before the envelope origin", () => {
		expect(() => encodeEdits([edit({ startMs: 99 })], 100)).toThrow();
	});

	test("encode rejects regressing start times", () => {
		expect(() =>
			encodeEdits([edit({ startMs: 110 }), edit({ startMs: 109 })], 100),
		).toThrow();
	});

	const invalidTupleFields: readonly (readonly [string, number, unknown])[] = [
		...[0, 1].flatMap((index) =>
			[-1, NaN, Infinity, -Infinity, "0", null].map(
				(value) =>
					[
						`${index === 0 ? "delta" : "duration"} = ${String(value)}`,
						index,
						value,
					] as const,
			),
		),
		...[2, 3].flatMap((index) =>
			[-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, "0", null].map(
				(value) =>
					[
						`${index === 2 ? "position" : "deleteCount"} = ${String(value)}`,
						index,
						value,
					] as const,
			),
		),
		["non-string insertedText", 4, 42],
		["null insertedText", 4, null],
		...[-1, 7, 0.5, NaN, Infinity, "0", null].map(
			(value) => [`kind code = ${String(value)}`, 5, value] as const,
		),
	];
	for (const [label, index, value] of invalidTupleFields) {
		test(`decode rejects ${label}`, () => {
			const tuple: unknown[] = [0, 0, 0, 0, "", 0, null];
			tuple[index] = value;
			expect(() => decodeEdits(envelope(tuple))).toThrow();
		});
	}

	const invalidEditFields: readonly (readonly [string, unknown])[] = [
		...["position", "deleteCount"].flatMap((field) =>
			[-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, "0", null].map(
				(value) => [field, value] as const,
			),
		),
		["insertedText", 42],
		["insertedText", null],
		["kind", "unknown"],
		["kind", 0],
		["kind", null],
	];
	for (const [field, value] of invalidEditFields) {
		test(`encode rejects ${field} = ${String(value)}`, () => {
			const input = { ...edit(), [field]: value } as unknown as AnswerEdit;
			expect(() => encodeEdits([input], 100)).toThrow();
		});
	}

	const invalidTimings: readonly unknown[] = [
		[],
		[1],
		[1, 0],
		[1, 0, 0, 0],
		[0, 0, 0],
		[-1, 0, 0],
		[0.5, 0, 0],
		[Number.MAX_SAFE_INTEGER + 1, 0, 0],
		[NaN, 0, 0],
		[Infinity, 0, 0],
		["1", 0, 0],
		[1, -1, 0],
		[1, NaN, 0],
		[1, Infinity, 0],
		[1, "0", 0],
		[1, 0, -1],
		[1, 0, NaN],
		[1, 0, Infinity],
		[1, 0, "0"],
		{},
		"timing",
		undefined,
	];
	for (const [index, timing] of invalidTimings.entries()) {
		test(`encode rejects malformed timing case ${index}`, () => {
			expect(() =>
				encodeEdits([{ ...edit(), timing } as AnswerEdit], 100),
			).toThrow();
		});
		test(`decode rejects malformed timing case ${index}`, () => {
			expect(() =>
				decodeEdits(envelope([0, 0, 0, 0, "", 0, timing])),
			).toThrow();
		});
	}

	for (const [label, input] of [
		["null", null],
		["array", []],
		["missing edits", { version: 1, timeOriginMs: 100 }],
		["non-array edits", { ...envelope(), edits: {} }],
		["non-tuple edit", { ...envelope(), edits: [null] }],
		["short tuple", envelope([0, 0, 0, 0, "", 0])],
	] as const) {
		test(`decode rejects malformed envelope: ${label}`, () => {
			expect(() => decodeEdits(input)).toThrow();
		});
	}
});

test.describe("answer edit replay", () => {
	const examples: readonly (readonly [
		string,
		string,
		readonly TextReplacement[],
		string,
	])[] = [
		["empty history", "", [], ""],
		["unchanged nonempty text", "e\u0301\r\nשלום", [], "e\u0301\r\nשלום"],
		["insert into empty text", "", [replacement(0, 0, "hello")], "hello"],
		["insert at start", "world", [replacement(0, 0, "hello ")], "hello world"],
		["insert at end", "hello", [replacement(5, 0, "!")], "hello!"],
		["replace a range", "abcdef", [replacement(2, 3, "XY")], "abXYf"],
		["delete all", "abc", [replacement(0, 3, "")], ""],
		["no-op", "abc", [replacement(1, 0, "")], "abc"],
		[
			"emoji occupies two UTF-16 units",
			"A😀B",
			[replacement(3, 1, "!")],
			"A😀!",
		],
		["replace an emoji", "A😀B", [replacement(1, 2, "🧪")], "A🧪B"],
		["split a surrogate pair", "😀", [replacement(1, 1, "")], "\ud83d"],
		[
			"combining mark stays decomposed",
			"cafe",
			[replacement(4, 0, "\u0301")],
			"cafe\u0301",
		],
		["RTL logical coordinates", "אבג", [replacement(1, 1, "X")], "אXג"],
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
		["fractional position", [replacement(0.5, 0, "X")]],
		["unsafe position", [replacement(Number.MAX_SAFE_INTEGER + 1, 0, "X")]],
		["negative deletion", [replacement(0, -1, "")]],
		["fractional deletion", [replacement(0, 0.5, "")]],
		["unsafe deletion", [replacement(0, Number.MAX_SAFE_INTEGER + 1, "")]],
		["deletion past end", [replacement(2, 2, "")]],
		["position past end", [replacement(4, 0, "X")]],
		["overlapping ranges", [replacement(0, 2, "X"), replacement(1, 1, "Y")]],
		["descending positions", [replacement(2, 1, "X"), replacement(0, 1, "Y")]],
	];
	for (const [label, replacements] of invalidReplacements) {
		test(`rejects ${label}`, () => {
			expect(() => applyReplacements("abc", replacements)).toThrow();
		});
		test(`rejecting ${label} leaves arguments unchanged`, () => {
			const input = structuredClone(replacements);
			const before = structuredClone(input);
			expect(() => applyReplacements("abc", input)).toThrow();
			expect(input).toEqual(before);
		});
	}
});
