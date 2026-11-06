import { expect, test } from "@playwright/test";
import { unansweredWarning } from "@/components/exam/unanswered-warning";

test("the submit warning names one unanswered question", () => {
	expect(unansweredWarning([1])).toBe("Question Q1 was not answered.");
});

test("the submit warning lists up to five unanswered questions", () => {
	expect(unansweredWarning([1, 4, 5])).toBe(
		"Questions Q1, Q4, and Q5 were not answered.",
	);
	expect(unansweredWarning([1, 2, 3, 4, 5])).toBe(
		"Questions Q1, Q2, Q3, Q4, and Q5 were not answered.",
	);
});

test("the submit warning only counts more than five unanswered questions", () => {
	expect(unansweredWarning([1, 2, 3, 4, 5, 6])).toBe(
		"6 questions were not answered.",
	);
});
