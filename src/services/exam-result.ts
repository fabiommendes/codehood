/**
 * A student's grades on one exam, assembled from their attempt and the feedback on it.
 *
 * Pure: the caller fetches the attempt and the feedback it may see (a student
 * only ever receives released feedback), and this decides what each question
 * scored and what the exam totals.
 */

import { scoreValue } from "@/core/score";
import type { Feedback } from "@/db/services/feedback.service";
import type { Submission } from "@/db/services/submission.service";

export type QuestionOutcomeStatus = "graded" | "pending" | "unanswered";

/** How one question of the exam went. */
export interface QuestionOutcome {
	/// The question's slug.
	question: string;
	status: QuestionOutcomeStatus;
	/// The current verdict as a number in `[-1, 1]`, or `null` unless `graded`.
	score: number | null;
	/// Every non-empty written comment on the answer, newest first.
	comments: string[];
}

export interface ExamResult {
	/// One entry per exam question, in exam order.
	questions: QuestionOutcome[];
	/// Mean of the question scores in `[-1, 1]`, unanswered counting as zero;
	/// `null` while any answered question is still `pending`.
	total: number | null;
}

/**
 * Grades an attempt question by question.
 *
 * For each question, the answer that counts is its newest submission. Among
 * the feedback on that submission, the newest pass (by `updatedAt`) is the
 * current verdict. An answered question with no feedback is `pending`, never
 * zero. A question with no submission is `unanswered` and scores zero.
 *
 * @params questions The exam's question slugs, in exam order.
 * @params submissions Every submission of the attempt, any order.
 * @params feedback The feedback the viewer may see on those submissions.
 */
export function examResult(
	questions: string[],
	submissions: Pick<Submission, "publicId" | "question" | "createdAt">[],
	feedback: Pick<Feedback, "submission" | "score" | "feedback" | "updatedAt">[],
): ExamResult {
	const outcomes = questions.map((slug) =>
		outcomeOf(slug, submissions, feedback),
	);
	return { questions: outcomes, total: totalOf(outcomes) };
}

/// The outcome of one question: its newest submission, judged by the newest feedback on it.
function outcomeOf(
	slug: string,
	submissions: Pick<Submission, "publicId" | "question" | "createdAt">[],
	feedback: Pick<Feedback, "submission" | "score" | "feedback" | "updatedAt">[],
): QuestionOutcome {
	const counting = submissions
		.filter((submission) => submission.question === slug)
		.reduce<(typeof submissions)[number] | null>(
			(newest, submission) =>
				!newest || submission.createdAt > newest.createdAt
					? submission
					: newest,
			null,
		);
	if (!counting) {
		return { question: slug, status: "unanswered", score: null, comments: [] };
	}

	const passes = feedback
		.filter((entry) => entry.submission === counting.publicId)
		.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
	const comments = passes
		.map((entry) => entry.feedback)
		.filter((text): text is string => !!text?.trim());

	const verdict = passes[0] ? scoreValue(passes[0].score) : null;
	if (verdict === null) {
		return { question: slug, status: "pending", score: null, comments };
	}
	return { question: slug, status: "graded", score: verdict, comments };
}

/// The mean score, unanswered counting as zero; `null` with no questions or any pending.
function totalOf(outcomes: QuestionOutcome[]): number | null {
	if (outcomes.length === 0) return null;
	if (outcomes.some((outcome) => outcome.status === "pending")) return null;
	const sum = outcomes.reduce((acc, outcome) => acc + (outcome.score ?? 0), 0);
	return sum / outcomes.length;
}

/**
 * A score in `[-1, 1]` as a whole percentage, e.g. `0.833` → `"83%"`.
 *
 * Rounds half away from zero; `-0.5` is `"-50%"`.
 */
export function formatScore(score: number): string {
	// Trimming to 12 significant digits keeps 0.145 * 100 from landing on 14.499999999999998.
	const magnitude = Math.round(Number((Math.abs(score) * 100).toPrecision(12)));
	if (magnitude === 0) return "0%";
	return `${score < 0 ? "-" : ""}${magnitude}%`;
}
