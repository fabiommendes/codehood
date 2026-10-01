/**
 * A course's schedule page as weeks: meetings and dated exams together, split
 * into the weeks already over and those still ahead.
 *
 * Pure: the page builds the entries with `calendarEntries`.
 */

import { localDateOf } from "@/utils/schedule-time";
import type { CalendarEntry } from "./calendar-entries";

const DAY = 86_400_000;

/// One week of the term with its entries in time order.
export interface ScheduleWeek {
	/// Counted from zero at the course's start date, as `CalendarEvent.week` is.
	week: number;
	entries: CalendarEntry[];
}

export interface CourseSchedule {
	/// Weeks whose every entry has ended, oldest first.
	past: ScheduleWeek[];
	/// The current week and the ones after it.
	ahead: ScheduleWeek[];
	/// The meeting or exam going on now or coming next, if any.
	next: CalendarEntry | undefined;
}

/**
 * Groups a course's `entries` by week and splits them at `now`.
 *
 * Exams have no week of their own, so they take the one their date falls in,
 * counted in seven-day steps from `courseStart`. Holidays, cancelled meetings
 * and drafts are never `next`.
 */
export function courseSchedule(
	entries: readonly CalendarEntry[],
	courseStart: Date,
	now: Date,
): CourseSchedule {
	const byWeek = new Map<number, CalendarEntry[]>();
	for (const entry of entries) {
		const week =
			entry.kind === "event"
				? entry.event.week
				: weekOf(entry.startAt, courseStart);
		byWeek.set(week, [...(byWeek.get(week) ?? []), entry]);
	}
	const weeks = [...byWeek.entries()]
		.sort(([a], [b]) => a - b)
		.map(([week, weekEntries]) => ({ week, entries: weekEntries }));

	const firstAhead = weeks.findIndex(({ entries }) =>
		entries.some((entry) => entry.endAt >= now),
	);
	const split = firstAhead === -1 ? weeks.length : firstAhead;
	return {
		past: weeks.slice(0, split),
		ahead: weeks.slice(split),
		next: entries.find((entry) => entry.endAt >= now && isHeld(entry)),
	};
}

/// Whether an entry is something that takes place: a regular meeting or a published exam.
function isHeld(entry: CalendarEntry): boolean {
	return entry.kind === "event"
		? entry.event.kind === "REGULAR"
		: entry.exam.status !== "DRAFT";
}

/// The course week `instant` falls in, by local calendar days from `courseStart`.
function weekOf(instant: Date, courseStart: Date): number {
	const days = (dayNumber(instant) - dayNumber(courseStart)) / DAY;
	return Math.floor(days / 7);
}

/// Milliseconds at UTC midnight of `instant`'s local date, so day counts ignore DST.
function dayNumber(instant: Date): number {
	return Date.parse(`${localDateOf(instant)}T00:00:00Z`);
}
