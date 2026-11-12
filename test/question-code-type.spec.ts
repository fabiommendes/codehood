import { expect, test } from "@playwright/test";
import { questionCreate, questionUpdate } from "@/core/schemas";
import { UNSUPPORTED_TYPE_MESSAGE } from "@/mdq";

const code = {
	type: "code",
	title: "Sum",
	stem: "Write a function that adds two numbers.",
	language: "python",
	tests: [{ format: "pytest", text: "def test_sum(): pass" }],
	rubric: [{ binding: "manual", text: "Correct result", value: 1 }],
};

const base = {
	slug: "sum",
	status: "DRAFT",
	version: "1",
	rev: null,
	course: 1,
};

test("a code question is refused on create with a message naming the type", () => {
	const result = questionCreate.safeParse({ ...base, question: code });
	expect(result.success).toBe(false);
	const messages = result.error?.issues.map((issue) => issue.message) ?? [];
	expect(messages).toContain(UNSUPPORTED_TYPE_MESSAGE);
});

test("a code question is refused on update", () => {
	const result = questionUpdate.safeParse({ question: code });
	expect(result.success).toBe(false);
	expect(result.error?.issues.map((issue) => issue.message)).toContain(
		UNSUPPORTED_TYPE_MESSAGE,
	);
});

test("an essay with a code language is still accepted", () => {
	const essay = {
		type: "essay",
		title: "Sum",
		stem: "Write a function.",
		content: "code",
		highlight: "python",
	};
	const result = questionCreate.safeParse({ ...base, question: essay });
	expect(result.error?.issues ?? []).toEqual([]);
});
