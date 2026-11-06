import { expect, test } from "@playwright/test";
import { isAnswered, toSaved } from "@/components/exam/answer-payload";
import { displayAnswer } from "@/components/grading/answer-text";

test("only null skips a question; an emptied selection is an answer", () => {
	expect(isAnswered("multiple-selection", null)).toBe(false);
	expect(isAnswered("multiple-selection", [])).toBe(true);
	expect(isAnswered("true-false", {})).toBe(true);
	expect(toSaved("multiple-selection", [])).toEqual([]);
});

test("the grading screen shows an emptied selection, not a blank", () => {
	expect(displayAnswer("multiple-selection", []).kind).toBe("view");
	expect(displayAnswer("multiple-selection", null).kind).toBe("empty");
});

test("text erased down to blanks is saved as no answer", () => {
	expect(toSaved("essay", "  \n")).toBeNull();
	expect(toSaved("short-answer", "")).toBeNull();
	expect(toSaved("fill-in", { capital: "", size: null })).toBeNull();
	expect(toSaved("fill-in", { capital: "Paris", size: null })).toEqual({
		capital: "Paris",
		size: null,
	});
});
