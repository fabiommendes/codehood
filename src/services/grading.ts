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
	type CodeAttemptOutcome,
	examResult,
	isNewerSubmission,
	newestPassesFirst,
	type QuestionOutcome,
	type ResultPolicy,
} from "./exam-result";
import {
	attemptOf,
	type ExamTiming,
	type ExceptionTiming,
	examSchedule,
	isFinished,
} from "./exam-state";

/// Where a counting answer stands: waiting for a grade, graded, or marked will-not-grade.
export type AnswerState = "pending" | "graded" | "not-graded";

/// One grading pass on an answer, as the grading pages show it.
export interface GradingPass {
	/// The pass's score as a number in `[-1, 1]`, or `null` when it has no value.
	score: number | null;
	/// The written comment, or `null` when empty or only whitespace.
	comment: string | null;
	/// The text for the instructor only. Absent when empty or only whitespace.
	notes?: string;
	/// The user who graded, or `null` when a bot did.
	grader: string | null;
	/// The bot that graded, or `null` when a user did.
	bot: string | null;
	/// Whether the pass marked the answer will-not-grade, rather than scoring it.
	willNotGrade: boolean;
	/// The pass's own reference within the submission, when the source carries it.
	ref?: string;
	/// The keys of the rubric items the pass applies. Absent when its score was set by hand.
	rubric?: string[];
	/// The rubric items the pass applies, with the instructor's private comment. Absent when its score was set by hand.
	rubricItems?: NonNullable<Feedback["rubricItems"]>;
	/// Free credit added after the rubric items. Absent when there is none.
	adjustment?: string;
	/// Set when the pass applies a retired rubric item.
	review?: true;
	updatedAt: Date;
}

/// The prefix of the `ref` of a pass that marks an answer will-not-grade.
export const WILL_NOT_GRADE_REF = "wng-";

/// The answer a student gave to one question within a closed attempt: its newest submission, or for a `code` question the sent one that counts.
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
	/// The blank grades of the newest pass, when it graded the blanks one by one.
	blanks?: Feedback["blanks"];
	/// Set when the newest pass applies a retired rubric item, so the answer should be graded again.
	review?: true;
	/// Every pass on this submission, newest first (by `updatedAt`).
	passes: GradingPass[];
	/// The graded submissions of a `code` question with how each weighs in the verdict. Absent for other answers.
	codeAttempts?: CodeAttemptOutcome[];
}

/// How one question of the exam stands in the grading queue.
export interface QueueEntry {
	/// The question's slug.
	question: string;
	pending: number;
	graded: number;
	notGraded: number;
	/// How many of the `graded` answers apply a retired rubric item. Absent means none.
	review?: number;
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
	Partial<
		Pick<
			Feedback,
			| "ref"
			| "blanks"
			| "notes"
			| "rubric"
			| "rubricItems"
			| "adjustment"
			| "review"
		>
	>;

/**
 * The counting answers of every closed attempt at `exam`, in submission order.
 *
 * An attempt is closed once the student can no longer answer: they submitted
 * it, or its deadline passed at `now`. Answers of an attempt still in
 * progress are left out. Per attempt and question only the newest submission
 * counts, and submissions to a question outside `questions` are ignored.
 *
 * A question with `SUBMIT` or `FINAL` submissions is a `code` question sent
 * for grading: its state and verdict are the ones `examResult` gives it, and
 * the answer is the sent submission that counts when it is `graded`, the
 * newest sent one otherwise. Autosaves are never the answer then.
 *
 * An answer whose submission status is `WILL_NOT_GRADE` is `not-graded`.
 * Otherwise it is `graded` when its newest pass has a score, and `pending`
 * when it has none.
 *
 * An attempt is judged against its author's personal timing, so an attempt
 * whose author still has time left is not counted yet.
 *
 * @params questions The exam's question slugs.
 * @params feedback Every grading pass on the exam, released or not.
 * @params exceptions The exam's exceptions, by username.
 * @params policy How the exam discounts `code` submissions, as in `examResult`.
 */
export function countingAnswers(
	exam: ExamTiming,
	questions: string[],
	attempts: GradingAttempt[],
	feedback: GradingFeedback[],
	now: Date,
	exceptions: ReadonlyMap<string, ExceptionTiming> = new Map(),
	policy: ResultPolicy = {},
): CountingAnswer[] {
	const schedule = examSchedule(exam, exceptions);
	const passesBySubmission = new Map<string, GradingFeedback[]>();
	for (const pass of feedback) {
		const list = passesBySubmission.get(pass.submission);
		if (list) list.push(pass);
		else passesBySubmission.set(pass.submission, [pass]);
	}

	const answers: { answer: CountingAnswer; id: number }[] = [];
	for (const attempt of attempts) {
		if (!isFinished(attemptOf(schedule, attempt.author, attempt, now)))
			continue;

		const byQuestion = new Map<string, GradingAttempt["submissions"]>();
		for (const submission of attempt.submissions) {
			if (!questions.includes(submission.question)) continue;
			const list = byQuestion.get(submission.question);
			if (list) list.push(submission);
			else byQuestion.set(submission.question, [submission]);
		}

		for (const [question, submissions] of byQuestion) {
			const answer = isCodeSent(submissions)
				? codeAnswer(question, submissions, passesBySubmission, policy)
				: newestAnswer(submissions, passesBySubmission);
			answers.push({
				id: answer.id,
				answer: { ...answer.answer, author: attempt.author },
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

/// The submissions of a question that were sent for grading: only a `code` question has them.
function sentOf<T extends { kind?: string }>(submissions: readonly T[]): T[] {
	return submissions.filter(
		(submission) => submission.kind === "SUBMIT" || submission.kind === "FINAL",
	);
}

/// Whether any of the submissions was sent for grading.
function isCodeSent(submissions: readonly { kind?: string }[]): boolean {
	return sentOf(submissions).length > 0;
}

type StoredSubmission = GradingAttempt["submissions"][number];

/// The answer of a question, from the submission that stands for it, before the author is known.
function buildAnswer(
	submission: StoredSubmission,
	state: AnswerState,
	verdict: number | null,
	passesBySubmission: ReadonlyMap<string, GradingFeedback[]>,
	extra: Partial<CountingAnswer> = {},
): { id: number; answer: Omit<CountingAnswer, "author"> } {
	const passes = newestPassesFirst(
		passesBySubmission.get(submission.publicId) ?? [],
	);
	const newestPass = passes[0];
	return {
		id: submission.id,
		answer: {
			submission: submission.publicId,
			question: submission.question,
			payload: submission.payload,
			createdAt: submission.createdAt,
			state,
			verdict,
			...(verdict !== null && newestPass?.blanks
				? { blanks: newestPass.blanks }
				: {}),
			...(state === "graded" && newestPass?.review === true
				? { review: true as const }
				: {}),
			passes: passes.map(toGradingPass),
			...extra,
		},
	};
}

/// The answer of a question with no sent submission: its newest submission, judged by its newest pass.
function newestAnswer(
	submissions: StoredSubmission[],
	passesBySubmission: ReadonlyMap<string, GradingFeedback[]>,
) {
	const submission = submissions.reduce((newest, current) =>
		isNewerSubmission(current, newest) ? current : newest,
	);
	const newestPass = newestPassesFirst(
		passesBySubmission.get(submission.publicId) ?? [],
	)[0];
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
	return buildAnswer(submission, state, verdict, passesBySubmission);
}

/// The answer of a `code` question with sent submissions: the state and verdict `examResult` gives, on the submission that counts.
function codeAnswer(
	question: string,
	submissions: StoredSubmission[],
	passesBySubmission: ReadonlyMap<string, GradingFeedback[]>,
	policy: ResultPolicy,
) {
	const outcome = examResult(
		[question],
		submissions,
		submissions.flatMap(
			(submission) => passesBySubmission.get(submission.publicId) ?? [],
		),
		policy,
	).questions[0] as QuestionOutcome;
	const sent = sentOf(submissions);
	const newestSent = sent.reduce((newest, current) =>
		isNewerSubmission(current, newest) ? current : newest,
	);
	const shown =
		outcome.status === "graded"
			? (sent.find(
					(submission) => submission.publicId === outcome.submission,
				) ?? newestSent)
			: newestSent;
	return buildAnswer(
		shown,
		outcome.status === "graded" || outcome.status === "pending"
			? outcome.status
			: "not-graded",
		outcome.score,
		passesBySubmission,
		outcome.codeAttempts ? { codeAttempts: outcome.codeAttempts } : {},
	);
}

/// The grading page's view of one stored pass.
function toGradingPass(pass: GradingFeedback): GradingPass {
	return {
		score: scoreValue(pass.score),
		comment: pass.feedback?.trim() ? pass.feedback : null,
		...(pass.notes?.trim() ? { notes: pass.notes } : {}),
		grader: pass.grader,
		bot: pass.bot,
		willNotGrade: pass.ref?.startsWith(WILL_NOT_GRADE_REF) ?? false,
		...(pass.ref !== undefined ? { ref: pass.ref } : {}),
		...(pass.rubric ? { rubric: pass.rubric } : {}),
		...(pass.rubricItems ? { rubricItems: pass.rubricItems } : {}),
		...(pass.adjustment ? { adjustment: pass.adjustment } : {}),
		...(pass.review ? { review: true as const } : {}),
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
			else if (answer.state === "graded") {
				entry.graded++;
				if (answer.review) entry.review = (entry.review ?? 0) + 1;
			} else entry.notGraded++;
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

/// The text of an answer with runs of whitespace collapsed and the ends trimmed, the key that makes identical answers adjacent.
function normalizedAnswer(payload: unknown): string {
	const text = typeof payload === "string" ? payload : JSON.stringify(payload);
	return (text ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The answers to one question in the order a grader goes through them: pending, then to review, then the rest.
 *
 * Within each block, answers with the same normalized text sit together, and
 * the groups follow the submission order of the first answer of each.
 *
 * @params answers The answers to a single question, oldest submission first.
 */
export function gradingOrder(answers: CountingAnswer[]): CountingAnswer[] {
	const blockOf = (answer: CountingAnswer): number =>
		answer.state === "pending" ? 0 : answer.review ? 1 : 2;
	const blocks: Map<string, CountingAnswer[]>[] = [
		new Map(),
		new Map(),
		new Map(),
	];
	for (const answer of answers) {
		const groups = blocks[blockOf(answer)] as Map<string, CountingAnswer[]>;
		const key = normalizedAnswer(answer.payload);
		const group = groups.get(key);
		if (group) group.push(answer);
		else groups.set(key, [answer]);
	}
	return blocks.flatMap((groups) => [...groups.values()].flat());
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
 * @params policy How the exam discounts `code` submissions, as in `examResult`.
 */
export function attemptRows(
	exam: ExamTiming,
	questions: string[],
	attempts: GradingAttempt[],
	feedback: GradingFeedback[],
	students: GradedStudent[],
	now: Date,
	exceptions: ReadonlyMap<string, ExceptionTiming> = new Map(),
	policy: ResultPolicy = {},
): AttemptRow[] {
	const schedule = examSchedule(exam, exceptions);
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
		const closed = isFinished(
			attemptOf(schedule, attempt.author, attempt, now),
		);
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
				? examResult(questions, attempt.submissions, feedback, policy).total
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
