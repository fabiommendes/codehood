// Presentation helpers shared by the question list and detail pages
// (src/pages/[discipline]/[course]/questions/*).

import { type Automation, automation } from "mdq";
import type { QuestionType } from "@/core/schemas/question";
import type { Question } from "@/db/services/question.service";
import { m } from "@/i18n";
import type { QuestionDocument } from "@/mdq";

type QuestionStatus = Question["status"];

export const questionTypeLabels: Record<QuestionType, string> = {
	"multiple-choice": m.questions_type_multiple_choice(),
	"multiple-selection": m.questions_type_multiple_selection(),
	"true-false": m.questions_type_true_false(),
	essay: m.questions_type_essay(),
	upload: m.questions_type_upload(),
	numeric: m.questions_type_numeric(),
	"short-answer": m.questions_type_short_answer(),
	"fill-in": m.questions_type_fill_in(),
	ordering: m.questions_type_ordering(),
	code: m.questions_type_code(),
};

/// The label of each level of automation of a question's grading.
const automationLabels: Record<Automation, string> = {
	automatic: m.questions_automation_automatic(),
	"semi-automatic": m.questions_automation_semi_automatic(),
	manual: m.questions_automation_manual(),
};

/** How a question is graded: automatically, semi-automatically or by hand. */
export function automationLabel(question: QuestionDocument): string {
	return automationLabels[automation(question)];
}

/**
 * Whether the library grades every answer to the question, and no worker has to run code first.
 *
 * Such a question has no rubric: the grading page lists its answers instead of
 * taking them one at a time.
 */
export function isAutoGraded(question: QuestionDocument): boolean {
	return question.type !== "code" && automation(question) === "automatic";
}

/**
 * The type of a question and how it is graded, as one line of text.
 *
 * @example
 * questionKindLabel(choiceQuestion); // "Multiple choice · Automatic grading"
 */
export function questionKindLabel(question: QuestionDocument): string {
	return `${questionTypeLabels[question.type]} · ${automationLabels[automation(question)]}`;
}

/** Sentence-case label for each question status. */
export const questionStatusLabels: Record<QuestionStatus, string> = {
	DRAFT: m.questions_status_draft(),
	PUBLISHED: m.questions_status_published(),
	HIDDEN: m.questions_status_hidden(),
	ARCHIVED: m.questions_status_archived(),
};

/** The DaisyUI badge class matching a question's status. */
export function statusBadgeClass(status: QuestionStatus): string {
	switch (status) {
		case "PUBLISHED":
			return "badge-success";
		case "DRAFT":
			return "badge-outline";
		case "HIDDEN":
			return "badge-warning";
		case "ARCHIVED":
			return "badge-neutral";
	}
}
