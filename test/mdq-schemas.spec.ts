import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
	type Essay,
	EssaySchema,
	type Exam,
	ExamEntrySchema,
	ExamIncludeSchema,
	ExamSchema,
	type FillIn,
	FillInBlankSchema,
	FillInSchema,
	MdqDocumentSchema,
	type MultipleChoice,
	MultipleChoiceChoiceSchema,
	MultipleChoiceSchema,
	MultipleSelectionSchema,
	type Numeric,
	NumericSchema,
	QuestionSchema,
	ShortAnswerSchema,
	TrueFalseSchema,
} from "@/mdq/schemas-generated";
import { renderModule } from "../scripts/generate-question-models";

//
// Representative documents -- one per question type, doubling as readable
// examples of the format. Kept minimal-but-realistic per public/mdq.schema.json.
//

const multipleChoiceDoc = {
	type: "multiple-choice",
	stem: "What is the capital of Brazil?",
	choices: [
		{ id: "brasilia", text: "Brasília", score: 1 },
		{ id: "rio", text: "Rio de Janeiro", score: 0 },
		{ id: "berlin", text: "Berlin", score: -0.5, feedback: "Wrong country." },
	],
} as const;

const multipleSelectionDoc = {
	type: "multiple-selection",
	stem: "Select all prime numbers.",
	choices: [
		{ text: "2", correct: true },
		{ text: "3", correct: true },
		{ text: "4", correct: false },
	],
} as const;

const trueFalseDoc = {
	type: "true-false",
	stem: "Judge each statement as true or false.",
	choices: [
		{ text: "The sky is blue.", correct: true, marker: "T" },
		{ text: "Fish can fly.", correct: false, marker: "F" },
	],
} as const;

const essayDoc = {
	type: "essay",
	stem: "Write a program that reverses a string.",
	input: "code",
	highlight: "python",
	answerKey: "def reverse(s): return s[::-1]",
} as const;

const numericDoc = {
	type: "numeric",
	stem: "What is the boiling point of water at sea level, in Celsius?",
	answer: 100,
	unit: "C",
	domain: "integer",
	tolerance: { absolute: 0.5 },
} as const;

const shortAnswerDoc = {
	type: "short-answer",
	stem: "Name the author of 'Hamlet'.",
	oneOf: ["Shakespeare", "William Shakespeare"],
	exact: false,
} as const;

const fillInDoc = {
	type: "fill-in",
	stem: "The capital of Brazil is [^capital]. Water boils at [^boiling] degrees Celsius.",
	blanks: [
		{
			id: "capital",
			type: "multiple-choice",
			choices: [
				{ id: "brasilia", text: "Brasília" },
				{ id: "rio", text: "Rio de Janeiro" },
			],
		},
		{ id: "boiling", type: "numeric", answer: 100 },
	],
} as const;

const QUESTION_DOCS = [
	{
		name: "multiple-choice",
		schema: MultipleChoiceSchema,
		doc: multipleChoiceDoc,
	},
	{
		name: "multiple-selection",
		schema: MultipleSelectionSchema,
		doc: multipleSelectionDoc,
	},
	{ name: "true-false", schema: TrueFalseSchema, doc: trueFalseDoc },
	{ name: "essay", schema: EssaySchema, doc: essayDoc },
	{ name: "numeric", schema: NumericSchema, doc: numericDoc },
	{ name: "short-answer", schema: ShortAnswerSchema, doc: shortAnswerDoc },
	{ name: "fill-in", schema: FillInSchema, doc: fillInDoc },
] as const;

const examDoc = {
	title: "Midterm",
	questions: [{ include: "recursion-01" }, multipleChoiceDoc, essayDoc],
} as const;

//
// 1. Round-trip of representative documents
//

test("each representative question document round-trips through its own schema", () => {
	for (const { schema, doc } of QUESTION_DOCS) {
		expect(schema.parse(doc)).toEqual(doc);
	}
});

//
// 2. Exam
//

test("an exam with a mix of inline questions and an include entry round-trips, preserving order", () => {
	const parsed = ExamSchema.parse(examDoc);
	expect(parsed).toEqual(examDoc);
	expect(parsed.questions).toEqual([
		{ include: "recursion-01" },
		multipleChoiceDoc,
		essayDoc,
	]);
});

//
// 3. Discrimination
//

test("every question document parses through both QuestionSchema and MdqDocumentSchema", () => {
	for (const { doc } of QUESTION_DOCS) {
		expect(QuestionSchema.parse(doc)).toEqual(doc);
		expect(MdqDocumentSchema.parse(doc)).toEqual(doc);
	}
});

test("an exam parses through MdqDocumentSchema but not through QuestionSchema", () => {
	expect(MdqDocumentSchema.parse(examDoc)).toEqual(examDoc);
	expect(() => QuestionSchema.parse(examDoc)).toThrow();
});

test("a document with an unrecognized `type` is rejected by QuestionSchema and MdqDocumentSchema", () => {
	const notAQuestion = { type: "matching", stem: "Match the pairs." };
	expect(() => QuestionSchema.parse(notAQuestion)).toThrow();
	expect(() => MdqDocumentSchema.parse(notAQuestion)).toThrow();
});

test("a bare {} is rejected by MdqDocumentSchema", () => {
	expect(() => MdqDocumentSchema.parse({})).toThrow();
});

//
// 4. Strictness -- unknown properties are rejected
//

test("an unknown top-level property is rejected", () => {
	for (const { schema, doc } of [
		{ schema: MultipleChoiceSchema, doc: multipleChoiceDoc },
		{ schema: EssaySchema, doc: essayDoc },
	]) {
		expect(() => schema.parse({ ...doc, bogus: true })).toThrow();
	}
});

test("an unknown property on a nested choice object is rejected", () => {
	expect(() =>
		MultipleChoiceChoiceSchema.parse({ text: "a", bogus: true }),
	).toThrow();
	expect(() =>
		MultipleChoiceSchema.parse({
			...multipleChoiceDoc,
			choices: [{ text: "a", bogus: true }, { text: "b" }],
		}),
	).toThrow();
});

test("an unknown property on an exam's include entry is rejected", () => {
	expect(() =>
		ExamIncludeSchema.parse({ include: "recursion-01", bogus: true }),
	).toThrow();
});

//
// 5. Required fields
//

test("dropping `stem` (required by question-base) is rejected for every question type", () => {
	for (const { schema, doc } of QUESTION_DOCS) {
		const { stem: _stem, ...withoutStem } = doc;
		expect(() => schema.parse(withoutStem)).toThrow();
	}
});

const REQUIRED_KEY_CASES = [
	{ schema: MultipleChoiceSchema, doc: multipleChoiceDoc, key: "choices" },
	{
		schema: MultipleSelectionSchema,
		doc: multipleSelectionDoc,
		key: "choices",
	},
	{ schema: TrueFalseSchema, doc: trueFalseDoc, key: "choices" },
	{ schema: NumericSchema, doc: numericDoc, key: "answer" },
	{ schema: FillInSchema, doc: fillInDoc, key: "blanks" },
] as const;

test("dropping the type-specific required field is rejected", () => {
	for (const { schema, doc, key } of REQUIRED_KEY_CASES) {
		const withoutKey: Record<string, unknown> = { ...doc };
		delete withoutKey[key];
		expect(() => schema.parse(withoutKey)).toThrow();
	}
});

//
// 6. Base fields reach every question type (proves the allOf flattening worked)
//

test("question-base fields (id, title, tags) are accepted by every question type", () => {
	for (const { schema, doc } of QUESTION_DOCS) {
		const withBase = {
			...doc,
			id: "q1",
			title: "A question",
			tags: ["intro", "warmup"],
		};
		const parsed = schema.parse(withBase);
		expect(parsed).toMatchObject({
			id: "q1",
			title: "A question",
			tags: ["intro", "warmup"],
		});
	}
});

//
// 7. Constraint plumbing, sampled not enumerated
//

test("a choice list below the minimum size is rejected", () => {
	expect(() =>
		MultipleChoiceSchema.parse({
			...multipleChoiceDoc,
			choices: [{ text: "only one" }],
		}),
	).toThrow();
});

test("a choice score far outside the allowed range is rejected", () => {
	expect(() =>
		MultipleChoiceChoiceSchema.parse({ text: "a", score: 5 }),
	).toThrow();
});

test("a malformed uuid is rejected", () => {
	expect(() =>
		MultipleChoiceSchema.parse({ ...multipleChoiceDoc, uuid: "not-a-uuid" }),
	).toThrow();
});

test("a malformed slug id is rejected", () => {
	expect(() =>
		MultipleChoiceSchema.parse({ ...multipleChoiceDoc, id: "has spaces!" }),
	).toThrow();
	expect(() =>
		MultipleChoiceChoiceSchema.parse({ text: "a", id: "has spaces!" }),
	).toThrow();
});

//
// 8. Non-discriminated unions (FillInBlankSchema, ExamEntrySchema) -- plain
// z.union()s, so the likeliest place for a future generator change to
// accidentally accept a mismatched shape.
//

test("FillInBlankSchema accepts one valid instance of each blank kind", () => {
	const choiceBlank = {
		id: "capital",
		type: "multiple-choice",
		choices: [
			{ id: "brasilia", text: "Brasília" },
			{ id: "rio", text: "Rio de Janeiro" },
		],
	};
	const shortAnswerBlank = {
		id: "author",
		type: "short-answer",
		oneOf: ["Shakespeare"],
	};
	const numericBlank = { id: "boiling", type: "numeric", answer: 100 };

	for (const blank of [choiceBlank, shortAnswerBlank, numericBlank]) {
		expect(FillInBlankSchema.parse(blank)).toEqual(blank);
	}
});

test("FillInBlankSchema rejects a blank whose `type` does not match its payload", () => {
	expect(() =>
		FillInBlankSchema.parse({
			id: "x",
			type: "numeric",
			choices: [{ text: "a" }, { text: "b" }],
		}),
	).toThrow();
});

test("ExamEntrySchema accepts an include entry and an inline question", () => {
	expect(ExamEntrySchema.parse({ include: "recursion-01" })).toEqual({
		include: "recursion-01",
	});
	expect(ExamEntrySchema.parse(multipleChoiceDoc)).toEqual(multipleChoiceDoc);
});

test("ExamEntrySchema rejects an entry that is both an include and a question", () => {
	expect(() =>
		ExamEntrySchema.parse({ include: "q1", stem: "Also a question?" }),
	).toThrow();
});

//
// 9. Defaults are NOT injected
//

test("an omitted `shuffle` stays absent, rather than being defaulted", () => {
	const parsed = MultipleChoiceSchema.parse(multipleChoiceDoc);
	expect("shuffle" in parsed && parsed.shuffle !== undefined).toBe(false);
});

test("an omitted exam `penalty` stays absent, rather than being defaulted", () => {
	const parsed = ExamSchema.parse(examDoc);
	expect("penalty" in parsed && parsed.penalty !== undefined).toBe(false);
});

//
// 10. Types line up with runtime
//

test("inferred types are usable as plain object literals", () => {
	const q: MultipleChoice = {
		type: "multiple-choice",
		stem: "What is 2 + 2?",
		choices: [
			{ text: "3", score: 0 },
			{ text: "4", score: 1 },
		],
	};
	expect(MultipleChoiceSchema.parse(q)).toEqual(q);

	const e = {
		type: "essay",
		stem: "Explain recursion.",
	} satisfies Essay;
	expect(EssaySchema.parse(e)).toEqual(e);

	const n = {
		type: "numeric",
		stem: "What is pi rounded to 2 decimal places?",
		answer: 3.14,
	} satisfies Numeric;
	expect(NumericSchema.parse(n)).toEqual(n);

	const exam: Exam = {
		questions: [{ include: "some-question" }],
	};
	expect(ExamSchema.parse(exam)).toEqual(exam);

	const doc = {
		type: "fill-in",
		stem: "The capital of Brazil is [^capital].",
		blanks: [{ id: "capital", type: "numeric", answer: 1 }],
	} satisfies FillIn;
	expect(FillInSchema.parse(doc)).toEqual(doc);
});

//
// 11. Generated file is up to date (drift guard)
//

test.fail(
	"src/mdq/schemas-generated.ts matches what the generator currently produces from public/mdq.schema.json",
	() => {
		const schemaPath = path.resolve(
			import.meta.dirname,
			"../public/mdq.schema.json",
		);
		const generatedPath = path.resolve(
			import.meta.dirname,
			"../src/mdq/schemas-generated.ts",
		);
		const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
		const onDisk = readFileSync(generatedPath, "utf8");
		expect(onDisk).toEqual(renderModule(schema));
	},
);
