/**
 * How each question of an exam performed, for reviewing the exam after it runs.
 *
 * Pure: the caller fetches the attempts, every grading pass on them and the
 * question documents, and this computes the per-question numbers the
 * instructor reads: averages, blanks, discrimination, and how the answers to
 * an objective question spread over its choices.
 */

import { resolveChoiceIds } from "@/mdq/choices";
import type { Question as MdqQuestion } from "@/mdq/schemas-generated";
import { answerKey } from "@/mdq/scoring";
import { examResult } from "./exam-result";
import {
	attemptState,
	type ExamTiming,
	type ExceptionTiming,
	personalTiming,
} from "./exam-state";
import {
	type CountingAnswer,
	countingAnswers,
	type GradingAttempt,
	type GradingFeedback,
	gradingQueue,
	type QueueEntry,
} from "./grading";

/// The fewest graded attempts a discrimination index is computed from; below it the index is `null`.
export const DISCRIMINATION_MIN_POPULATION = 5;

/// A discrimination below this flags the question for review with a warning.
export const DISCRIMINATION_WARNING = 0.2;

/// A discrimination below this flags the question for review as an error.
export const DISCRIMINATION_ERROR = 0;

/// Why a question has no discrimination index.
export type DiscriminationGap =
	/// Fewer than `DISCRIMINATION_MIN_POPULATION` attempts in the population.
	| "few-attempts"
	/// The exam has a single question, so there is no rest of the exam to correlate with.
	| "single-question"
	/// Every attempt scored the same on the question, or the same on the rest of the exam.
	| "no-variance";

/// A discrimination index, or the reason there is none.
export type Discrimination =
	| { value: number; gap: null }
	| { value: null; gap: DiscriminationGap };

/// How the answers to one question of the exam went, for reviewing the exam after it runs.
export interface QuestionStats extends QueueEntry {
	/// How many closed attempts have a counting answer to the question, in any state.
	answered: number;
	/// The mean verdict of the `graded` answers in `[-1, 1]`, or `null` when none is graded.
	average: number | null;
	/// The share of `graded` answers with full score in `[0, 1]`, or `null` when none is graded.
	correct: number | null;
	/// How many closed attempts have no counting answer to the question.
	blank: number;
	/// The corrected item-total correlation in `[-1, 1]`, or `null` when `discriminationGap` says why not.
	discrimination: number | null;
	/// Why `discrimination` is `null`, or `null` when it is a number.
	discriminationGap: DiscriminationGap | null;
}

/**
 * Summarizes the counting answers of an exam per question, one entry per slug of `questions` and in that order.
 *
 * The answers are the ones `countingAnswers` picks: the newest submission per
 * question of each closed attempt, judged by its newest pass. `answered`
 * counts them all. `average` and `correct` read only the `graded` ones: a
 * `pending` answer waits for a grade, a `not-graded` (will-not-grade) one
 * counts neither in them nor as pending, and a question an attempt left
 * unanswered counts nowhere. Full score means a verdict of at least 1.
 *
 * `blank` counts the closed attempts with no counting answer to the
 * question, so `answered + blank` is the number of closed attempts.
 *
 * `discrimination` is {@link discrimination} over the population of closed
 * attempts whose total is defined (no answer pending), each attempt's row
 * holding its `examResult` score per question: unanswered and not-graded
 * count as zero. An attempt with any pending answer is left out of the
 * population of every question, not only of the pending one.
 *
 * @params questions The exam's question slugs, in exam order.
 * @params attempts The exam's non-practice attempts.
 * @params feedback Every grading pass on the exam, released or not.
 * @params exceptions The exam's exceptions, by username, as in `countingAnswers`.
 */
export function questionStats(
	exam: ExamTiming,
	questions: string[],
	attempts: GradingAttempt[],
	feedback: GradingFeedback[],
	now: Date,
	exceptions: ReadonlyMap<string, ExceptionTiming> = new Map(),
): QuestionStats[] {
	const answers = countingAnswers(
		exam,
		questions,
		attempts,
		feedback,
		now,
		exceptions,
	);
	const closedAttempts = closedAttemptCount(exam, attempts, now, exceptions);
	const rows = scoreRows(exam, questions, attempts, feedback, now, exceptions);
	const disc = questions.map((_, position) => discrimination(rows, position));
	return gradingQueue(questions, answers).map((entry, index) => {
		const verdicts = answers
			.filter((answer) => answer.question === entry.question)
			.map((answer) => answer.verdict)
			.filter((verdict): verdict is number => verdict !== null);
		const graded = verdicts.length;
		return {
			...entry,
			answered: entry.pending + entry.graded + entry.notGraded,
			average:
				graded > 0 ? verdicts.reduce((sum, v) => sum + v, 0) / graded : null,
			correct:
				graded > 0 ? verdicts.filter((v) => v >= 1).length / graded : null,
			blank: closedAttempts - entry.pending - entry.graded - entry.notGraded,
			discrimination: disc[index]?.value ?? null,
			discriminationGap: disc[index]?.gap ?? null,
		};
	});
}

/// The closed attempts of the exam: the ones `countingAnswers` reads, found by their authors' personal timing.
function closedAttemptCount(
	exam: ExamTiming,
	attempts: GradingAttempt[],
	now: Date,
	exceptions: ReadonlyMap<string, ExceptionTiming>,
): number {
	return attempts.filter((attempt) => {
		const { kind } = attemptState(
			personalTiming(exam, exceptions.get(attempt.author) ?? null),
			attempt,
			now,
		);
		return kind === "submitted" || kind === "results";
	}).length;
}

/// One score row per closed attempt with no pending answer, each holding its `examResult` score per question.
function scoreRows(
	exam: ExamTiming,
	questions: string[],
	attempts: GradingAttempt[],
	feedback: GradingFeedback[],
	now: Date,
	exceptions: ReadonlyMap<string, ExceptionTiming>,
): number[][] {
	const rows: number[][] = [];
	for (const attempt of attempts) {
		const { kind } = attemptState(
			personalTiming(exam, exceptions.get(attempt.author) ?? null),
			attempt,
			now,
		);
		if (kind !== "submitted" && kind !== "results") continue;
		const result = examResult(questions, attempt.submissions, feedback);
		if (result.total === null) continue;
		rows.push(result.questions.map((outcome) => outcome.score ?? 0));
	}
	return rows;
}

/**
 * The corrected item-total discrimination of one question: the Pearson correlation between its score and the mean of the other questions, over the attempts in `scores`.
 *
 * Each row of `scores` is one attempt, holding its score in `[-1, 1]` for
 * every exam question in exam order; every row has the same length. The
 * question at `position` is left out of the rest-of-exam mean, so it does
 * not correlate with itself.
 *
 * The gaps are checked in this order: fewer than
 * `DISCRIMINATION_MIN_POPULATION` rows is `few-attempts`, rows of length 1
 * (or 0) are `single-question`, and a zero variance in either series is
 * `no-variance`.
 *
 * @example
 * discrimination([[1, 1], [1, 0]], 0); // { value: null, gap: "few-attempts" }
 *
 * @throws RangeError when `position` is not an index into the rows.
 */
export function discrimination(
	scores: readonly (readonly number[])[],
	position: number,
): Discrimination {
	const width = scores[0]?.length ?? 0;
	if (
		width > 0 &&
		!(Number.isInteger(position) && position >= 0 && position < width)
	) {
		throw new RangeError(`position ${position} is not a question index`);
	}
	if (scores.length < DISCRIMINATION_MIN_POPULATION) {
		return { value: null, gap: "few-attempts" };
	}
	if (width <= 1) return { value: null, gap: "single-question" };

	const own = scores.map((row) => row[position] ?? 0);
	const rest = scores.map(
		(row) =>
			(row.reduce((sum, v) => sum + v, 0) - (row[position] ?? 0)) / (width - 1),
	);
	const meanOwn = own.reduce((a, b) => a + b, 0) / own.length;
	const meanRest = rest.reduce((a, b) => a + b, 0) / rest.length;
	let cov = 0;
	let varOwn = 0;
	let varRest = 0;
	for (let i = 0; i < own.length; i++) {
		const a = (own[i] ?? 0) - meanOwn;
		const b = (rest[i] ?? 0) - meanRest;
		cov += a * b;
		varOwn += a * a;
		varRest += b * b;
	}
	const eps = 1e-12;
	if (varOwn < eps || varRest < eps) return { value: null, gap: "no-variance" };
	return { value: cov / Math.sqrt(varOwn * varRest), gap: null };
}

/**
 * Which review flag a discrimination index earns, or `null` when it earns none.
 *
 * Below `DISCRIMINATION_ERROR` is `error`, otherwise below
 * `DISCRIMINATION_WARNING` is `warning`. A missing index earns no flag.
 */
export function discriminationFlag(
	value: number | null,
): "warning" | "error" | null {
	if (value === null) return null;
	if (value < DISCRIMINATION_ERROR) return "error";
	return value < DISCRIMINATION_WARNING ? "warning" : null;
}

/// A choice of the question version being graded, with how many answers picked it.
export interface ChoiceCount {
	kind: "choice";
	/// The choice id, as `resolveChoiceIds` resolves it.
	id: string;
	/// The choice text, as authored (markdown).
	text: string;
	/// Whether the version's answer key holds this choice.
	correct: boolean;
	count: number;
}

/// A choice id some answers hold that the question version does not have, given to an earlier version.
export interface RemovedChoiceCount {
	kind: "removed";
	id: string;
	count: number;
}

/// The answers with no choice picked (multiple choice) or none ticked (multiple selection).
export interface EmptyCount {
	kind: "empty";
	count: number;
}

/// One row of a multiple-choice or multiple-selection distribution.
export type ChoiceRow = ChoiceCount | RemovedChoiceCount | EmptyCount;

/// How the answers judged one statement of a true-false question.
export interface StatementCount {
	kind: "statement";
	/// The statement id, as `resolveChoiceIds` resolves it.
	id: string;
	/// The statement text, as authored (markdown).
	text: string;
	/// Whether the statement is true in the version's answer key.
	correct: boolean;
	/// How many answers judged it true.
	true: number;
	/// How many answers judged it false.
	false: number;
	/// How many answers left it unjudged.
	abstained: number;
}

/// A statement id some answers judged that the question version does not have.
export interface RemovedStatementCount {
	kind: "removed";
	id: string;
	true: number;
	false: number;
	/// How many answers left it unjudged, every answer to a later version included.
	abstained: number;
}

/// One row of a true-false distribution.
export type StatementRow = StatementCount | RemovedStatementCount;

/// How the counting answers to an objective question spread over its choices.
export type AnswerDistribution =
	| {
			type: "multiple-choice";
			/// How many answers were counted, the denominator of every percentage.
			answers: number;
			/// Each choice once, then one `removed` row per unknown id, then one `empty` row.
			rows: ChoiceRow[];
	  }
	| {
			type: "multiple-selection";
			answers: number;
			/// Each choice once, then one `removed` row per unknown id, then one `empty` row.
			rows: ChoiceRow[];
	  }
	| {
			type: "true-false";
			answers: number;
			/// Each statement once, then one `removed` row per unknown id.
			rows: StatementRow[];
	  };

/**
 * Counts how the answers to an objective question spread over its choices, or `null` for any other question type.
 *
 * `answers` are the counting answers to this question (see `answersTo`),
 * graded or not: the distribution does not depend on grading. Choices and
 * statements come in the order the question lists them, ids resolved by
 * `resolveChoiceIds`, followed by `removed` rows sorted by id, and for
 * multiple choice and multiple selection the `empty` row last, present even
 * at zero. A `removed` row only exists with a non-zero count.
 *
 * Multiple choice counts each answer once, so the counts add up to
 * `answers`; its `correct` choices are the ones `answerKey.multipleChoice`
 * returns. Multiple selection counts each ticked choice, and an answer with
 * nothing ticked in the `empty` row; `correct` is the choice's `correct`
 * flag. True-false counts each statement's verdicts, and `true + false +
 * abstained` is `answers` on every row.
 *
 * A payload of another shape than the question type expects counts as empty
 * (multiple choice, multiple selection) or as abstaining on every statement
 * (true-false).
 *
 * @params question The question version the exam pins, or the latest when it pins none.
 */
export function answerDistribution(
	question: MdqQuestion,
	answers: readonly Pick<CountingAnswer, "payload">[],
): AnswerDistribution | null {
	switch (question.type) {
		case "multiple-choice":
			return {
				type: "multiple-choice",
				answers: answers.length,
				rows: choiceRows(
					question.choices,
					new Set(answerKey.multipleChoice(question)),
					answers.map((answer) => {
						const choice = (answer.payload as { choice?: unknown } | null)
							?.choice;
						return typeof choice === "string" && choice !== "" ? [choice] : [];
					}),
				),
			};
		case "multiple-selection":
			return {
				type: "multiple-selection",
				answers: answers.length,
				rows: choiceRows(
					question.choices,
					answerKey.multipleSelection(question),
					answers.map((answer) => {
						const choices = (answer.payload as { choices?: unknown } | null)
							?.choices;
						return Array.isArray(choices)
							? [
									...new Set(
										choices.filter(
											(id): id is string => typeof id === "string",
										),
									),
								]
							: [];
					}),
				),
			};
		case "true-false":
			return {
				type: "true-false",
				answers: answers.length,
				rows: statementRows(
					question.choices,
					answerKey.trueFalse(question),
					answers.map((answer) => {
						const verdicts = (answer.payload as { answers?: unknown } | null)
							?.answers;
						return verdicts &&
							typeof verdicts === "object" &&
							!Array.isArray(verdicts)
							? (verdicts as Record<string, unknown>)
							: {};
					}),
				),
			};
		default:
			return null;
	}
}

/// The choice rows: one per choice, `removed` rows by id, then `empty`, from the ids each answer picked.
function choiceRows(
	choices: readonly { id?: string; text: string }[],
	correct: ReadonlySet<string>,
	picks: readonly (readonly string[])[],
): ChoiceRow[] {
	const ids = resolveChoiceIds(choices);
	const counts = new Map<string, number>();
	let empty = 0;
	for (const ticked of picks) {
		if (ticked.length === 0) empty += 1;
		for (const id of ticked) counts.set(id, (counts.get(id) ?? 0) + 1);
	}
	const known = new Set(ids);
	const rows: ChoiceRow[] = choices.map((choice, index) => {
		const id = ids[index] ?? "";
		return {
			kind: "choice",
			id,
			text: choice.text,
			correct: correct.has(id),
			count: counts.get(id) ?? 0,
		};
	});
	for (const id of [...counts.keys()].filter((id) => !known.has(id)).sort()) {
		rows.push({ kind: "removed", id, count: counts.get(id) ?? 0 });
	}
	rows.push({ kind: "empty", count: empty });
	return rows;
}

/// The statement rows: one per statement, then `removed` rows by id, from the verdicts each answer holds.
function statementRows(
	choices: readonly { id?: string; text: string }[],
	key: ReadonlyMap<string, boolean>,
	verdicts: readonly Record<string, unknown>[],
): StatementRow[] {
	const ids = resolveChoiceIds(choices);
	const tally = (id: string) => {
		let yes = 0;
		let no = 0;
		for (const answer of verdicts) {
			const verdict = answer[id];
			if (verdict === true) yes += 1;
			else if (verdict === false) no += 1;
		}
		return { true: yes, false: no, abstained: verdicts.length - yes - no };
	};
	const known = new Set(ids);
	const rows: StatementRow[] = choices.map((choice, index) => {
		const id = ids[index] ?? "";
		return {
			kind: "statement",
			id,
			text: choice.text,
			correct: key.get(id) ?? false,
			...tally(id),
		};
	});
	const unknown = new Set(
		verdicts.flatMap((answer) =>
			Object.keys(answer).filter((id) => !known.has(id)),
		),
	);
	for (const id of [...unknown].sort()) {
		const counts = tally(id);
		if (counts.true + counts.false > 0) {
			rows.push({ kind: "removed", id, ...counts });
		}
	}
	return rows;
}
