/**
 * Whether the browser records the edit history of open answers in an exam.
 */

import { ANSWER_HISTORY_LATE_MS, EXAM_ANSWER_GRACE_MS } from "@/core/constants";
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

/**
 * The effective answer-history switch of the exam `read` finds, or `undefined` when it cannot be read.
 *
 * Any failure, thrown or a missing exam, is swallowed: the value rides along
 * with a saved answer and must never be the reason the save fails.
 *
 * @example
 * await readAnswerHistory(async () => ({ type: "EXAM", answerHistory: null })); // true
 * await readAnswerHistory(async () => { throw new Error("down"); }); // undefined
 */
export async function readAnswerHistory(
	read: () => Promise<AnswerHistorySetting | null>,
): Promise<boolean | undefined> {
	try {
		const exam = await read();
		return exam ? effectiveAnswerHistory(exam) : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Whether the edit history follows `field` of a question of `questionType`.
 *
 * The single place that decides which answers have a history: the `answer`
 * field of an essay, which includes code essays.
 *
 * @example
 * isHistoryField("essay", "answer"); // true
 * isHistoryField("multiple-choice", "answer"); // false
 */
export function isHistoryField(
	questionType: string | undefined,
	field: string,
): boolean {
	return field === "answer" && questionType === "essay";
}

/// Whether the edit history still takes batches of an attempt, and how late they are.
export type AnswerHistoryWindow =
	| { open: true; lateMs: number | null }
	| { open: false; reason: "deadline" | "finished" };

/**
 * The write window of the edit history of one attempt at `now`.
 *
 * While the attempt still takes answers (`accepting`) the window is open and
 * nothing is late. Afterwards it stays open for {@link ANSWER_HISTORY_LATE_MS}
 * from `C = min(deadline + grace, closedAt)`, and a batch inside it is that
 * many milliseconds late. With no deadline and no `closedAt` to measure from,
 * or before `C` (an exam closed by status ahead of the deadline), it is shut.
 *
 * @params closedAt When the attempt was delivered or closed, or `null` while it takes submissions.
 */
export function answerHistoryWindow(args: {
	now: Date;
	accepting: boolean;
	deadline: Date | null;
	closedAt: Date | null;
}): AnswerHistoryWindow {
	if (args.accepting) return { open: true, lateMs: null };

	const graceEnd = args.deadline
		? args.deadline.getTime() + EXAM_ANSWER_GRACE_MS
		: null;
	const closed = args.closedAt?.getTime() ?? null;
	const start =
		closed !== null && (graceEnd === null || closed <= graceEnd)
			? closed
			: graceEnd;
	const reason = start === closed ? "finished" : "deadline";
	if (start === null) return { open: false, reason: "deadline" };

	const elapsed = args.now.getTime() - start;
	if (elapsed < 0 || elapsed > ANSWER_HISTORY_LATE_MS) {
		return { open: false, reason };
	}
	return { open: true, lateMs: elapsed };
}
