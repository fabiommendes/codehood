/**
 * Whether the browser records the edit history of open answers in an exam.
 */

import type { Exam } from "@/db/services/exam.service";

/// What the rule needs from an exam. `answerHistory` is null until an
/// instructor flips the switch on the exam page.
export interface AnswerHistorySetting {
	type: Exam["type"];
	answerHistory: boolean | null;
}

/**
 * The effective answer-history switch of `exam`.
 *
 * An explicit `answerHistory` wins; null follows the exam type: on for `EXAM`
 * and `QUIZ`, off for `PRACTICE`.
 *
 * @example
 * effectiveAnswerHistory({ type: "EXAM", answerHistory: null }); // true
 * effectiveAnswerHistory({ type: "PRACTICE", answerHistory: null }); // false
 * effectiveAnswerHistory({ type: "PRACTICE", answerHistory: true }); // true
 */
export function effectiveAnswerHistory(exam: AnswerHistorySetting): boolean {
	return exam.answerHistory ?? exam.type !== "PRACTICE";
}
