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
import {
	codeQuestionScore,
	DEFAULT_CODE_PENALTY,
} from "@/services/code-grading";

/// The part of a grading pass the result depends on.
export type ResultFeedback = Pick<
	Feedback,
	"submission" | "score" | "feedback" | "updatedAt"
> &
	Partial<Pick<Feedback, "blanks" | "rubricItems">>;

export type QuestionOutcomeStatus =
	| "graded"
	| "pending"
	| "unanswered"
	| "not-graded"
	| "sanctioned";

export type AdjustmentOp = "SET" | "FACTOR" | "OFFSET";

/** An active adjustment of an attempt: on one question by slug, or on the whole exam when `question` is `null`. */
export interface ResultAdjustment {
	question: string | null;
	op: AdjustmentOp;
	/// A decimal string, as stored.
	value: string;
	reason: string | null;
}

/** Groups the adjustments of every operation by the `publicId` of the attempt they hit, dropping any other field (notes). */
export function adjustmentsByResponse(
	views: readonly {
		response: string;
		question: string | null;
		op: AdjustmentOp;
		value: string;
		reason: string | null;
	}[],
): ReadonlyMap<string, ResultAdjustment[]> {
	const byResponse = new Map<string, ResultAdjustment[]>();
	for (const { response, question, op, value, reason } of views) {
		// Copied field by field: a staff view also carries the private notes, which must not ride along.
		const adjustment = { question, op, value, reason };
		const list = byResponse.get(response);
		if (list) list.push(adjustment);
		else byResponse.set(response, [adjustment]);
	}
	return byResponse;
}

/** Whether the adjustment lowers a grade: a `FACTOR` below 1. Only these block a regrade request. */
export function reducesGrade(adjustment: {
	op: AdjustmentOp;
	value: string | number;
}): boolean {
	return adjustment.op === "FACTOR" && Number(adjustment.value) < 1;
}

type AdjustmentLike = { op: AdjustmentOp; value: string | number };

/**
 * The exam total after the exam-level adjustments, or `null` when `base` is `null` and nothing fixes the total.
 *
 * Order: a FACTOR 0 gives 0; else base is the SET value or `base`; each FACTOR multiplies it while it is positive;
 * every OFFSET is added; the result is clamped to `[min(b, 0), 1]`, `b` being the base before the factors.
 * A negative calculated total is never improved by a FACTOR 0.
 */
export function adjustTotal(
	base: number | null,
	adjustments: readonly AdjustmentLike[],
): number | null {
	const values = (op: AdjustmentOp) =>
		adjustments
			.filter((entry) => entry.op === op)
			.map((entry) => Number(entry.value));
	const set = values("SET")[0];
	const factors = values("FACTOR");
	const start = set ?? base;
	if (factors.includes(0)) {
		return set === undefined && start !== null && start < 0 ? start : 0;
	}
	if (start === null) return null;
	let total = start;
	for (const factor of factors) {
		if (total > 0) total *= factor;
	}
	for (const offset of values("OFFSET")) total += offset;
	return Math.min(1, Math.max(Math.min(start, 0), total));
}

/** Whether the adjustments define the total by themselves: a SET, or a FACTOR 0. */
export function fixesTotal(adjustments: readonly AdjustmentLike[]): boolean {
	return adjustments.some(
		(entry) =>
			entry.op === "SET" ||
			(entry.op === "FACTOR" && Number(entry.value) === 0),
	);
}

/// The part of a submission the result depends on. A missing `status` reads as `PENDING_GRADE`, a missing `kind` as `AUTOSAVE`.
export type ResultSubmission = Pick<
	Submission,
	"publicId" | "question" | "createdAt"
> &
	Partial<Pick<Submission, "status" | "id">> & {
		kind?: "AUTOSAVE" | "SUBMIT" | "FINAL";
		/// A submission the student sent for grading may carry a `PRETEST_FAILED` status.
		status?: Submission["status"] | "PRETEST_FAILED";
	};

/// What the result needs to know about the exam to score `code` questions.
export interface ResultPolicy {
	/// A `PRACTICE` exam has no discount for earlier wrong submissions.
	practice?: boolean;
	/// The discount per earlier wrong submission of each `code` question, by slug. Missing: 0.2.
	codePenalty?: Record<string, number>;
}

/**
 * The {@link ResultPolicy} of an exam of `type`, given the discount of each `code` question by slug.
 *
 * @example
 * resultPolicy("PRACTICE", {}) // { practice: true, codePenalty: {} }
 */
export function resultPolicy(
	type: string,
	codePenalty: Record<string, number>,
): ResultPolicy {
	return { practice: type === "PRACTICE", codePenalty };
}

/// One graded submission of a `code` question and how it weighs in the score.
export interface CodeAttemptOutcome {
	/// The submission's `publicId`.
	submission: string;
	/// Its current verdict, before any discount.
	score: number;
	/// Its score after the discount for earlier wrong submissions, floored at 0.
	discounted: number;
	/// Whether this is the submission that gives the question's score.
	counts: boolean;
}

/**
 * Whether submission `a` counts over `b`: the newer one, the higher id breaking a tie in the timestamp.
 *
 * The single rule that picks the counting submission of a question, shared by
 * the exam result and the grading queue.
 */
export function isNewerSubmission(
	a: { createdAt: Date; id?: number },
	b: { createdAt: Date; id?: number },
): boolean {
	const diff = a.createdAt.getTime() - b.createdAt.getTime();
	return diff > 0 || (diff === 0 && (a.id ?? 0) > (b.id ?? 0));
}

/**
 * The grading passes newest first by `updatedAt`, the one listed later breaking a tie.
 *
 * The first one is the current verdict; shared by the exam result and the grading queue.
 */
export function newestPassesFirst<T extends { updatedAt: Date }>(
	passes: readonly T[],
): T[] {
	return passes
		.map((pass, index) => ({ pass, index }))
		.sort(
			(a, b) =>
				b.pass.updatedAt.getTime() - a.pass.updatedAt.getTime() ||
				b.index - a.index,
		)
		.map(({ pass }) => pass);
}

/** How one question of the exam went. */
export interface QuestionOutcome {
	/// The question's slug.
	question: string;
	/// The `publicId` of the submission that counts for the question; absent when `unanswered`.
	submission?: string;
	status: QuestionOutcomeStatus;
	/// The current verdict as a number in `[-1, 1]`, or `null` unless `graded`.
	score: number | null;
	/// The blank grades of the current verdict, when the instructor graded the blanks one by one.
	blanks?: Feedback["blanks"];
	/// The rubric items the current verdict applies, in rubric order. A student reads only what the feedback they may see carries.
	rubricItems?: NonNullable<Feedback["rubricItems"]>;
	/// Every non-empty written comment on the answer, newest first.
	comments: string[];
	/// The graded submissions of a `code` question, oldest first. Absent for other questions.
	codeAttempts?: CodeAttemptOutcome[];
	/// The `FACTOR` adjustment on the question, with what it was before it applied.
	adjustment?: {
		op: "FACTOR";
		value: number;
		reason: string | null;
		original: {
			status: Exclude<QuestionOutcomeStatus, "sanctioned">;
			score: number | null;
		};
	};
}

/// An exam question as `examResult` takes it: its slug and its weight in the total.
export interface WeightedQuestion {
	slug: string;
	weight: number;
}

/**
 * The slugs as questions that all weigh 1.
 *
 * @example
 * unweighted(["a", "b"]) // [{ slug: "a", weight: 1 }, { slug: "b", weight: 1 }]
 */
export function unweighted(slugs: readonly string[]): WeightedQuestion[] {
	return slugs.map((slug) => ({ slug, weight: 1 }));
}

export interface ExamResult {
	/// One entry per exam question, in exam order.
	questions: QuestionOutcome[];
	/// Weighted mean of the question scores in `[-1, 1]`, unanswered and
	/// not-graded counting as zero; `null` while any answered question is still `pending`.
	total: number | null;
	/// How many questions are `pending` after the adjustments; 0 when the adjustments fix the total.
	pending: number;
	/// The adjustments of the whole exam, in order of application: SET, then FACTORs, then OFFSETs.
	adjustments?: {
		op: AdjustmentOp;
		value: number;
		reason: string | null;
	}[];
	/// The total after the question adjustments, before any adjustment of the exam.
	original?: { total: number | null };
}

/**
 * Grades an attempt question by question.
 *
 * For each question, the answer that counts is its newest submission. Among
 * the feedback on that submission, the newest pass (by `updatedAt`) is the
 * current verdict. An answered question with no feedback is `pending`, never
 * zero. A question with no submission is `unanswered` and scores zero.
 *
 * A counting submission whose status is `WILL_NOT_GRADE` is `not-graded`,
 * whatever feedback it has: its score is `null`, it counts as zero in the
 * total, it is not pending, and it keeps its comments.
 *
 * A `FACTOR` adjustment on a question with value 0 makes it `sanctioned` with
 * score 0, even without a grade, and it is not pending.
 * One with a value above 0 makes a graded question `sanctioned` with
 * its score times the value, and leaves one without a grade as it is.
 * A negative score is never multiplied.
 * On a `code` question the factor applies to the discounted score and
 * `codeAttempts` stays as it was.
 * The adjustments of the whole exam give the total through `adjustTotal`, and
 * `pending` is 0 when they fix the total (`fixesTotal`).
 * An adjustment on a question the exam does not have is ignored.
 *
 * @params questions The exam's questions in exam order, with their weights.
 * @params submissions Every submission of the attempt, any order.
 * A question with `SUBMIT` or `FINAL` submissions is a `code` question sent for
 * grading: its score comes from all of them (see `codeQuestionScore`), not
 * from the newest alone. Autosaves do not count then.
 *
 * @params feedback The feedback the viewer may see on those submissions.
 * @params adjustments The active adjustments of the attempt.
 * @params policy How the exam discounts `code` submissions; defaults apply when missing.
 */
export function examResult(
	questions: readonly WeightedQuestion[],
	submissions: ResultSubmission[],
	feedback: ResultFeedback[],
	adjustments: readonly ResultAdjustment[],
	policy: ResultPolicy = {},
): ExamResult {
	const outcomes = questions
		.map(({ slug }) => {
			const sent = submissions.filter(
				(submission) =>
					submission.question === slug &&
					(submission.kind === "SUBMIT" || submission.kind === "FINAL"),
			);
			if (sent.length === 0) return outcomeOf(slug, submissions, feedback);
			const penalty = policy.practice
				? 0
				: (policy.codePenalty?.[slug] ?? DEFAULT_CODE_PENALTY);
			return codeOutcomeOf(slug, sent, feedback, penalty);
		})
		.map((outcome) =>
			adjustOutcome(
				outcome,
				lowestFactor(
					adjustments.filter(
						(entry) =>
							entry.op === "FACTOR" && entry.question === outcome.question,
					),
				),
			),
		);
	const weights = questions.map((question) => question.weight);
	const calculated = totalOf(outcomes, weights);
	const pending = outcomes.filter(
		(outcome) => outcome.status === "pending",
	).length;
	const onExam = ADJUSTMENT_ORDER.flatMap((op) =>
		adjustments.filter((entry) => entry.question === null && entry.op === op),
	);
	if (onExam.length === 0) {
		return { questions: outcomes, total: calculated, pending };
	}
	return {
		questions: outcomes,
		total: adjustTotal(calculated, onExam),
		pending: fixesTotal(onExam) ? 0 : pending,
		adjustments: onExam.map(({ op, value, reason }) => ({
			op,
			value: Number(value),
			reason,
		})),
		original: { total: calculated },
	};
}

/// The order exam adjustments apply in.
export const ADJUSTMENT_ORDER: readonly AdjustmentOp[] = [
	"SET",
	"FACTOR",
	"OFFSET",
];

/// The adjustment with the lowest value, or `undefined` with none.
function lowestFactor(
	list: readonly ResultAdjustment[],
): ResultAdjustment | undefined {
	return list.reduce<ResultAdjustment | undefined>(
		(lowest, entry) =>
			!lowest || Number(entry.value) < Number(lowest.value) ? entry : lowest,
		undefined,
	);
}

/// `value` times `factor`, unless `value` is negative.
function factorOf(value: number, factor: number): number {
	return value > 0 ? value * factor : value;
}

/// The outcome after `adjustment`, or the outcome itself without one.
function adjustOutcome(
	outcome: QuestionOutcome,
	adjustment: ResultAdjustment | undefined,
): QuestionOutcome {
	if (!adjustment) return outcome;
	const factor = Number(adjustment.value);
	const info = {
		op: "FACTOR" as const,
		value: factor,
		reason: adjustment.reason,
		original: {
			status: outcome.status as Exclude<QuestionOutcomeStatus, "sanctioned">,
			score: outcome.score,
		},
	};
	if (outcome.score === null && factor > 0) {
		return { ...outcome, adjustment: info };
	}
	return {
		...outcome,
		status: "sanctioned",
		score: factorOf(outcome.score ?? 0, factor),
		adjustment: info,
	};
}

/// The outcome of one question: its newest submission, judged by the newest feedback on it.
function outcomeOf(
	slug: string,
	submissions: ResultSubmission[],
	feedback: ResultFeedback[],
): QuestionOutcome {
	const counting = submissions
		.filter((submission) => submission.question === slug)
		.reduce<(typeof submissions)[number] | null>(
			(newest, submission) =>
				!newest || isNewerSubmission(submission, newest) ? submission : newest,
			null,
		);
	if (!counting) {
		return { question: slug, status: "unanswered", score: null, comments: [] };
	}

	const passes = newestPassesFirst(
		feedback.filter((entry) => entry.submission === counting.publicId),
	);
	const comments = passes
		.map((entry) => entry.feedback)
		.filter((text): text is string => !!text?.trim());

	if (counting.status === "WILL_NOT_GRADE") {
		return {
			question: slug,
			submission: counting.publicId,
			status: "not-graded",
			score: null,
			comments,
		};
	}

	const verdict = passes[0] ? scoreValue(passes[0].score) : null;
	if (verdict === null) {
		return {
			question: slug,
			submission: counting.publicId,
			status: "pending",
			score: null,
			comments,
		};
	}
	return {
		question: slug,
		submission: counting.publicId,
		status: "graded",
		score: verdict,
		...(passes[0]?.blanks ? { blanks: passes[0].blanks } : {}),
		...(passes[0]?.rubricItems ? { rubricItems: passes[0].rubricItems } : {}),
		comments,
	};
}

/// The outcome of a `code` question from its `SUBMIT` and `FINAL` submissions.
function codeOutcomeOf(
	slug: string,
	sent: ResultSubmission[],
	feedback: ResultFeedback[],
	penalty: number,
): QuestionOutcome {
	const passesOf = (submission: ResultSubmission) =>
		newestPassesFirst(
			feedback.filter((entry) => entry.submission === submission.publicId),
		);
	const commentsOf = (submission: ResultSubmission) =>
		passesOf(submission)
			.map((entry) => entry.feedback)
			.filter((text): text is string => !!text?.trim());
	const chronological = [...sent].sort((a, b) =>
		isNewerSubmission(a, b) ? 1 : -1,
	);
	const newest = chronological[chronological.length - 1] as ResultSubmission;
	const live = chronological.filter(
		(submission) =>
			submission.status !== "WILL_NOT_GRADE" &&
			submission.status !== "PRETEST_FAILED",
	);

	if (live.length === 0) {
		const last = chronological.filter(
			(submission) => submission.status !== "WILL_NOT_GRADE",
		);
		const shown = last[last.length - 1] ?? newest;
		return {
			question: slug,
			submission: shown.publicId,
			status: last.length === 0 ? "not-graded" : "graded",
			score: last.length === 0 ? null : 0,
			comments: commentsOf(shown),
		};
	}

	const verdicts = live.map((submission) => {
		const passes = passesOf(submission);
		return {
			submission,
			pass: passes[0],
			score: passes[0] ? scoreValue(passes[0].score) : null,
		};
	});
	const waiting = verdicts.filter((entry) => entry.score === null);
	if (waiting.length > 0) {
		const shown = (waiting[waiting.length - 1] as (typeof verdicts)[number])
			.submission;
		return {
			question: slug,
			submission: shown.publicId,
			status: "pending",
			score: null,
			comments: commentsOf(shown),
		};
	}

	const result = codeQuestionScore(
		verdicts.map((entry) => entry.score as number),
		penalty,
	);
	const counting = verdicts[
		result.counting as number
	] as (typeof verdicts)[number];
	return {
		question: slug,
		submission: counting.submission.publicId,
		status: "graded",
		score: result.score,
		...(counting.pass?.blanks ? { blanks: counting.pass.blanks } : {}),
		...(counting.pass?.rubricItems
			? { rubricItems: counting.pass.rubricItems }
			: {}),
		comments: commentsOf(counting.submission),
		codeAttempts: verdicts.map((entry, index) => ({
			submission: entry.submission.publicId,
			score: entry.score as number,
			discounted: result.discounted[index] as number,
			counts: index === result.counting,
		})),
	};
}

/// The weighted mean score, unanswered and not-graded counting as zero; `null` with no questions or any pending, 0 when the weights sum to 0.
function totalOf(
	outcomes: QuestionOutcome[],
	weights: readonly number[],
): number | null {
	if (outcomes.length === 0) return null;
	if (outcomes.some((outcome) => outcome.status === "pending")) return null;
	const weightSum = weights.reduce((acc, weight) => acc + weight, 0);
	if (weightSum === 0) return 0;
	const sum = outcomes.reduce(
		(acc, outcome, i) => acc + (outcome.score ?? 0) * (weights[i] as number),
		0,
	);
	return sum / weightSum;
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
