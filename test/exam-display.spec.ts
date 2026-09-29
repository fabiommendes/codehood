import { expect, test } from "@playwright/test";
import type { ExamPhase } from "@/services/exam-state";
import { examBadge } from "@/utils/exam-display";

test("a missed attempt is labelled Missed", () => {
	const badge = examBadge("closed", { kind: "missed" });

	expect(badge.label).toBe("Missed");
	expect(badge.className).not.toBe("");
});

test("without an attempt state, a closed exam is still labelled Closed", () => {
	expect(examBadge("closed").label).toBe("Closed");
	expect(examBadge("closed", { kind: "can-start" }).label).not.toBe("Missed");
});

for (const [state, label] of [
	[{ kind: "submitted" }, "Awaiting grading"],
	[{ kind: "results" }, "Graded"],
] as const) {
	test(`a ${state.kind} attempt keeps its label "${label}" on a closed exam`, () => {
		expect(examBadge("closed", state).label).toBe(label);
	});
}

test("the phase label carries through for a viewer with no finished attempt", () => {
	const phases: [ExamPhase, string][] = [
		["upcoming", "Upcoming"],
		["open", "Open now"],
		["closed", "Closed"],
	];
	for (const [phase, label] of phases) {
		expect(examBadge(phase).label).toBe(label);
	}
});
