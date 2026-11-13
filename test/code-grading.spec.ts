import { expect, test } from "@playwright/test";
import fc from "fast-check";
import { InvalidData } from "@/core/error";
import {
	codeQuestionScore,
	decideReport,
	studentReportView,
} from "@/services/code-grading";

const SOURCE = [
	"import pytest", // 1
	"", // 2
	"# mdq: [0] {public} Runs the example", // 3
	"def test_example(): ...", // 4
	"", // 5
	"# mdq: [+3] Handles the empty list", // 6
	"# mdq: > Check the empty list.", // 7
	"def test_empty(): ...", // 8
	"", // 9
	"# mdq: [+1] Handles the secret input", // 10
	"# mdq: > Look at the secret input.", // 11
	"def test_secret_dungeon(): ...", // 12
].join("\n");

const QUESTION = {
	type: "code" as const,
	stem: "Write it.",
	language: "python",
	tests: [{ format: "pytest", text: SOURCE }],
};

type Verdict = "pass" | "fail" | "error";

function report(
	verdicts: { example: Verdict; empty: Verdict; secret: Verdict },
	extra: Record<string, unknown> = {},
) {
	return {
		status: "completed",
		cases: [
			{ source: 0, line: 4, verdict: verdicts.example, id: "test_example" },
			{ source: 0, line: 8, verdict: verdicts.empty, id: "test_empty" },
			{
				source: 0,
				line: 12,
				verdict: verdicts.secret,
				id: "test_secret_dungeon",
				message: "secret message: dungeon",
			},
		],
		...extra,
	};
}

const ALL_PASS = { example: "pass", empty: "pass", secret: "pass" } as const;

//
// decideReport
//

test("decideReport: a runner-error report asks for a retry", () => {
	const decision = decideReport(QUESTION, {
		status: "runner-error",
		cases: [],
		message: "container died",
	});

	expect(decision).toEqual({ outcome: "retry", error: "container died" });
});

test("decideReport: a build-error report fails the pretest", () => {
	const decision = decideReport(QUESTION, {
		status: "build-error",
		cases: [],
		build: "SyntaxError",
	});

	expect(decision).toEqual({ outcome: "pretest-failed" });
});

test("decideReport: a failing public zero-value case fails the pretest", () => {
	const decision = decideReport(
		QUESTION,
		report({ example: "fail", empty: "pass", secret: "pass" }),
	);

	expect(decision).toEqual({ outcome: "pretest-failed" });
});

test("decideReport: a pretest that errors or is skipped fails the pretest", () => {
	const decision = decideReport(
		QUESTION,
		report({ example: "error", empty: "pass", secret: "pass" }),
	);

	expect(decision.outcome).toBe("pretest-failed");
});

test("decideReport: a hidden failure does not fail the pretest", () => {
	const decision = decideReport(
		QUESTION,
		report({ example: "pass", empty: "pass", secret: "fail" }),
	);

	expect(decision.outcome).toBe("graded");
});

test("decideReport: the score is the fraction of the rubric that passed", () => {
	const decision = decideReport(
		QUESTION,
		report({ example: "pass", empty: "pass", secret: "fail" }),
	);

	expect(decision).toMatchObject({ outcome: "graded", score: 0.75 });
});

test("decideReport: the feedback has one line per item, with the hint of a failed one", () => {
	const decision = decideReport(
		QUESTION,
		report({ example: "pass", empty: "pass", secret: "fail" }),
	);

	expect(decision).toMatchObject({
		feedback: [
			"✓ Runs the example",
			"✓ Handles the empty list",
			"✗ Handles the secret input",
			"Look at the secret input.",
		].join("\n"),
	});
});

test("decideReport: a perfect report scores 1 with no hint", () => {
	const decision = decideReport(QUESTION, report(ALL_PASS));

	expect(decision).toMatchObject({ outcome: "graded", score: 1 });
	expect(decision).not.toMatchObject({
		feedback: expect.stringContaining("Check"),
	});
});

test("decideReport: an invalid report is an InvalidData carrying the mdq message", () => {
	let thrown: unknown;
	try {
		decideReport(QUESTION, { status: "completed", cases: [], bogus: 1 });
	} catch (error) {
		thrown = error;
	}

	expect(thrown).toBeInstanceOf(InvalidData);
	expect((thrown as InvalidData).status).toBe(400);
	expect((thrown as InvalidData).message).toContain("not valid");
});

test("decideReport: a report that does not fit the question is an InvalidData", () => {
	const bad = {
		status: "completed",
		cases: [{ source: 3, line: 1, verdict: "pass" }],
	};

	expect(() => decideReport(QUESTION, bad)).toThrow(InvalidData);
});

test("decideReport: a missing report is an InvalidData", () => {
	expect(() => decideReport(QUESTION, null)).toThrow(InvalidData);
});

//
// codeQuestionScore
//

test("codeQuestionScore: no graded submission has no score", () => {
	expect(codeQuestionScore([], 0.2)).toEqual({
		score: null,
		counting: null,
		discounted: [],
	});
});

test("codeQuestionScore: 0.6 then 1.0 with penalty 0.2 is 0.8", () => {
	const result = codeQuestionScore([0.6, 1.0], 0.2);

	expect(result.score).toBe(0.8);
	expect(result.counting).toBe(1);
	expect(result.discounted).toEqual([0.6, 0.8]);
});

test("codeQuestionScore: the first submission keeps its grade when it is the best", () => {
	const result = codeQuestionScore([0.9, 0.5], 0.2);

	expect(result.score).toBe(0.9);
	expect(result.counting).toBe(0);
});

test("codeQuestionScore: a perfect submission does not discount the next one", () => {
	const result = codeQuestionScore([1, 1], 0.5);

	expect(result.discounted).toEqual([1, 1]);
});

test("codeQuestionScore: the discount has a floor of zero", () => {
	const result = codeQuestionScore([0.1, 0.2, 0.3], 0.5);

	expect(result.discounted).toEqual([0.1, 0, 0]);
	expect(result.score).toBe(0.1);
});

test("codeQuestionScore: a negative score of scoreCode floors to zero", () => {
	expect(codeQuestionScore([-1], 0.2).score).toBe(0);
});

test("codeQuestionScore: no float noise in the discount", () => {
	const result = codeQuestionScore([0, 0, 0, 1], 0.2);

	expect(result.score).toBe(0.4);
});

test("codeQuestionScore: a zero penalty keeps the best score", () => {
	fc.assert(
		fc.property(
			fc.array(fc.integer({ min: 0, max: 100 }), {
				minLength: 1,
				maxLength: 6,
			}),
			(percents) => {
				const scores = percents.map((p) => p / 100);

				expect(codeQuestionScore(scores, 0).score).toBe(Math.max(...scores));
			},
		),
	);
});

test("codeQuestionScore: the result is in [0, 1] and never above the best grade", () => {
	fc.assert(
		fc.property(
			fc.array(fc.integer({ min: -100, max: 100 }), {
				minLength: 1,
				maxLength: 6,
			}),
			fc.integer({ min: 0, max: 100 }),
			(percents, penalty) => {
				const scores = percents.map((p) => p / 100);
				const result = codeQuestionScore(scores, penalty / 100);

				expect(result.score).toBeGreaterThanOrEqual(0);
				expect(result.score).toBeLessThanOrEqual(Math.max(0, ...scores) + 1e-9);
			},
		),
	);
});

//
// studentReportView
//

const PRACTICE = { mode: "PRACTICE", attempts: 4, released: false } as const;

test("studentReportView: public cases carry verdict and message, hidden ones never leak", () => {
	const view = studentReportView(
		QUESTION,
		report({ example: "pass", empty: "pass", secret: "fail" }),
		PRACTICE,
	);
	const text = JSON.stringify(view);

	expect(view.publicCases).toEqual([
		{ source: 0, line: 4, verdict: "pass", id: "test_example" },
	]);
	expect(text).not.toContain("test_secret_dungeon");
	expect(text).not.toContain("secret message");
	expect(text).not.toContain("test_empty");
});

test("studentReportView: hidden items show their text and hint but no case", () => {
	const view = studentReportView(
		QUESTION,
		report({ example: "pass", empty: "pass", secret: "fail" }),
		PRACTICE,
	);

	expect(view.items).toEqual([
		{ text: "Runs the example", passed: true },
		{ text: "Handles the empty list", passed: true },
		{
			text: "Handles the secret input",
			passed: false,
			feedback: "Look at the secret input.",
		},
	]);
	expect(view.score).toBe(0.75);
});

test("studentReportView: a failed pretest shows the public cases and no grade", () => {
	const view = studentReportView(
		QUESTION,
		report({ example: "fail", empty: "pass", secret: "pass" }),
		PRACTICE,
	);

	expect(view.outcome).toBe("pretest-failed");
	expect(view.publicCases).toHaveLength(1);
	expect(view.items).toBeUndefined();
	expect(view.score).toBeUndefined();
});

test("studentReportView: a build error shows the build message", () => {
	const view = studentReportView(
		QUESTION,
		{ status: "build-error", cases: [], build: "SyntaxError: line 2" },
		PRACTICE,
	);

	expect(view).toMatchObject({
		outcome: "pretest-failed",
		build: "SyntaxError: line 2",
		publicCases: [],
	});
});

test("studentReportView: a runner-error shows nothing about the submission", () => {
	const view = studentReportView(
		QUESTION,
		{ status: "runner-error", cases: [], message: "internal path /srv/x" },
		PRACTICE,
	);

	expect(view).toEqual({ outcome: "retry", publicCases: [] });
});

test("studentReportView: the grade is hidden in a one-attempt exam until released", () => {
	const input = report(ALL_PASS);

	const hidden = studentReportView(QUESTION, input, {
		mode: "EXAM",
		attempts: 1,
		released: false,
	});
	const released = studentReportView(QUESTION, input, {
		mode: "EXAM",
		attempts: 1,
		released: true,
	});

	expect(hidden.publicCases).toHaveLength(1);
	expect(hidden.items).toBeUndefined();
	expect(hidden.score).toBeUndefined();
	expect(released.score).toBe(1);
});

test("studentReportView: an exam with several attempts shows the grade at once", () => {
	for (const mode of ["EXAM", "QUIZ"] as const) {
		const view = studentReportView(QUESTION, report(ALL_PASS), {
			mode,
			attempts: 2,
			released: false,
		});

		expect(view.score).toBe(1);
	}
});

test("studentReportView: an invalid report is an InvalidData", () => {
	expect(() => studentReportView(QUESTION, { nope: true }, PRACTICE)).toThrow(
		InvalidData,
	);
});
