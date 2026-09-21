// Presentation helpers shared by the question list and detail pages
// (src/pages/[discipline]/[course]/questions/*).

import type { QuestionType } from "@/core/schemas";
import type { Question } from "@/db/services/question.service";

type QuestionStatus = Question["status"];

export const questionTypeLabels: Record<QuestionType, string> = {
	"multiple-choice": "Multiple choice",
	"multiple-selection": "Multiple selection",
	"true-false": "True / false",
	essay: "Essay",
	numeric: "Numeric",
	"short-answer": "Short answer",
	"fill-in": "Fill in the blank",
};

/** The DaisyUI badge class matching a question's status. */
export function statusBadgeClass(status: QuestionStatus): string {
	switch (status) {
		case "PUBLISHED":
			return "badge-success";
		case "DRAFT":
			return "badge-outline";
		case "ARCHIVED":
			return "badge-neutral";
	}
}
