// Presentation helpers shared by the exam list and detail pages
// (src/pages/[discipline]/[course]/exams/*).

import type { Duration } from "@/core/schemas";
import type { Exam } from "@/db";
import { m } from "@/i18n";
import {
	type AttemptState,
	type ExamPhase,
	examPhaseLabels,
} from "@/services/exam-state";
import { durationToMinutes } from "@/utils/schedule-time";

type ExamType = Exam["type"];

export const examTypeLabels: Record<ExamType, string> = {
	PRACTICE: m.exams_type_practice(),
	QUIZ: m.exams_type_quiz(),
	EXAM: m.exams_type_exam(),
};

/** `"90 min"`, or `"Untimed"` when the exam carries no duration. */
export function formatDuration(duration: Duration | null): string {
	if (duration === null) return m.exams_duration_untimed();
	return m.exams_duration_minutes({ minutes: durationToMinutes(duration) });
}

/** The DaisyUI badge class matching an exam's phase at a given moment. */
export function examPhaseBadgeClass(phase: ExamPhase): string {
	switch (phase) {
		case "draft":
			return "badge-outline";
		case "archived":
			return "badge-neutral";
		case "upcoming":
			return "badge-info";
		case "open":
			return "badge-warning";
		case "closed":
			return "badge-ghost";
	}
}

/**
 * The badge for an exam as one viewer sees it: their own finished attempt
 * when there is one, the exam's phase otherwise.
 *
 * @example
 * examBadge("open", { kind: "submitted" }); // { label: m.exams_badge_awaiting_grading(), ... }
 * examBadge("open"); // { label: "Open now", className: "badge-warning" }
 */
export function examBadge(
	phase: ExamPhase,
	state?: AttemptState,
): { label: string; className: string } {
	switch (state?.kind) {
		case "submitted":
			return {
				label: m.exams_badge_awaiting_grading(),
				className: "badge-info",
			};
		case "results":
			return { label: m.exams_badge_graded(), className: "badge-primary" };
		case "missed":
			return { label: m.exams_badge_missed(), className: "badge-ghost" };
		default:
			return {
				label: examPhaseLabels[phase],
				className: examPhaseBadgeClass(phase),
			};
	}
}
