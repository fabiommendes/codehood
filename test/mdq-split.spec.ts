import { expect, test } from "@playwright/test";
import { ImproperBehavior } from "@/core/error";
import type { Question } from "@/mdq/schemas-generated";
import { mergeQuestion, splitQuestion } from "@/mdq/split";

const documents: Record<string, Question> = {
	"multiple-choice": {
		type: "multiple-choice",
		id: "recursion",
		title: "Recursion",
		stem: "What makes a recursive function terminate?",
		comment: "Graded automatically.",
		tags: ["recursion"],
		choices: [
			{ id: "base", text: "A base case", score: 1, feedback: "Right." },
			{ id: "tail", text: "A tail call", score: 0, comment: "Common slip." },
		],
	},
	"multiple-selection": {
		type: "multiple-selection",
		stem: "Select every true statement.",
		choices: [
			{ id: "a", text: "First", correct: true },
			{ id: "b", text: "Second", correct: false, feedback: "No." },
		],
	},
	"true-false": {
		type: "true-false",
		stem: "Judge each statement.",
		choices: [
			{ id: "a", text: "Water is wet", marker: "T" },
			{ id: "b", text: "Fire is cold", marker: "F", feedback: "It is not." },
		],
	},
	essay: {
		type: "essay",
		stem: "Explain the invariant.",
		answerKey: "A model answer nobody but the instructor sees.",
		input: "code",
	},
	numeric: {
		type: "numeric",
		stem: "How many bytes in a kibibyte?",
		answer: 1024,
		unit: "B",
		domain: "integer",
		tolerance: { absolute: 0 },
	},
	"short-answer": {
		type: "short-answer",
		stem: "Name the capital of Brazil.",
		oneOf: ["Brasilia"],
		preAccept: ["/^[A-Za-z ]+$/"],
	},
	"fill-in": {
		type: "fill-in",
		stem: "The capital of Brazil is [^capital], founded in [^year].",
		blanks: [
			{ id: "capital", type: "short-answer", oneOf: ["Brasilia"] },
			{ id: "year", type: "numeric", answer: 1960, tolerance: { absolute: 0 } },
		],
	},
};

// The one field a round-trip does not return unchanged: mdq.spec infers a
// numeric domain the author left implicit, and the public half is where that
// inference happens, so the merged document states what was inferred.
const normalized: Record<string, Question> = {
	"fill-in": {
		...(documents["fill-in"] as Question & { blanks: unknown[] }),
		blanks: [
			{ id: "capital", type: "short-answer", oneOf: ["Brasilia"] },
			{
				id: "year",
				type: "numeric",
				answer: 1960,
				domain: "integer",
				tolerance: { absolute: 0 },
			},
		],
	} as Question,
};

for (const [name, document] of Object.entries(documents)) {
	test(`split() and mergeQuestion() round-trip a ${name} question`, () => {
		const { publicPayload, privatePayload } = splitQuestion(document);
		expect(mergeQuestion(publicPayload, privatePayload)).toEqual(
			normalized[name] ?? document,
		);
	});

	test(`split() keeps the answer out of a ${name} question's public half`, () => {
		const { publicPayload } = splitQuestion(document);
		const serialized = JSON.stringify(publicPayload);

		for (const secret of [
			"score",
			"correct",
			"marker",
			"answer",
			"oneOf",
			"regex",
			"comment",
			"tolerance",
		]) {
			expect(serialized).not.toContain(`"${secret}"`);
		}
	});
}

test("split() stores a blank the stem never refers to in the private half alone", () => {
	const document: Question = {
		type: "fill-in",
		stem: "The capital of Brazil is [^capital].",
		blanks: [
			{ id: "capital", type: "short-answer", oneOf: ["Brasilia"] },
			{ id: "unused", type: "short-answer", oneOf: ["Nothing"] },
		],
	};

	const { publicPayload, privatePayload } = splitQuestion(document);
	expect(JSON.stringify(publicPayload)).not.toContain("unused");
	expect(mergeQuestion(publicPayload, privatePayload)).toEqual(document);
});

test("mergeQuestion() refuses halves that both define a field", () => {
	const { publicPayload, privatePayload } = splitQuestion({
		type: "numeric",
		stem: "How many bytes in a kibibyte?",
		answer: 1024,
	});

	expect(() =>
		mergeQuestion(publicPayload, { ...privatePayload, stem: "Rewritten." }),
	).toThrow(ImproperBehavior);
});
