/**
 * Where an exam and a student's attempt at it stand at a given moment.
 *
 * The stored `status` records what the instructor decided (draft, archived,
 * started by hand, completed); the clock decides the rest. Every page and
 * service that asks "can this exam be answered now?" or "may students see
 * their grades?" goes through here, so the answer never depends on someone
 * remembering to update a column.
 */

import type { Duration } from "@/core/schemas";
import type { Exam } from "@/db/services/exam.service";
import { m } from "@/i18n";
import { durationToMinutes, toDuration } from "@/utils/schedule-time";
import type { ExamResult } from "./exam-result";

/// The part of an exam its phase depends on.
export type ExamTiming = Pick<
	Exam,
	"type" | "status" | "scheduledAt" | "duration" | "extraTime"
> &
	Partial<Pick<Exam, "gradesReleasedAt">>;

/// The part of one student's exam exception their timing depends on.
export interface ExceptionTiming {
	extraTime: Duration | null;
	scheduledAt: Date | null;
}

/// The part of a response its state depends on.
export interface AttemptTiming {
	createdAt: Date;
	acceptingSubmissions: boolean;
}

export type ExamPhase = "draft" | "upcoming" | "open" | "closed" | "archived";

/** Human labels for {@link ExamPhase}, as shown on badges and list headings. */
export const examPhaseLabels: Record<ExamPhase, string> = {
	draft: m.exams_phase_draft(),
	upcoming: m.exams_phase_upcoming(),
	open: m.exams_phase_open(),
	closed: m.exams_phase_closed(),
	archived: m.exams_phase_archived(),
};

/// What one student may do with one exam right now.
export type AttemptState =
	| { kind: "not-open"; opensAt: Date | null }
	| { kind: "can-start" }
	| { kind: "in-progress"; deadline: Date | null }
	| { kind: "submitted" }
	| { kind: "results" }
	| { kind: "missed" };

/**
 * The phase of `exam` at `now`, derived from its stored status and its schedule.
 *
 * - `DRAFT` is `draft`, `ARCHIVED` is `archived`, `COMPLETED` is `closed`.
 * - A `PRACTICE` exam in any other status is `open`.
 * - `ONGOING` is `open`, until `scheduledAt + duration + extraTime` when the
 *   exam has both a date and a duration, and `closed` after that.
 * - `SCHEDULED` with no date is `upcoming`. With a date it is `upcoming`
 *   before it, `open` from it until `scheduledAt + duration + extraTime`, and
 *   `closed` after. An untimed `SCHEDULED` exam stays `open` from its date on.
 */
export function examPhase(exam: ExamTiming, now: Date): ExamPhase {
	switch (exam.status) {
		case "DRAFT":
			return "draft";
		case "ARCHIVED":
			return "archived";
		case "COMPLETED":
			return "closed";
	}
	if (exam.type === "PRACTICE") return "open";

	const { scheduledAt } = exam;
	if (exam.status === "SCHEDULED") {
		if (!scheduledAt || now < scheduledAt) return "upcoming";
	}
	return isPastWindow(exam, now) ? "closed" : "open";
}

/// The length of the answering window, `duration + extraTime`, or `null` when untimed.
function windowMs(exam: ExamTiming): number | null {
	if (!exam.duration) return null;
	const extra = exam.extraTime ? durationToMinutes(exam.extraTime) : 0;
	return (durationToMinutes(exam.duration) + extra) * 60_000;
}

/** The moment a scheduled, timed exam closes for everyone, or `null` otherwise. */
export function windowEnd(exam: ExamTiming): Date | null {
	const length = windowMs(exam);
	if (!exam.scheduledAt || length === null) return null;
	return new Date(exam.scheduledAt.getTime() + length);
}

/**
 * The timing of `exam` as it applies to the student holding `exception`.
 *
 * - `null` returns `exam` unchanged, as does any exception on a `PRACTICE` exam.
 * - `extraTime` becomes `exam.extraTime + exception.extraTime`.
 * - A non-null `exception.scheduledAt` replaces `exam.scheduledAt` and turns
 *   the status into `SCHEDULED`, even from `ONGOING` or `COMPLETED`: a makeup
 *   reopens the exam for that student alone. `DRAFT` and `ARCHIVED` stay as
 *   they are.
 * - Extra time alone never changes the status, so it does not reopen an exam
 *   the instructor completed by hand.
 *
 * Every other field of `exam` is copied as is; `exam` itself is not modified.
 */
export function personalTiming<T extends ExamTiming>(
	exam: T,
	exception: ExceptionTiming | null,
): T {
	if (!exception || exam.type === "PRACTICE") return exam;

	const extraMinutes =
		(exam.extraTime ? durationToMinutes(exam.extraTime) : 0) +
		(exception.extraTime ? durationToMinutes(exception.extraTime) : 0);
	const personal: T = {
		...exam,
		extraTime: extraMinutes > 0 ? toDuration(extraMinutes) : null,
	};

	if (exception.scheduledAt) {
		personal.scheduledAt = exception.scheduledAt;
		if (exam.status !== "DRAFT" && exam.status !== "ARCHIVED") {
			personal.status = "SCHEDULED";
		}
	}
	return personal;
}

/**
 * The latest end among the window of `exam` and the personal windows of `exceptions`, or `null` when any of them has no end.
 *
 * Each personal window is {@link windowEnd} of {@link personalTiming}. With no
 * exceptions it equals `windowEnd(exam)`.
 */
export function lastWindowEnd(
	exam: ExamTiming,
	exceptions: readonly ExceptionTiming[],
): Date | null {
	let last = windowEnd(exam);
	for (const exception of exceptions) {
		const end = windowEnd(personalTiming(exam, exception));
		if (!last || !end) return null;
		if (end > last) last = end;
	}
	return last;
}

/// Whether `now` is strictly after the end of the exam's window.
function isPastWindow(exam: ExamTiming, now: Date): boolean {
	const end = windowEnd(exam);
	return end !== null && now > end;
}

/**
 * The moment `attempt` stops accepting answers, or `null` when it has no limit.
 *
 * A scheduled, timed exam ends for everyone at `scheduledAt + duration +
 * extraTime`. An unscheduled, timed exam gives each student `duration +
 * extraTime` from the moment they started (`attempt.createdAt`). An untimed
 * exam has no deadline.
 */
export function attemptDeadline(
	exam: ExamTiming,
	attempt: AttemptTiming,
): Date | null {
	const end = windowEnd(exam);
	if (end) return end;
	const length = windowMs(exam);
	if (length === null) return null;
	return new Date(attempt.createdAt.getTime() + length);
}

/**
 * What the student holding `attempt` (or no attempt yet) may do with `exam` at `now`.
 *
 * - `upcoming` exam: `not-open`, with `opensAt` set to `scheduledAt`.
 * - `open` exam, no attempt: `can-start`.
 * - `open` exam, attempt accepting submissions and `now` before its deadline:
 *   `in-progress`.
 * - An attempt that stopped accepting submissions, or whose deadline passed:
 *   `submitted`.
 * - `closed` exam with no attempt: `missed`.
 * - What would be `submitted` is `results` once {@link resultsReleased} holds.
 *
 * `draft` and `archived` exams are never shown to students; they report
 * `not-open` with `opensAt: null`.
 *
 * @params exam The student's own timing, {@link personalTiming} when they have an exception.
 * @params opts `released` replaces the call to {@link resultsReleased} on `exam`; pass `resultsReleased(baseExam, now, exceptions)` so a pending makeup keeps everyone at `submitted`.
 */
export function attemptState(
	exam: ExamTiming,
	attempt: AttemptTiming | null,
	now: Date,
	opts?: { released?: boolean },
): AttemptState {
	switch (examPhase(exam, now)) {
		case "upcoming":
			return { kind: "not-open", opensAt: exam.scheduledAt ?? null };
		case "draft":
		case "archived":
			return { kind: "not-open", opensAt: null };
		case "closed":
			return attempt ? submittedState(exam, now, opts) : { kind: "missed" };
		case "open": {
			if (!attempt) return { kind: "can-start" };
			const deadline = attemptDeadline(exam, attempt);
			const active =
				attempt.acceptingSubmissions && (!deadline || now <= deadline);
			return active
				? { kind: "in-progress", deadline }
				: submittedState(exam, now, opts);
		}
	}
}

/// A finished attempt is `results` once grades are released, `submitted` before.
function submittedState(
	exam: ExamTiming,
	now: Date,
	opts?: { released?: boolean },
): AttemptState {
	return (opts?.released ?? resultsReleased(exam, now))
		? { kind: "results" }
		: { kind: "submitted" };
}

/**
 * Whether the students of `exam` may see their grades at `now`.
 *
 * A `PRACTICE` exam releases at once. A `QUIZ` releases once its phase is
 * `closed` and the personal phase of every one of `exceptions` is neither
 * `upcoming` nor `open`. Any other type releases only when `gradesReleasedAt`
 * is set and not in the future; a missing `gradesReleasedAt` counts as not
 * released.
 *
 * @params exam The exam's own timing, never a {@link personalTiming}.
 * @params exceptions Every exception of `exam`; each is applied to `exam` through {@link personalTiming}.
 */
export function resultsReleased(
	exam: ExamTiming,
	now: Date,
	exceptions: readonly ExceptionTiming[] = [],
): boolean {
	switch (exam.type) {
		case "PRACTICE":
			return true;
		case "QUIZ":
			return (
				examPhase(exam, now) === "closed" &&
				!hasOpenException(exam, now, exceptions)
			);
		default:
			return !!exam.gradesReleasedAt && exam.gradesReleasedAt <= now;
	}
}

/**
 * When the students of `exam` got their grades, or `null` if they have not yet or the moment is unknown.
 *
 * An `EXAM` releases at `gradesReleasedAt` and a timed, scheduled `QUIZ` at
 * {@link lastWindowEnd} of `exam` and `exceptions`. A `PRACTICE` exam, and a
 * `QUIZ` completed by hand before or without that end, are released with no
 * known moment.
 *
 * @params exam The exam's own timing, never a {@link personalTiming}.
 * @params exceptions Every exception of `exam`, as in {@link resultsReleased}.
 */
export function releaseMoment(
	exam: ExamTiming,
	now: Date,
	exceptions: readonly ExceptionTiming[] = [],
): Date | null {
	if (!resultsReleased(exam, now, exceptions)) return null;
	switch (exam.type) {
		case "PRACTICE":
			return null;
		case "QUIZ": {
			const end = lastWindowEnd(exam, exceptions);
			return end && end <= now ? end : null;
		}
		default:
			return exam.gradesReleasedAt ?? null;
	}
}

/// Whether some exception's personal phase is still `upcoming` or `open` at `now`.
function hasOpenException(
	exam: ExamTiming,
	now: Date,
	exceptions: readonly ExceptionTiming[],
): boolean {
	return exceptions.some((exception) => {
		const phase = examPhase(personalTiming(exam, exception), now);
		return phase === "upcoming" || phase === "open";
	});
}

/// Why an instructor may not release an exam's grades, see {@link gradeReleaseBlocker}.
export type GradeReleaseBlocker =
	| "not-an-exam"
	| "not-closed"
	| "released"
	| "exception-open"
	| "pending";

/**
 * What stops the instructor from releasing the grades of `exam` at `now`, or `null` if nothing does.
 *
 * Only an `EXAM` is released by hand: a `QUIZ` and a `PRACTICE` exam release
 * on their own. It must be `closed`, not released yet, no personal window in
 * `exceptions` may still be `upcoming` or `open` (`exception-open`), and no
 * answer in `results` may still wait for a grade. The checks run in that
 * order and the first one that fails is reported. An exam nobody attempted
 * can be released.
 *
 * @params results The result of every graded attempt, as the instructor sees it.
 * @params exam The exam's own timing, never a {@link personalTiming}.
 * @params exceptions Every exception of `exam`, as in {@link resultsReleased}.
 */
export function gradeReleaseBlocker(
	exam: ExamTiming,
	results: ExamResult[],
	now: Date,
	exceptions: readonly ExceptionTiming[] = [],
): GradeReleaseBlocker | null {
	if (exam.type !== "EXAM") return "not-an-exam";
	if (examPhase(exam, now) !== "closed") return "not-closed";
	if (exam.gradesReleasedAt) return "released";
	if (hasOpenException(exam, now, exceptions)) return "exception-open";
	const pending = results.some((result) =>
		result.questions.some((outcome) => outcome.status === "pending"),
	);
	return pending ? "pending" : null;
}
