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
import { durationToMinutes, formatDateTime } from "@/utils/schedule-time";

type ExamType = Exam["type"];

export const examTypeLabels: Record<ExamType, string> = {
	PRACTICE: m.exams_type_practice(),
	QUIZ: m.exams_type_quiz(),
	EXAM: m.exams_type_exam(),
};

/// Minutes in a day, from which a duration reads as the moment it ends.
const DAY_MINUTES = 24 * 60;

/**
 * An exam's duration for display: `"45 min"`, `"2h 30 min"`, or `"until Fri, Nov 20, 14:00"` when it lasts a day or more and `start` is known.
 *
 * `"Untimed"` when the exam carries no duration. Without `start`, a long
 * duration falls back to hours.
 *
 * @example
 * formatDuration(toDuration(150)); // "2h 30 min"
 */
export function formatDuration(
	duration: Duration | null,
	start?: Date | null,
): string {
	if (duration === null) return m.exams_duration_untimed();
	const total = durationToMinutes(duration);
	if (total >= DAY_MINUTES && start) {
		const end = new Date(start.getTime() + total * 60_000);
		return m.exams_duration_until({ date: formatDateTime(end) });
	}
	if (total < 60) return m.exams_duration_minutes({ minutes: total });
	const hours = Math.floor(total / 60);
	const minutes = total % 60;
	return minutes === 0
		? m.exams_duration_hours({ hours })
		: m.exams_duration_hours_minutes({ hours, minutes });
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
			return "badge-success";
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
 * examBadge("open"); // { label: "Open", className: "badge-success" }
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
