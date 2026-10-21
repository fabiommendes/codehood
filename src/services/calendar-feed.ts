/**
 * A user's calendar as an iCalendar feed that calendar apps subscribe to.
 *
 * Pure: the caller loads the entries and the courses they belong to; this
 * decides which entries go out and how each one reads in a calendar app.
 */

import type { Course } from "@/db";
import type { CalendarEntry } from "@/services/calendar-entries";
import { courseHref } from "@/urls";
import { examTypeLabels } from "@/utils/exam-display";
import { type IcalEvent, renderIcal } from "@/utils/ical";

type CourseId = Course["id"];

/// The part of a course the feed needs: its discipline for titles, and its natural key for links.
export type FeedCourse = Pick<Course, "discipline" | "instructor" | "edition">;

/// Everything {@link renderCalendar} needs besides the entries themselves.
export interface CalendarFeedOptions {
	/// Scheme, host and port of this installation, without a trailing slash, e.g. `https://codehood.example`. Prefixes every link; its host (port included) suffixes every `UID`.
	origin: string;
	/// Display name of the calendar, already localized, written as `X-WR-CALNAME`.
	name: string;
	/// Locale tag written as the last segment of `PRODID`, e.g. `pt-BR`.
	locale: string;
	/// The course of every entry, by course id.
	courses: ReadonlyMap<CourseId, FeedCourse>;
}

/**
 * Renders `entries` as an iCalendar document with one `VEVENT` per meeting and per published dated exam.
 *
 * The calendar carries `PRODID:-//Codehood//Calendar//<locale>`,
 * `METHOD:PUBLISH` and `X-WR-CALNAME:<name>`, with every time in UTC and no
 * `VTIMEZONE`. Events keep the order of `entries`.
 *
 * Below, `<course>` is `<origin>` followed by `courseHref` of the entry's
 * course, `<label>` its discipline slug, and `<host>` the host of `origin`.
 *
 * A meeting (`kind: "event"`) becomes:
 * - `UID:event-<event.id>@<host>`, `DTSTAMP`: `event.updatedAt`;
 * - `DTSTART`/`DTEND`: the entry's `startAt`/`endAt`;
 * - `SUMMARY:<label> · <event.title>`, for holidays too;
 * - `DESCRIPTION`: `event.description`, a blank line and `<course>`, or just
 *   `<course>` when the event has no description;
 * - `URL:<course>/schedule#event-<event.id>`;
 * - `STATUS:CANCELLED` when `event.kind` is `CANCELLED`, no `STATUS` otherwise.
 *
 * An exam (`kind: "exam"`) becomes:
 * - `UID:exam-<exam.id>@<host>`, `DTSTAMP`: `exam.updatedAt`;
 * - `DTSTART`/`DTEND`: the entry's `startAt`/`endAt`, with no `DTEND` for an untimed exam;
 * - `SUMMARY:<label> · <type label>: <exam.title>`, the type label from
 *   `examTypeLabels`;
 * - `URL:<course>/exams/<exam.slug>`, no `DESCRIPTION`, no `STATUS`.
 *
 * Exams whose status is `DRAFT` or `ARCHIVED` are left out.
 *
 * @throws {Error} If an entry's `courseId` is missing from `opts.courses`.
 */
export function renderCalendar(
	entries: readonly CalendarEntry[],
	opts: CalendarFeedOptions,
): string {
	const host = new URL(opts.origin).host;
	const events: IcalEvent[] = [];
	for (const entry of entries) {
		if (
			entry.kind === "exam" &&
			(entry.exam.status === "DRAFT" || entry.exam.status === "ARCHIVED")
		) {
			continue;
		}
		const course = opts.courses.get(entry.courseId);
		if (!course) {
			throw new Error(`Course ${entry.courseId} missing from feed courses`);
		}
		const label = course.discipline.slug;
		const courseUrl =
			opts.origin +
			courseHref({
				discipline: course.discipline.slug,
				instructor: course.instructor.username,
				edition: course.edition.slug,
			});
		// A zero-length entry has no DTEND: RFC 5545 gives an event with only a
		// DTSTART no duration, which is what an untimed exam is.
		const base = {
			start: entry.startAt,
			end:
				entry.endAt.getTime() === entry.startAt.getTime()
					? undefined
					: entry.endAt,
		};
		if (entry.kind === "event") {
			const { event } = entry;
			events.push({
				...base,
				uid: `event-${event.id}@${host}`,
				stamp: event.updatedAt,
				summary: `${label} · ${event.title}`,
				description: event.description
					? `${event.description}\n\n${courseUrl}`
					: courseUrl,
				url: `${courseUrl}/schedule#event-${event.id}`,
				status: event.kind === "CANCELLED" ? "CANCELLED" : undefined,
			});
		} else {
			const { exam } = entry;
			events.push({
				...base,
				uid: `exam-${exam.id}@${host}`,
				stamp: exam.updatedAt,
				summary: `${label} · ${examTypeLabels[exam.type]}: ${exam.title}`,
				url: `${courseUrl}/exams/${exam.slug}`,
			});
		}
	}
	return renderIcal({
		prodId: `-//Codehood//Calendar//${opts.locale}`,
		method: "PUBLISH",
		name: opts.name,
		events,
	});
}
