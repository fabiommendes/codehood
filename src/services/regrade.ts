/**
 * Whether a student may still ask for a regrade of one answer, decided from data the caller already fetched.
 *
 * Pure: the service refuses a request with it, and the exam page decides with
 * it whether to show the "ask for a regrade" button, so both always agree.
 */

import { REGRADE_WINDOW_DAYS } from "@/core/schemas";
import { m } from "@/i18n";
import type { QuestionOutcome } from "./exam-result";
import {
	type AttemptTiming,
	attemptState,
	type ExamTiming,
	type ExceptionTiming,
	personalTiming,
	releaseMoment,
	resultsReleased,
} from "./exam-state";

/// Milliseconds in a day.
const DAY_MS = 86_400_000;

/// The message of each {@link RegradeBlocker}.
const BLOCKER_MESSAGES: Record<RegradeBlocker, () => string> = {
	practice: m.errors_regrade_practice,
	"not-released": m.errors_regrade_not_released,
	"not-counting": m.errors_regrade_not_counting,
	"not-gradable": m.errors_regrade_not_gradable,
	exists: m.errors_regrade_exists,
	expired: m.errors_regrade_expired,
};

/// Why a student may not ask for a regrade of an answer, see {@link regradeBlocker}.
export type RegradeBlocker =
	| "practice"
	| "not-released"
	| "not-counting"
	| "not-gradable"
	| "exists"
	| "expired";

/// What {@link regradeBlocker} needs to judge one answer of one attempt.
export interface RegradeContext {
	/// The exam's own timing, never a `personalTiming`, with `gradesReleasedAt`.
	exam: ExamTiming;
	/// Every exception of the exam, dropped students flagged, as `resultsReleased` takes them.
	exceptions: readonly ExceptionTiming[];
	/// The author's own exception, or `null` when they have none.
	exception: ExceptionTiming | null;
	/// The author's attempt.
	attempt: AttemptTiming;
	/// The outcome of the contested answer's question, as `examResult` computes it over the attempt.
	outcome: QuestionOutcome;
	/// The `publicId` of the contested submission.
	submission: string;
	/// Whether a request (open or resolved) already exists for `submission`.
	requested: boolean;
}

/**
 * What stops the author of `ctx.attempt` from asking for a regrade of `ctx.submission` at `now`, or `null` if nothing does.
 *
 * The checks run in this order and the first one that fails is reported:
 *
 * - `practice`: the exam is a `PRACTICE` exam.
 * - `not-released`: `attemptState(personalTiming(exam, exception), attempt,
 *   now, { released: resultsReleased(exam, now, exceptions) })` is not
 *   `results`.
 * - `not-counting`: `ctx.submission` is not `ctx.outcome.submission`, the
 *   answer that counts for its question.
 * - `not-gradable`: the outcome is `pending` or `unanswered`.
 * - `exists`: `ctx.requested` is `true`.
 * - `expired`: `now` is after {@link regradeDeadline}. With no deadline
 *   there is no limit.
 *
 * Who may ask (the author) is a permission, not a blocker.
 */
export function regradeBlocker(
	ctx: RegradeContext,
	now: Date,
): RegradeBlocker | null {
	const { exam, outcome } = ctx;
	if (exam.type === "PRACTICE") return "practice";

	const state = attemptState(
		personalTiming(exam, ctx.exception),
		ctx.attempt,
		now,
		{ released: resultsReleased(exam, now, ctx.exceptions) },
	);
	if (state.kind !== "results") return "not-released";

	if (outcome.submission !== ctx.submission) return "not-counting";
	if (outcome.status === "pending" || outcome.status === "unanswered") {
		return "not-gradable";
	}
	if (ctx.requested) return "exists";

	const deadline = regradeDeadline(exam, now, ctx.exceptions);
	if (deadline && now > deadline) return "expired";
	return null;
}

/**
 * The last moment the students of `exam` may ask for a regrade, or `null` when there is no limit.
 *
 * `releaseMoment(exam, now, exceptions)` plus `REGRADE_WINDOW_DAYS` days; a
 * request at exactly that moment is still on time. `null` when the release
 * moment is unknown or the grades are not released yet.
 *
 * @params exam The exam's own timing, never a `personalTiming`.
 * @params exceptions Every exception of `exam`, as in `releaseMoment`.
 */
export function regradeDeadline(
	exam: ExamTiming,
	now: Date,
	exceptions: readonly ExceptionTiming[],
): Date | null {
	const released = releaseMoment(exam, now, exceptions);
	if (!released) return null;
	return new Date(released.getTime() + REGRADE_WINDOW_DAYS * DAY_MS);
}

/** The localized message shown when `blocker` refuses a request. */
export function regradeBlockerMessage(blocker: RegradeBlocker): string {
	return BLOCKER_MESSAGES[blocker]();
}
