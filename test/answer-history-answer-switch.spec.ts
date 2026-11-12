import { expect, test } from "@playwright/test";
import { readAnswerHistory } from "@/services/answer-history";

// R22: the switch in the response of `exam.answer` is read after the save and
// can never fail it. The wrapper that reads it swallows every failure.

test("readAnswerHistory gives the effective value of the exam it reads", async () => {
	expect(
		await readAnswerHistory(async () => ({
			type: "EXAM",
			answerHistory: null,
		})),
	).toBe(true);
	expect(
		await readAnswerHistory(async () => ({
			type: "PRACTICE",
			answerHistory: null,
		})),
	).toBe(false);
	expect(
		await readAnswerHistory(async () => ({
			type: "PRACTICE",
			answerHistory: true,
		})),
	).toBe(true);
	expect(
		await readAnswerHistory(async () => ({
			type: "QUIZ",
			answerHistory: false,
		})),
	).toBe(false);
});

test("readAnswerHistory omits the value when the read throws", async () => {
	const value = await readAnswerHistory(async () => {
		throw new Error("database is gone");
	});
	expect(value).toBeUndefined();
});

test("readAnswerHistory omits the value when the read throws synchronously", async () => {
	const value = await readAnswerHistory(() => {
		throw new Error("boom");
	});
	expect(value).toBeUndefined();
});

test("readAnswerHistory omits the value when the exam is not found", async () => {
	expect(await readAnswerHistory(async () => null)).toBeUndefined();
});
