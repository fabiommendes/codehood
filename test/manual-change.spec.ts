import { expect, test } from "@playwright/test";
import {
	autoScoreOf,
	type GradingPass,
	isManualChange,
	REVERT_REF_PREFIX,
} from "@/services/grading";

// Which of an answer's passes is the server's, and whether the verdict stands because the instructor changed it.

const T0 = new Date("2026-03-10T10:00:00Z");

/// `T0` shifted by `minutes`, so "later" reads as a bigger number.
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

/// A pass by the server (no grader), unless `extra` says otherwise.
function pass(
	minutes: number,
	score: number | null,
	extra: Partial<GradingPass> = {},
): GradingPass {
	return {
		score,
		comment: null,
		grader: null,
		bot: null,
		willNotGrade: false,
		updatedAt: at(minutes),
		...extra,
	};
}

/// A pass by an instructor.
const human = (
	minutes: number,
	score: number,
	extra: Partial<GradingPass> = {},
) => pass(minutes, score, { grader: "teacher", ...extra });

/// The pass that undoes a change by hand.
const revert = (minutes: number, score: number) =>
	human(minutes, score, { ref: `${REVERT_REF_PREFIX}1234` });

test("REVERT_REF_PREFIX is revert-", () => {
	expect(REVERT_REF_PREFIX).toBe("revert-");
});

//
// autoScoreOf
//

test("autoScoreOf: the score of the automatic pass among automatic and human ones", () => {
	expect(autoScoreOf([human(2, 1), pass(1, 0.5)])).toBe(0.5);
});

test("autoScoreOf: the newest automatic pass wins, whatever the order of the list", () => {
	const old = pass(1, 0);
	const latest = pass(3, 0.5);
	const between = human(2, 1);

	expect(autoScoreOf([latest, between, old])).toBe(0.5);
	expect(autoScoreOf([old, between, latest])).toBe(0.5);
});

test("autoScoreOf: no automatic pass is null", () => {
	expect(autoScoreOf([human(2, 1), human(1, 0)])).toBeNull();
});

test("autoScoreOf: no pass at all is null", () => {
	expect(autoScoreOf([])).toBeNull();
});

test("autoScoreOf: a pass by a bot has no grader, so it is automatic", () => {
	expect(autoScoreOf([human(2, 1), pass(1, 0.25, { bot: "runner" })])).toBe(
		0.25,
	);
});

test("autoScoreOf: a negative automatic score is kept", () => {
	expect(autoScoreOf([pass(1, -0.5)])).toBe(-0.5);
});

//
// isManualChange
//

test("isManualChange: an answer with only the automatic pass was not changed", () => {
	expect(isManualChange([pass(1, 0.5)], null)).toBe(false);
});

test("isManualChange: an instructor pass after the automatic one is a change", () => {
	expect(isManualChange([human(2, 1), pass(1, 0.5)], null)).toBe(true);
});

test("isManualChange: a first human pass on a student's answer is a plain correction, not a change", () => {
	expect(isManualChange([human(1, 1)], null)).toBe(false);
	expect(isManualChange([human(1, 1)], undefined)).toBe(false);
});

test("isManualChange: a human pass on a submission the instructor created is a change", () => {
	expect(isManualChange([human(1, 1)], "teacher")).toBe(true);
});

test("isManualChange: a second human pass is a change", () => {
	expect(isManualChange([human(2, 1), human(1, 0)], null)).toBe(true);
});

test("isManualChange: a newer automatic pass over a human one is not a change", () => {
	expect(isManualChange([pass(3, 0.5), human(2, 1), pass(1, 0)], null)).toBe(
		false,
	);
});

test("isManualChange: a revert pass as the newest undoes the change", () => {
	expect(
		isManualChange([revert(3, 0.5), human(2, 1), pass(1, 0.5)], null),
	).toBe(false);
});

test("isManualChange: a revert on a submission the instructor created is no change either", () => {
	expect(isManualChange([revert(2, 0), human(1, 1)], "teacher")).toBe(false);
});

test("isManualChange: a human pass written after a revert is a change again", () => {
	expect(
		isManualChange(
			[human(4, 0.75), revert(3, 0.5), human(2, 1), pass(1, 0.5)],
			null,
		),
	).toBe(true);
});

test("isManualChange: an older revert under a newer human pass does not hide it", () => {
	expect(
		isManualChange([human(3, 1), revert(2, 0.5), pass(1, 0.5)], null),
	).toBe(true);
});

test("isManualChange: no pass at all is not a change", () => {
	expect(isManualChange([], null)).toBe(false);
	expect(isManualChange([], "teacher")).toBe(false);
});
