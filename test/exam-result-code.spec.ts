import { expect, test } from "@playwright/test";
import { examResult } from "@/services/exam-result";

const T0 = new Date("2026-03-10T10:00:00Z");

/// `T0` shifted by `minutes`, so "later" reads as a bigger number.
function at(minutes: number): Date {
	return new Date(T0.getTime() + minutes * 60_000);
}

type Kind = "AUTOSAVE" | "SUBMIT" | "FINAL";
type Status = "PENDING_GRADE" | "WILL_NOT_GRADE" | "PRETEST_FAILED";

function sent(
	publicId: string,
	minutes: number,
	kind: Kind = "SUBMIT",
	status: Status = "PENDING_GRADE",
) {
	return { publicId, question: "q", createdAt: at(minutes), kind, status };
}

function pass(submission: string, score: string, minutes: number) {
	return { submission, score, feedback: null, updatedAt: at(minutes) };
}

const POLICY = { codePenalty: { q: 0.2 } };

test("examResult code: pretest failure, 0.6 then 1.0 with penalty 0.2 is 0.8", () => {
	const result = examResult(
		["q"],
		[sent("a", 1, "SUBMIT", "PRETEST_FAILED"), sent("b", 2), sent("c", 3)],
		[pass("b", "3/5", 5), pass("c", "1", 6)],
		POLICY,
	);

	expect(result.questions[0]).toMatchObject({
		status: "graded",
		score: 0.8,
		submission: "c",
	});
	expect(result.total).toBe(0.8);
});

test("examResult code: the question lists each graded submission with its discount", () => {
	const result = examResult(
		["q"],
		[sent("b", 2), sent("c", 3)],
		[pass("b", "3/5", 5), pass("c", "1", 6)],
		POLICY,
	);

	expect(result.questions[0]?.codeAttempts).toEqual([
		{ submission: "b", score: 0.6, discounted: 0.6, counts: false },
		{ submission: "c", score: 1, discounted: 0.8, counts: true },
	]);
});

test("examResult code: a practice exam has no discount", () => {
	const result = examResult(
		["q"],
		[sent("b", 2), sent("c", 3)],
		[pass("b", "3/5", 5), pass("c", "1", 6)],
		{ ...POLICY, practice: true },
	);

	expect(result.questions[0]?.score).toBe(1);
});

test("examResult code: without a penalty for the question it is 0.2", () => {
	const result = examResult(
		["q"],
		[sent("b", 2), sent("c", 3)],
		[pass("b", "3/5", 5), pass("c", "1", 6)],
	);

	expect(result.questions[0]?.score).toBe(0.8);
});

test("examResult code: an earlier better submission counts over a later worse one", () => {
	const result = examResult(
		["q"],
		[sent("b", 2), sent("c", 3)],
		[pass("b", "9/10", 5), pass("c", "1/2", 6)],
		POLICY,
	);

	expect(result.questions[0]).toMatchObject({ score: 0.9, submission: "b" });
});

test("examResult code: a human pass replaces the bot's grade on that submission", () => {
	const result = examResult(
		["q"],
		[sent("b", 2)],
		[pass("b", "1/2", 5), pass("b", "1", 9)],
		POLICY,
	);

	expect(result.questions[0]?.score).toBe(1);
});

test("examResult code: the newest submission still waiting makes the question pending", () => {
	const result = examResult(
		["q"],
		[sent("b", 2), sent("c", 3)],
		[pass("b", "3/5", 5)],
		POLICY,
	);

	expect(result.questions[0]).toMatchObject({ status: "pending", score: null });
	expect(result.total).toBeNull();
});

test("examResult code: only submissions that failed the pretest score zero", () => {
	const result = examResult(
		["q"],
		[sent("b", 2, "SUBMIT", "PRETEST_FAILED")],
		[],
		POLICY,
	);

	expect(result.questions[0]).toMatchObject({ status: "graded", score: 0 });
});

test("examResult code: autosaves do not count once a submission exists", () => {
	const result = examResult(
		["q"],
		[sent("b", 2), sent("auto", 9, "AUTOSAVE")],
		[pass("b", "1", 5)],
		POLICY,
	);

	expect(result.questions[0]).toMatchObject({ score: 1, submission: "b" });
});

test("examResult code: a final submission counts as a submission", () => {
	const result = examResult(
		["q"],
		[sent("b", 2, "FINAL")],
		[pass("b", "1/2", 5)],
		POLICY,
	);

	expect(result.questions[0]?.score).toBe(0.5);
});

test("examResult code: with autosaves only, the newest one is judged as before", () => {
	const result = examResult(
		["q"],
		[sent("a", 1, "AUTOSAVE"), sent("b", 2, "AUTOSAVE")],
		[pass("b", "1/2", 5)],
		POLICY,
	);

	expect(result.questions[0]).toMatchObject({ score: 0.5, submission: "b" });
	expect(result.questions[0]?.codeAttempts).toBeUndefined();
});

test("examResult code: a submission marked will-not-grade is left out", () => {
	const result = examResult(
		["q"],
		[sent("b", 2), sent("c", 3, "SUBMIT", "WILL_NOT_GRADE")],
		[pass("b", "1/2", 5)],
		POLICY,
	);

	expect(result.questions[0]).toMatchObject({ score: 0.5, submission: "b" });
});
