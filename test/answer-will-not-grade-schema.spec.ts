import { expect, test } from "@playwright/test";
import { answerWillNotGrade } from "@/core/schemas";

const ref = {
	discipline: "cs",
	course: "2026-1",
	exam: "midterm",
	submission: "abc",
};

test("answerWillNotGrade: the comment is optional", () => {
	expect(answerWillNotGrade.safeParse(ref).success).toBe(true);
	expect(
		answerWillNotGrade.safeParse({ ...ref, comment: "Empty" }).success,
	).toBe(true);
});

test("answerWillNotGrade: a missing submission is an error on that field", () => {
	const { submission: _, ...rest } = ref;
	const result = answerWillNotGrade.safeParse(rest);
	expect(result.success).toBe(false);
	expect(result.error?.issues[0]?.path).toEqual(["submission"]);
});
