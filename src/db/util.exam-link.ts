/**
 * The exam window helper shared by exam-facing services.
 *
 * The exam <-> calendar-event link was removed: `CalendarEvent` no longer
 * carries an `examId`, and nothing recomputes one. `examEndsAt` survives here
 * because `feedback.service.ts` still needs it to know when an exam's own
 * window closes, and it only reads the `Exam` shape.
 */

/**
 * When `exam` closes: its start plus its duration plus any extra time granted,
 * or `null` when it has no `scheduledAt` and so no window at all.
 *
 * A null `durationMs` is treated as a one-millisecond interval, which keeps a
 * scheduled-but-instantaneous exam from matching everything around it.
 */
export function examEndsAt(exam: {
	scheduledAt: Date | null;
	durationMs: number | null;
	extraTimeMs: number;
}): Date | null {
	if (!exam.scheduledAt) return null;
	return new Date(
		+exam.scheduledAt + (exam.durationMs ?? 1) + exam.extraTimeMs,
	);
}
