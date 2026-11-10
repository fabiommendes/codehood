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
import type { Marked, Unmarked } from "@/typing/branding";
import { durationToMinutes, toDuration } from "@/utils/schedule-time";
import type { ExamResult } from "./exam-result";

/// The part of an exam its phase depends on.
export type ExamTiming = Pick<
	Exam,
	"type" | "status" | "scheduledAt" | "duration" | "extraTime"
> &
	Partial<Pick<Exam, "gradesReleasedAt">>;

/// The timing of an exam as the whole class sees it, never adjusted by an exception.
export type BaseTiming<T extends ExamTiming = ExamTiming> = Unmarked<T>;

/// The timing of an exam as one student sees it, after their exception; the mark keeps it out of the class-wide functions.
export type PersonalTiming<T extends ExamTiming = ExamTiming> = Marked<
	T,
	"personal"
>;

/// The part of one student's exam exception their timing depends on.
export interface ExceptionTiming {
	extraTime: Duration | null;
	scheduledAt: Date | null;
	/// Whether the student dropped the course: the exception still shapes their own timing, but never holds back the class's release.
	dropped?: boolean;
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
export function personalTiming<T extends BaseTiming>(
	exam: T,
	exception: ExceptionTiming | null,
): PersonalTiming<T> {
	if (!exception || exam.type === "PRACTICE") return marked(exam);

	const extraMinutes =
		(exam.extraTime ? durationToMinutes(exam.extraTime) : 0) +
		(exception.extraTime ? durationToMinutes(exception.extraTime) : 0);
	const personal: T = {
		...exam,
		extraTime: extraMinutes > 0 ? toDuration(extraMinutes) : null,
	};

	if (exception.scheduledAt) {
		personal.scheduledAt = exception.scheduledAt;
		if (!hiddenFromStudents(exam.status)) {
			personal.status = "SCHEDULED";
		}
	}
	return marked(personal);
}

/// `timing` as a {@link PersonalTiming}; the mark exists only in the type, so the value is untouched.
function marked<T extends BaseTiming>(timing: T): PersonalTiming<T> {
	return timing as unknown as PersonalTiming<T>;
}

/**
 * The latest end among the window of the exam and the personal windows of its exceptions, or `null` when any of them has no end.
 *
 * With no exceptions it equals `windowEnd(schedule.base)`. An exception of a
 * `dropped` student is left out.
 */
export function lastWindowEnd(schedule: ExamSchedule): Date | null {
	const { base } = schedule;
	let last = windowEnd(base);
	for (const exception of schedule.exceptions.values()) {
		if (exception.dropped) continue;
		const end = windowEnd(personalTiming(base, exception));
		if (!last || !end) return null;
		if (end > last) last = end;
	}
	return last;
}

/**
 * Whether the attempt of the student holding `exception` can still be reopened at `now`.
 *
 * It can unless the student's personal window has closed or the attempt's own
 * deadline has passed, since reopening it then would not let them answer.
 */
export function canReopenAttempt(
	exam: BaseTiming,
	exception: ExceptionTiming | null,
	attempt: AttemptTiming,
	now: Date,
): boolean {
	const personal = personalTiming(exam, exception);
	if (examPhase(personal, now) === "closed") return false;
	const deadline = attemptDeadline(personal, attempt);
	return !deadline || now <= deadline;
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
 * Whether an answer recorded at `answeredAt` came after `deadline`.
 *
 * The server keeps accepting answers for a short grace window after the
 * deadline; this is how staff tell those answers apart.
 */
export function answeredAfterDeadline(
	deadline: Date | null,
	answeredAt: Date,
): boolean {
	return deadline !== null && answeredAt > deadline;
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
 * @params exam The student's own timing, from {@link timingFor}.
 * @params opts `released` replaces the call to {@link resultsReleased} on `exam`; {@link attemptOf} passes {@link released} of the schedule so a pending makeup keeps everyone at `submitted`.
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
 * @params exceptions Every exception of `exam`; each is applied to `exam` through {@link personalTiming}.
 */
export function resultsReleased(
	exam: BaseTiming,
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
 * When the students of the exam got their grades, or `null` if they have not yet or the moment is unknown.
 *
 * An `EXAM` releases at `gradesReleasedAt` and a timed, scheduled `QUIZ` at
 * {@link lastWindowEnd} of the schedule. A `PRACTICE` exam, and a `QUIZ`
 * completed by hand before or without that end, are released with no known
 * moment.
 */
export function releaseMoment(schedule: ExamSchedule, now: Date): Date | null {
	const { base } = schedule;
	if (!released(schedule, now)) return null;
	switch (base.type) {
		case "PRACTICE":
			return null;
		case "QUIZ": {
			const end = lastWindowEnd(schedule);
			return end && end <= now ? end : null;
		}
		default:
			return base.gradesReleasedAt ?? null;
	}
}

/// Whether some exception's personal phase is still `upcoming` or `open` at `now`, those of dropped students aside.
function hasOpenException(
	exam: BaseTiming,
	now: Date,
	exceptions: readonly ExceptionTiming[],
): boolean {
	return exceptions.some((exception) => {
		if (exception.dropped) return false;
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
 * @params exceptions Every exception of `exam`, as in {@link resultsReleased}.
 */
export function gradeReleaseBlocker(
	exam: BaseTiming,
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

// Exam schedule ---------------------------------------------------------------

/// The statuses an instructor has not published or has withdrawn, see {@link hiddenFromStudents}.
export const hiddenExamStatuses: readonly ExamTiming["status"][] = [
	"DRAFT",
	"ARCHIVED",
];

/** Whether an exam with `status` is kept out of what students see. */
export function hiddenFromStudents(status: ExamTiming["status"]): boolean {
	return hiddenExamStatuses.includes(status);
}

/// An exam's own timing together with the exceptions that adjust it, by username.
export interface ExamSchedule<T extends BaseTiming = BaseTiming> {
	readonly base: T;
	readonly exceptions: ReadonlyMap<string, ExceptionTiming>;
}

/**
 * The schedule of `exam` under `exceptions`, built once and then asked for each student.
 *
 * `exceptions` must hold every exception of the exam, the ones of dropped
 * students flagged, because the release of grades depends on all of them.
 *
 * @example
 * const schedule = examSchedule(exam, new Map([["ana", { extraTime: { minutes: 30 }, scheduledAt: null }]]));
 * attemptOf(schedule, "ana", attempt, now);
 */
export function examSchedule<T extends BaseTiming>(
	exam: T,
	exceptions: ReadonlyMap<string, ExceptionTiming> = new Map(),
): ExamSchedule<T> {
	return { base: exam, exceptions };
}

/**
 * The timing of `exam` for a student whose own exception is all the caller knows.
 *
 * Enough to place the exam in that student's phase and dates; whether grades
 * are released needs every exception, so go through {@link examSchedule}.
 */
export function viewerTiming<T extends BaseTiming>(
	exam: T,
	exception: ExceptionTiming | null | undefined,
): PersonalTiming<T> {
	return personalTiming(exam, exception ?? null);
}

/** The timing of the schedule's exam for `author`, after their exception, if any. */
export function timingFor<T extends BaseTiming>(
	schedule: ExamSchedule<T>,
	author: string | null,
): PersonalTiming<T> {
	const exception = author ? schedule.exceptions.get(author) : undefined;
	return personalTiming(schedule.base, exception ?? null);
}

/** Whether the students of the schedule's exam may see their grades at `now`, holding exceptions into account. */
export function released(schedule: ExamSchedule, now: Date): boolean {
	return resultsReleased(schedule.base, now, [...schedule.exceptions.values()]);
}

/** What `author`, holding `attempt` or none, may do with the schedule's exam at `now`. */
export function attemptOf(
	schedule: ExamSchedule,
	author: string | null,
	attempt: AttemptTiming | null,
	now: Date,
): AttemptState {
	return attemptState(timingFor(schedule, author), attempt, now, {
		released: released(schedule, now),
	});
}

/** Whether `state` is an attempt the student can no longer answer: `submitted` or `results`. */
export function isFinished(state: AttemptState): boolean {
	return state.kind === "submitted" || state.kind === "results";
}

/** The first thing stopping the release of grades of the schedule's exam at `now`, or `null`, see {@link gradeReleaseBlocker}. */
export function releaseBlocker(
	schedule: ExamSchedule,
	results: ExamResult[],
	now: Date,
): GradeReleaseBlocker | null {
	return gradeReleaseBlocker(schedule.base, results, now, [
		...schedule.exceptions.values(),
	]);
}

/** Whether the attempt of `author` can still be reopened at `now`, see {@link canReopenAttempt}. */
export function canReopen(
	schedule: ExamSchedule,
	author: string,
	attempt: AttemptTiming,
	now: Date,
): boolean {
	return canReopenAttempt(
		schedule.base,
		schedule.exceptions.get(author) ?? null,
		attempt,
		now,
	);
}

/** The usernames of students whose own window is still `upcoming` or `open` at `now`, those who dropped aside. */
export function openWindowAuthors(schedule: ExamSchedule, now: Date): string[] {
	return [...schedule.exceptions.entries()]
		.filter(([, exception]) => !exception.dropped)
		.map(([author]) => author)
		.filter((author) => {
			const phase = examPhase(timingFor(schedule, author), now);
			return phase === "upcoming" || phase === "open";
		});
}
