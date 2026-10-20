// Presentation helpers shared by the question list and detail pages
// (src/pages/[discipline]/[course]/questions/*).

import type { QuestionType } from "@/core/schemas";
import type { Question } from "@/db/services/question.service";
import { m } from "@/i18n";

type QuestionStatus = Question["status"];

export const questionTypeLabels: Record<QuestionType, string> = {
	"multiple-choice": m.questions_type_multiple_choice(),
	"multiple-selection": m.questions_type_multiple_selection(),
	"true-false": m.questions_type_true_false(),
	essay: m.questions_type_essay(),
	numeric: m.questions_type_numeric(),
	"short-answer": m.questions_type_short_answer(),
	"fill-in": m.questions_type_fill_in(),
};

/** Sentence-case label for each question status. */
export const questionStatusLabels: Record<QuestionStatus, string> = {
	DRAFT: m.questions_status_draft(),
	PUBLISHED: m.questions_status_published(),
	ARCHIVED: m.questions_status_archived(),
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
