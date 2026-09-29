// Presentation helpers shared by the exam list and detail pages
// (src/pages/[discipline]/[course]/exams/*).

import type { Duration } from "@/core/schemas";
import type { Exam } from "@/db";
import {
	type AttemptState,
	type ExamPhase,
	examPhaseLabels,
} from "@/services/exam-state";
import { durationToMinutes } from "@/utils/schedule-time";

type ExamType = Exam["type"];

export const examTypeLabels: Record<ExamType, string> = {
	PRACTICE: "Practice",
	QUIZ: "Quiz",
	EXAM: "Exam",
};

/** `"90 min"`, or `"Untimed"` when the exam carries no duration. */
export function formatDuration(duration: Duration | null): string {
	if (duration === null) return "Untimed";
	return `${durationToMinutes(duration)} min`;
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
			return "badge-success";
	}
}

/**
 * The badge for an exam as one viewer sees it: their own finished attempt
 * when there is one, the exam's phase otherwise.
 *
 * @example
 * examBadge("open", { kind: "submitted" }); // { label: "Awaiting grading", ... }
 * examBadge("open"); // { label: "Open now", className: "badge-warning" }
 */
export function examBadge(
	phase: ExamPhase,
	state?: AttemptState,
): { label: string; className: string } {
	switch (state?.kind) {
		case "submitted":
			return { label: "Awaiting grading", className: "badge-info" };
		case "results":
			return { label: "Graded", className: "badge-primary" };
		default:
			return {
				label: examPhaseLabels[phase],
				className: examPhaseBadgeClass(phase),
			};
	}
}
