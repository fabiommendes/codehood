/**
 * The model of the objective grading page: the answers to one auto-graded question grouped for review.
 *
 * Pure: the caller hands in the question document and the counting answers.
 */

import type { QuestionDocument } from "@/mdq";
import type { ResultPolicy, WeightedQuestion } from "./exam-result";
import type {
	AnswerState,
	GradingAttempt,
	GradingFeedback,
	GradingPass,
} from "./grading";
import type { QuestionStats } from "./question-stats";

/// The fewest students a group needs for its mean on the other questions to show.
export const GROUP_MEAN_MIN = 3;

/** One counting answer as the objective page reads it. */
export interface ReviewAnswer {
	author: string;
	/// The counting submission's `publicId`.
	submission: string;
	payload: unknown;
	state: AnswerState;
	/// The current verdict in [-1, 1], or `null` unless graded.
	verdict: number | null;
	passes: GradingPass[];
	/// Set when the instructor created the submission.
	createdBy?: string;
	/// The student's mean on the other questions in [-1, 1], or `null` (see `restMeans`).
	restMean: number | null;
}

/** One student of a group. */
export interface GroupMember {
	author: string;
	submission: string;
	/// The score of the newest automatic pass (`autoScoreOf`).
	autoScore: number | null;
	/// The current verdict.
	score: number | null;
	/// Whether the verdict was changed by hand (`isManualChange`).
	changed: boolean;
	restMean: number | null;
	/// What this student answered, as `responseSummary` puts it, when it differs from the row text.
	detail?: string;
}

/// What a row shows as the response, by question type.
export type ResponseCell =
	| { kind: "choice"; marker: "radio" | "checkbox"; key: boolean; text: string }
	| {
			kind: "choices";
			boxes: { letter: string; on: boolean; key: boolean }[];
			text: string;
	  }
	| { kind: "text"; text: string }
	| { kind: "chips"; chips: { text: string; ok: boolean }[]; text: string }
	| {
			kind: "statement";
			text: string;
			truth: boolean;
			marked: { true: number; false: number };
	  };

/** One row of a grouped table. */
export interface AnswerGroup {
	/// Unique within its section.
	id: string;
	cell: ResponseCell;
	/// A second line under the response, e.g. "3 grafias".
	sub?: string;
	count: number;
	/// count / answers of the section, in [0, 1].
	share: number;
	/// The common verdict of the graded members; "varies" when they differ; `null` with none graded.
	score: number | "varies" | null;
	/// How many members are `changed`.
	changed: number;
	/// Mean of the members' `restMean`, `null` when fewer than GROUP_MEAN_MIN members have one.
	mean: number | null;
	/// Whether the row asks to check the key (see `needsReview`).
	review: boolean;
	members: GroupMember[];
}

/// One block of the page: a grouped table, a histogram, a matrix, or the list of who missed a blank.
export type ReviewSection =
	| {
			kind: "groups";
			block:
				| "choices"
				| "alternatives"
				| "combinations"
				| "statements"
				| "texts"
				| "blank"
				| "values"
				| "orders";
			/// The blank's label for `block: "blank"` ("Lacuna 1"), absent otherwise.
			label?: string;
			/// Which column the score shows: the score, accepted yes/no/partial, or none.
			column: "score" | "accepted" | "none";
			rows: AnswerGroup[];
	  }
	| { kind: "histogram"; histogram: NumericHistogram }
	| { kind: "matrix"; matrix: OrderingMatrix }
	/// Fill-in: who missed any blank, most misses first.
	| { kind: "missed"; members: GroupMember[] };

/** The distribution of numeric values around the key. */
export interface NumericHistogram {
	/// The accepted range of the key: answer ± max(absolute, |answer| × relative); [answer, answer] without tolerance.
	band: { low: number; high: number };
	/// The zoomed axis: the band widened by twice its width each side (by max(|answer| × 0.05, 1) when the band has width 0).
	window: { low: number; high: number };
	/// One bar per distinct value inside the window, ascending, with how many of them scored 1.
	bins: { value: number; count: number; correct: number }[];
	/// Values outside the window: the 4 largest groups by count, then one `value: null` bar with the rest.
	outside: { value: number | null; count: number }[];
}

/** Where each line of the key landed in the answers. */
export interface OrderingMatrix {
	/// The key's lines, in key order.
	steps: string[];
	/// cells[i][p]: how many answers placed step i at position p (line identity as `responseSummary` matches it).
	cells: number[][];
	/// The number of answers the matrix counts.
	answers: number;
}

/// An answer that needs the instructor before the page is done.
export type AttentionRow =
	| { kind: "pending"; author: string; submission: string }
	| { kind: "regrade"; author: string; submission: string; request: string };

/** A student whose result on the question the instructor changed. */
export interface OverrideRow {
	author: string;
	submission: string;
	kind: "grade" | "sanction";
	/// The automatic score (grade) or the score before the factor (sanction); `null` when the student did not answer.
	auto: number | null;
	final: number | null;
	comment: string | null;
	when: Date;
	/// The adjustment, for `kind: "sanction"`, so the row can revoke it.
	adjustment?: { publicId: string; updatedAt: Date };
}

/** The whole model of the page. */
export interface ObjectiveReview {
	summary: {
		/// Answers that statistics count (no instructor-created ones).
		answers: number;
		/// questionStats.correct for the question, in [0, 1], or `null`.
		correct: number | null;
		/// The discrimination value when `discriminationFlag` flags it, else `null`.
		lowDiscrimination: number | null;
		/// Answers in state `pending`.
		pending: number;
	};
	/// Pending answers first (submission order), then open regrade requests.
	attention: AttentionRow[];
	sections: ReviewSection[];
	/// Manual changes and question sanctions, newest `when` first.
	overrides: OverrideRow[];
}

/**
 * Each author's mean score on the exam's other questions, from `examResult` without adjustments.
 *
 * Weighted by the question weights, with `pending` questions left out and unanswered and not-graded counting 0;
 * `null` when no other question has a score.
 */
export function restMeans(
	_questions: readonly WeightedQuestion[],
	_question: string,
	_attempts: readonly GradingAttempt[],
	_feedback: readonly GradingFeedback[],
	_policy?: ResultPolicy,
): Map<string, number | null> {
	throw new Error("not implemented");
}

/**
 * Whether a wrong row asks to check the key: its mean is at least `reference`.
 *
 * `false` when either is `null` or the row is right.
 */
export function needsReview(
	_row: { mean: number | null; right: boolean },
	_reference: number | null,
): boolean {
	throw new Error("not implemented");
}

/**
 * The sections of the page for the question's type, leaving out instructor-created answers.
 *
 * Any type the page does not review gives no section.
 */
export function answerSections(
	_question: QuestionDocument,
	_answers: readonly ReviewAnswer[],
): ReviewSection[] {
	throw new Error("not implemented");
}

/** The whole page model: `answerSections` plus summary, attention and overrides. */
export function objectiveReview(_input: {
	question: QuestionDocument;
	slug: string;
	answers: readonly ReviewAnswer[];
	stats: Pick<QuestionStats, "correct" | "discrimination">;
	/// Open regrade requests on this question: submission publicId to request publicId.
	regrades: ReadonlyMap<string, string>;
	/// Active adjustments on this question, by author.
	sanctions: ReadonlyMap<
		string,
		{ publicId: string; value: number; reason: string | null; updatedAt: Date }
	>;
}): ObjectiveReview {
	throw new Error("not implemented");
}
