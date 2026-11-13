import { expect, test } from "@playwright/test";
import { spentAttempts } from "@/services/code-grading";

type Sent = Parameters<typeof spentAttempts>[0][number];

const sent = (fields: Partial<Sent>): Sent => ({
	kind: "SUBMIT",
	status: "PENDING_GRADE",
	jobState: "DONE",
	...fields,
});

test("spentAttempts: counts sent submissions whose job is done", () => {
	expect(
		spentAttempts([
			sent({ status: "GRADED_AUTOMATICALLY" }),
			sent({ kind: "FINAL", status: "GRADED_MANUALLY" }),
		]),
	).toBe(2);
});

test("spentAttempts: a failed pretest costs nothing", () => {
	expect(spentAttempts([sent({ status: "PRETEST_FAILED" })])).toBe(0);
});

test("spentAttempts: autosaves and submissions without a finished job do not count", () => {
	expect(
		spentAttempts([
			sent({ kind: "AUTOSAVE", jobState: null }),
			sent({ jobState: "QUEUED" }),
			sent({ jobState: "CLAIMED" }),
			sent({ jobState: "FAILED" }),
			sent({ jobState: "CANCELLED" }),
			sent({ jobState: null }),
		]),
	).toBe(0);
});

test("spentAttempts: an empty history has spent nothing", () => {
	expect(spentAttempts([])).toBe(0);
});
