import { expect, test } from "@playwright/test";
import { capitalChoice, plateauFillIn } from "@/mdq/fixtures";
import { blanksScore, pendingBlanks, reviewResult } from "@/services/review";

const question = plateauFillIn;
const unmatched = { capital: "brasilia", plateau: "Brazilian Highlands" };

test("pendingBlanks lists the blanks that match nothing under unmatched: manual", () => {
	expect(pendingBlanks(question, unmatched)).toEqual(["plateau"]);
	expect(
		pendingBlanks(question, { capital: "brasilia", plateau: "Central" }),
	).toEqual([]);
	expect(pendingBlanks(capitalChoice, "brasilia")).toEqual([]);
});

test("an answer without a stored score is pending, with the settled blanks marked", () => {
	const result = reviewResult(question, unmatched, { score: null });
	expect(result).toEqual({
		pending: true,
		blanks: { capital: { score: 1, feedback: ["Correct."] }, plateau: null },
	});
});

test("a blank graded by hand shows the instructor's score and comment", () => {
	const result = reviewResult(question, unmatched, {
		score: 0.75,
		blanks: { plateau: { score: 0.5, comment: "Close enough." } },
	});
	expect(result).toEqual({
		score: 0.75,
		feedback: ["Correct."],
		blanks: {
			capital: { score: 1, feedback: ["Correct."] },
			plateau: { score: 0.5, feedback: ["Close enough."] },
		},
	});
});

test("the stored score wins over the library's", () => {
	const result = reviewResult(capitalChoice, "rio", { score: 1 });
	expect(result).toMatchObject({ score: 1 });
});

test("blanksScore combines the blank grades with the blanks the library scores", () => {
	expect(blanksScore(question, unmatched, { plateau: { score: 0.5 } })).toBe(
		0.75,
	);
	expect(() =>
		blanksScore(question, unmatched, {
			plateau: { score: 1 },
			capital: { score: 0 },
		}),
	).toThrow(RangeError);
	expect(() => blanksScore(question, unmatched, {})).toThrow();
});
