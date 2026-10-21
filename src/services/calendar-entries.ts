/**
 * A viewer's calendar as one timeline: course meetings and dated exams.
 *
 * Pure: the caller fetches the events and the exams it may see, and this
 * decides which of them belong on the calendar and in what order. Who sees a
 * draft is the caller's query to decide: the exam service never hands one to
 * a student.
 */

import type { CalendarEvent } from "@/db/services/calendar-event.service";
import type { Exam } from "@/db/services/exam.service";
import { durationToMinutes, endOf } from "@/utils/schedule-time";
import { type ExceptionTiming, personalTiming, windowEnd } from "./exam-state";

type CourseId = CalendarEvent["courseId"];

/// An exam together with the course it belongs to, which `Exam` does not carry.
export interface CourseExam {
	courseId: CourseId;
	exam: Exam;
	/**
	 * The viewer's own exception on this exam, absent for none or for an
	 * instructor. The entry then starts and ends with the viewer's personal
	 * window, `personalTiming(exam, exception)` through `windowEnd`.
	 */
	exception?: ExceptionTiming | null;
}

/// One dated item on the calendar, either a course meeting or an exam.
export type CalendarEntry = {
	courseId: CourseId;
	startAt: Date;
	/// When a meeting ends, or when an exam's answering window closes. An
	/// untimed exam ends when it starts.
	endAt: Date;
} & ({ kind: "event"; event: CalendarEvent } | { kind: "exam"; exam: Exam });

/**
 * Merges `events` and `exams` into one list ordered by start time.
 *
 * Exams without a date and archived exams are left out. At the same
 * instant an exam comes before an event; entries of one kind keep their input
 * order.
 */
export function calendarEntries(
	events: readonly CalendarEvent[],
	exams: readonly CourseExam[],
): CalendarEntry[] {
	const examEntries: CalendarEntry[] = [];
	for (const { courseId, exam, exception } of exams) {
		const personal = personalTiming(exam, exception ?? null);
		if (!personal.scheduledAt || exam.status === "ARCHIVED") continue;
		examEntries.push({
			kind: "exam",
			exam,
			courseId,
			startAt: personal.scheduledAt,
			endAt: windowEnd(personal) ?? personal.scheduledAt,
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
