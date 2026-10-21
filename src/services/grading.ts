/**
 * What an instructor has to grade on one exam, assembled from its attempts and the feedback on them.
 *
 * Pure: the caller fetches the attempts and every grading pass on them, and
 * this decides which answers count, which still wait for a grade, and how
 * they line up per question.
 */

import { scoreValue } from "@/core/score";
import type { Feedback } from "@/db/services/feedback.service";
import type { Response } from "@/db/services/response.service";
import type { Submission } from "@/db/services/submission.service";
import {
	examResult,
	isNewerSubmission,
	newestPassesFirst,
} from "./exam-result";
import {
	attemptState,
	type ExamTiming,
	type ExceptionTiming,
	personalTiming,
} from "./exam-state";

/// Where a counting answer stands: waiting for a grade, graded, or marked will-not-grade.
export type AnswerState = "pending" | "graded" | "not-graded";

/// One grading pass on an answer, as the grading pages show it.
export interface GradingPass {
	/// The pass's score as a number in `[-1, 1]`, or `null` when it has no value.
	score: number | null;
	/// The written comment, or `null` when empty or only whitespace.
	comment: string | null;
	/// The user who graded, or `null` when a bot did.
	grader: string | null;
	/// The bot that graded, or `null` when a user did.
	bot: string | null;
	/// Whether the pass marked the answer will-not-grade, rather than scoring it.
	willNotGrade: boolean;
	updatedAt: Date;
}

/// The prefix of the `ref` of a pass that marks an answer will-not-grade.
export const WILL_NOT_GRADE_REF = "wng-";

/// The newest submission a student made to one question within a closed attempt.
export interface CountingAnswer {
	/// The submission's `publicId`.
	submission: string;
	/// The question's slug.
	question: string;
	/// The student's username.
	author: string;
	payload: Submission["payload"];
	createdAt: Date;
	state: AnswerState;
	/// The score of the newest pass, or `null` unless `graded`.
	verdict: number | null;
	/// Every pass on this submission, newest first (by `updatedAt`).
	passes: GradingPass[];
}

/// How one question of the exam stands in the grading queue.
export interface QueueEntry {
	/// The question's slug.
	question: string;
	pending: number;
	graded: number;
	notGraded: number;
}

/// The part of an attempt the grading rules read.
export type GradingAttempt = Pick<
	Response,
	"author" | "createdAt" | "acceptingSubmissions" | "submissions"
>;

/// The part of a grading pass the grading rules read.
export type GradingFeedback = Pick<
	Feedback,
	"submission" | "score" | "feedback" | "grader" | "bot" | "updatedAt"
> &
	Partial<Pick<Feedback, "ref">>;

/**
 * The counting answers of every closed attempt at `exam`, in submission order.
 *
 * An attempt is closed once the student can no longer answer: they submitted
 * it, or its deadline passed at `now`. Answers of an attempt still in
 * progress are left out. Per attempt and question only the newest submission
 * counts, and submissions to a question outside `questions` are ignored.
 *
 * An answer whose submission status is `WILL_NOT_GRADE` is `not-graded`.
 * Otherwise it is `graded` when its newest pass has a score, and `pending`
 * when it has none.
 *
 * An attempt is judged against its author's personal timing,
 * `personalTiming(exam, exceptions.get(author) ?? null)`, so an attempt
 * whose author still has time left is not counted yet.
 *
 * @params questions The exam's question slugs.
 * @params feedback Every grading pass on the exam, released or not.
 * @params exceptions The exam's exceptions, by username.
 */
export function countingAnswers(
	exam: ExamTiming,
	questions: string[],
	attempts: GradingAttempt[],
	feedback: GradingFeedback[],
	now: Date,
	exceptions: ReadonlyMap<string, ExceptionTiming> = new Map(),
): CountingAnswer[] {
	const passesBySubmission = new Map<string, GradingFeedback[]>();
	for (const pass of feedback) {
		const list = passesBySubmission.get(pass.submission);
		if (list) list.push(pass);
		else passesBySubmission.set(pass.submission, [pass]);
	}

	const answers: { answer: CountingAnswer; id: number }[] = [];
	for (const attempt of attempts) {
		const { kind } = attemptState(
			personalTiming(exam, exceptions.get(attempt.author) ?? null),
			attempt,
			now,
		);
		if (kind !== "submitted" && kind !== "results") continue;

		const newest = new Map<string, GradingAttempt["submissions"][number]>();
		for (const submission of attempt.submissions) {
			if (!questions.includes(submission.question)) continue;
			const current = newest.get(submission.question);
			if (!current || isNewerSubmission(submission, current)) {
				newest.set(submission.question, submission);
			}
		}

		for (const submission of newest.values()) {
			const passes = newestPassesFirst(
				passesBySubmission.get(submission.publicId) ?? [],
			);
			const newestPass = passes[0];
			const verdict =
				submission.status === "WILL_NOT_GRADE" || !newestPass
					? null
					: scoreValue(newestPass.score);
			const state: AnswerState =
				submission.status === "WILL_NOT_GRADE"
					? "not-graded"
					: verdict === null
						? "pending"
						: "graded";
			answers.push({
				id: submission.id,
				answer: {
					submission: submission.publicId,
					question: submission.question,
					author: attempt.author,
					payload: submission.payload,
					createdAt: submission.createdAt,
					state,
					verdict,
					passes: passes.map(toGradingPass),
				},
			});
		}
	}

	return answers
		.sort(
			(a, b) =>
				a.answer.createdAt.getTime() - b.answer.createdAt.getTime() ||
				a.id - b.id,
		)
		.map(({ answer }) => answer);
}

/// The grading page's view of one stored pass.
function toGradingPass(pass: GradingFeedback): GradingPass {
	return {
		score: scoreValue(pass.score),
		comment: pass.feedback?.trim() ? pass.feedback : null,
		grader: pass.grader,
		bot: pass.bot,
		willNotGrade: pass.ref?.startsWith(WILL_NOT_GRADE_REF) ?? false,
		updatedAt: pass.updatedAt,
	};
}

/**
 * Counts the answers per question, one entry per slug of `questions` and in that order.
 *
 * A question nobody answered has an entry with every count at zero.
 */
export function gradingQueue(
	questions: string[],
	answers: CountingAnswer[],
): QueueEntry[] {
	return questions.map((question) => {
		const entry: QueueEntry = { question, pending: 0, graded: 0, notGraded: 0 };
		for (const answer of answers) {
			if (answer.question !== question) continue;
			if (answer.state === "pending") entry.pending++;
			else if (answer.state === "graded") entry.graded++;
			else entry.notGraded++;
		}
		return entry;
	});
}

/**
 * The answers to one question, split into the ones waiting for a grade and the rest.
 *
 * Both lists keep submission order, oldest first. `resolved` holds the
 * `graded` and the `not-graded` answers.
 */
export function answersTo(
	question: string,
	answers: CountingAnswer[],
): { pending: CountingAnswer[]; resolved: CountingAnswer[] } {
	const own = answers
		.filter((answer) => answer.question === question)
		.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
	return {
		pending: own.filter((answer) => answer.state === "pending"),
		resolved: own.filter((answer) => answer.state !== "pending"),
	};
}

/**
 * Reads a score typed as a whole percentage and returns it as a stored score, or `null` when it is not one.
 *
 * Accepts the integers from 0 to 100, with surrounding whitespace. The result
 * is a decimal string in `[0, 1]` that the feedback schema accepts.
 *
 * @example
 * parsePercentScore("75");  // "0.75"
 * parsePercentScore(" 100 "); // "1"
 * parsePercentScore("7.5"); // null
 * parsePercentScore("");    // null
 */
export function parsePercentScore(text: string): string | null {
	const digits = text.trim();
	if (!/^[0-9]+$/.test(digits)) return null;
	const percent = Number(digits);
	if (percent > 100) return null;
	if (percent === 100) return "1";
	if (percent === 0) return "0";
	const hundredths = String(percent).padStart(2, "0");
	return `0.${hundredths.replace(/0$/, "")}`;
}

/// A student of the course, as the results list shows them.
export interface GradedStudent {
	username: string;
	name: string;
	/// Whether the student's enrollment is no longer active.
	dropped: boolean;
}

/// One student's attempt at an exam, as one row of the exam's results.
export interface AttemptRow {
	/// The student's username.
	author: string;
	/// The student's name, or their username when `students` does not list them.
	name: string;
	dropped: boolean;
	/// `submitted` once the attempt is closed to answers, `in-progress` before.
	state: "in-progress" | "submitted";
	/// How many of the exam's questions have a counting answer.
	answered: number;
	/// How many questions the exam has.
	questions: number;
	/// How many counting answers wait for a grade; always zero while `in-progress`.
	pending: number;
	/// The attempt's total in `[-1, 1]`, or `null` while `in-progress` or with an answer pending.
	total: number | null;
	/// When the student started the attempt.
	startedAt: Date;
}

/**
 * The results of an exam, one row per attempt, sorted by the student's name.
 *
 * The total follows `examResult`: the mean of the question scores, with
 * unanswered and will-not-grade questions counting as zero. Names compare
 * without regard to case, and ties fall back to the username.
 *
 * @params questions The exam's question slugs.
 * @params feedback Every grading pass on the exam, released or not.
 * @params students The course's students, dropped ones included.
 * @params exceptions The exam's exceptions, by username; each attempt is `in-progress` or `submitted` by its author's personal timing, as in {@link countingAnswers}.
 */
export function attemptRows(
	exam: ExamTiming,
	questions: string[],
	attempts: GradingAttempt[],
	feedback: GradingFeedback[],
	students: GradedStudent[],
	now: Date,
	exceptions: ReadonlyMap<string, ExceptionTiming> = new Map(),
): AttemptRow[] {
	const studentsByUsername = new Map(
		students.map((student) => [student.username, student]),
	);
	const pendingByAuthor = new Map<string, number>();
	for (const answer of countingAnswers(
		exam,
		questions,
		attempts,
		feedback,
		now,
		exceptions,
	)) {
		if (answer.state !== "pending") continue;
		pendingByAuthor.set(
			answer.author,
			(pendingByAuthor.get(answer.author) ?? 0) + 1,
		);
	}

	const rows = attempts.map((attempt): AttemptRow => {
		const { kind } = attemptState(
			personalTiming(exam, exceptions.get(attempt.author) ?? null),
			attempt,
			now,
		);
		const closed = kind === "submitted" || kind === "results";
		const student = studentsByUsername.get(attempt.author);
		const answered = new Set(
			attempt.submissions
				.map((submission) => submission.question)
				.filter((slug) => questions.includes(slug)),
		).size;
		return {
			author: attempt.author,
			name: student?.name ?? attempt.author,
			dropped: student?.dropped ?? false,
			state: closed ? "submitted" : "in-progress",
			answered,
			questions: questions.length,
			pending: closed ? (pendingByAuthor.get(attempt.author) ?? 0) : 0,
			total: closed
				? examResult(questions, attempt.submissions, feedback).total
				: null,
			startedAt: attempt.createdAt,
		};
	});

	return rows.sort((a, b) =>
		compareStudents(
			{ name: a.name, username: a.author },
			{ name: b.name, username: b.author },
		),
	);
}

/**
 * Orders students by name without regard to case, ties by username.
 *
 * Meant as a `sort` comparator.
 */
export function compareStudents(
	a: { name: string; username: string },
	b: { name: string; username: string },
): number {
	return (
		a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
		a.username.localeCompare(b.username)
	);
}
