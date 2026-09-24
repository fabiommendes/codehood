// Presentation helpers shared by the exam list and detail pages
// (src/pages/[discipline]/[course]/exams/*).

import type { Duration } from "@/core/schemas";
import type { Exam } from "@/db";
import { durationToMinutes } from "@/utils/schedule-time";

type ExamStatus = Exam["status"];
type ExamType = Exam["type"];

export const examTypeLabels: Record<ExamType, string> = {
	PRACTICE: "Practice",
	QUIZ: "Quiz",
	EXAM: "Exam",
};

/** The DaisyUI badge class matching an exam's status. */
export function examStatusBadgeClass(status: ExamStatus): string {
	switch (status) {
		case "DRAFT":
			return "badge-outline";
		case "ARCHIVED":
			return "badge-neutral";
		case "SCHEDULED":
			return "badge-info";
		case "ONGOING":
			return "badge-warning";
		case "COMPLETED":
			return "badge-success";
	}
}

/** `"90 min"`, or `"Untimed"` when the exam carries no duration. */
export function formatDuration(duration: Duration | null): string {
	if (duration === null) return "Untimed";
	return `${durationToMinutes(duration)} min`;
}
