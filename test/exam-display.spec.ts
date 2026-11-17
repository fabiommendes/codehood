import { expect, test } from "@playwright/test";
import type { ExamPhase } from "@/services/exam-state";
import { examBadge, formatDuration } from "@/utils/exam-display";
import { formatDateTime, toDuration } from "@/utils/schedule-time";

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
		["open", "Open"],
		["closed", "Closed"],
	];
	for (const [phase, label] of phases) {
		expect(examBadge(phase).label).toBe(label);
	}
});

test("a duration under an hour reads in minutes, longer ones in hours and minutes", () => {
	expect(formatDuration(null)).toBe("Untimed");
	expect(formatDuration(toDuration(45))).toBe("45 min");
	expect(formatDuration(toDuration(60))).toBe("1h");
	expect(formatDuration(toDuration(150))).toBe("2h 30 min");
});

test("a duration of a day or more reads as the moment the exam ends", () => {
	const start = new Date("2026-11-16T12:00:00Z");
	const end = new Date("2026-11-18T12:00:00Z");
	expect(formatDuration(toDuration(2 * 24 * 60), start)).toBe(
		`until ${formatDateTime(end)}`,
	);
	// Without a start there is no end to show.
	expect(formatDuration(toDuration(24 * 60))).toBe("24h");
	// A day less a minute still reads in hours.
	expect(formatDuration(toDuration(24 * 60 - 1), start)).toBe("23h 59 min");
});
