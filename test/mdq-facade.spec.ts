import { expect, test } from "@playwright/test";
import {
	assertResponse,
	publicForm,
	questionDocument,
	questionProblems,
	ResponseError,
} from "@/mdq";
import {
	brasiliaFillIn,
	capitalChoice,
	everyQuestionType,
	fibonacciOrdering,
	idempotenceEssay,
} from "@/mdq/fixtures";
import { publicQuestionSchema } from "@/mdq/public-schema";

test("every fixture is a hosted question document with no model problem", () => {
	for (const question of everyQuestionType) {
		expect(questionDocument.safeParse(question).success, question.type).toBe(
			true,
		);
		expect(questionProblems(question), question.type).toEqual([]);
	}
});

test("the public form of an ordering question hides the answer", () => {
	const form = publicQuestionSchema.parse(publicForm(fibonacciOrdering));
	expect(form).toEqual(publicForm(fibonacciOrdering));
	expect(form).not.toHaveProperty("lines");
	expect(form).not.toHaveProperty("extra");
	expect(form).not.toHaveProperty("incorrectFeedback");
	// Under `strict` the pool levels are 0, so they do not give the answer away.
	expect(
		form.type === "ordering" && form.pool.every(([level]) => level === 0),
	).toBe(true);
});

test("the public form of every fixture parses against the public schema", () => {
	for (const question of everyQuestionType) {
		const result = publicQuestionSchema.safeParse(publicForm(question));
		expect(result.success, question.type).toBe(true);
	}
});

test("the public schema keeps no private field of the public form", () => {
	const parsed = publicQuestionSchema.parse(publicForm(capitalChoice));
	expect(parsed).toEqual(publicForm(capitalChoice));
	expect(JSON.stringify(parsed)).not.toContain("score");
	expect(JSON.stringify(parsed)).not.toContain("feedback");
});

test("a fill-in stem that names an undefined blank is a model problem", () => {
	const broken = {
		...brasiliaFillIn,
		stem: `${brasiliaFillIn.stem} And [^missing].`,
	};
	expect(questionProblems(broken)).not.toEqual([]);
});

test.describe("assertResponse", () => {
	test("accepts a skipped question", () => {
		expect(() => assertResponse(capitalChoice, null)).not.toThrow();
	});

	test("accepts a choice the question has", () => {
		expect(() => assertResponse(capitalChoice, "brasilia")).not.toThrow();
	});

	test("refuses a choice the question does not have", () => {
		expect(() => assertResponse(capitalChoice, "lisbon")).toThrow(
			ResponseError,
		);
	});

	test("refuses a response of the wrong shape", () => {
		expect(() => assertResponse(capitalChoice, { choice: "brasilia" })).toThrow(
			ResponseError,
		);
	});

	test("accepts an ordering of lines from the pool", () => {
		expect(() =>
			assertResponse(fibonacciOrdering, [
				[0, "x, y = 1, 1"],
				[0, "for _ in range(10):"],
				[1, "x = y"],
			]),
		).not.toThrow();
	});

	test("refuses an ordering line the pool does not offer", () => {
		expect(() => assertResponse(fibonacciOrdering, [[0, "print(y)"]])).toThrow(
			ResponseError,
		);
	});

	test("accepts an essay, which only an instructor can grade", () => {
		expect(() =>
			assertResponse(idempotenceEssay, "Same effect on repeat."),
		).not.toThrow();
	});
});
