/**
 * A viewer's calendar as one timeline: course meetings and dated exams.
 *
 * Pure: the caller fetches the events and the exams it may see, and this
 * decides which of them belong on the calendar and in what order.
 */

import type { CalendarEvent } from "@/db/services/calendar-event.service";
import type { Exam } from "@/db/services/exam.service";
import { durationToMinutes, endOf } from "@/utils/schedule-time";

type CourseId = CalendarEvent["courseId"];

/// An exam together with the course it belongs to, which `Exam` does not carry.
export interface CourseExam {
	courseId: CourseId;
	exam: Exam;
}

/// One dated item on the calendar, either a course meeting or an exam.
export type CalendarEntry = {
	courseId: CourseId;
	startAt: Date;
	/// When a meeting ends, or when an exam's answering window closes. An
	/// untimed exam ends when it starts.
	endAt: Date;
} & ({ kind: "event"; event: CalendarEvent } | { kind: "exam"; exam: Exam });

/// Exam statuses that never reach the calendar, whoever is looking.
const HIDDEN_STATUSES: ReadonlySet<Exam["status"]> = new Set([
	"DRAFT",
	"ARCHIVED",
]);

/**
 * Merges `events` and `exams` into one list ordered by start time.
 *
 * Exams without a date, drafts and archived exams are left out. At the same
 * instant an exam comes before an event; entries of one kind keep their input
 * order.
 */
export function calendarEntries(
	events: readonly CalendarEvent[],
	exams: readonly CourseExam[],
): CalendarEntry[] {
	const examEntries: CalendarEntry[] = [];
	for (const { courseId, exam } of exams) {
		if (!exam.scheduledAt || HIDDEN_STATUSES.has(exam.status)) continue;
		examEntries.push({
			kind: "exam",
			exam,
			courseId,
			startAt: exam.scheduledAt,
			endAt: endOf(exam.scheduledAt, windowMinutes(exam)),
		});
	}
	const eventEntries: CalendarEntry[] = events.map((event) => ({
		kind: "event",
		event,
		courseId: event.courseId,
		startAt: event.startAt,
		endAt: endOf(event.startAt, durationToMinutes(event.timeSlot.duration)),
	}));

	// Array.prototype.sort is stable, so exams listed first win ties.
	return [...examEntries, ...eventEntries].sort(
		(a, b) => a.startAt.getTime() - b.startAt.getTime(),
	);
}

/// An exam's answering window in minutes, `duration + extraTime`, zero when untimed.
function windowMinutes(exam: Exam): number {
	if (!exam.duration) return 0;
	const extra = exam.extraTime ? durationToMinutes(exam.extraTime) : 0;
	return durationToMinutes(exam.duration) + extra;
}
