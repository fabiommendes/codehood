import { expect, test } from "@playwright/test";
import type { CalendarEvent, Exam } from "@/db";
import type { CalendarEntry } from "@/services/calendar-entries";
import {
	type CalendarFeedOptions,
	renderCalendar,
} from "@/services/calendar-feed";
import { examTypeLabels } from "@/utils/exam-display";

// renderCalendar: how calendar entries read in a calendar app. Pure, no database.

type CourseId = CalendarEvent["courseId"];

const COURSE_ID = 7 as CourseId;
const ORIGIN = "https://codehood.example:8443";
const COURSE_URL = `${ORIGIN}/cs101/ada_2026-1`;

const OPTIONS: CalendarFeedOptions = {
	origin: ORIGIN,
	name: "Codehood — Ada",
	locale: "pt-BR",
	courses: new Map([
		[
			COURSE_ID,
			{
				discipline: { slug: "cs101", name: "Intro" },
				instructor: { username: "ada", name: "Ada" },
				edition: { slug: "2026-1", name: "2026.1" },
			},
		],
	]),
};

const START = new Date("2026-03-10T13:00:00Z");
const STAMP = new Date("2026-03-01T08:30:15Z");

function eventEntry(overrides: Partial<CalendarEvent> = {}): CalendarEntry {
	const event: CalendarEvent = {
		id: 12 as CalendarEvent["id"],
		courseId: COURSE_ID,
		kind: "REGULAR",
		title: "Lab 1",
		description: null,
		startAt: START,
		week: 1,
		timeSlot: {
			id: 1 as CalendarEvent["timeSlot"]["id"],
			day: "TUESDAY",
			slug: "lab",
			duration: { hours: 1, minutes: 40 },
			start: { hour: 10, minute: 0 },
		},
		rev: null,
		createdAt: STAMP,
		updatedAt: STAMP,
		...overrides,
	};
	return {
		kind: "event",
		event,
		courseId: event.courseId,
		startAt: event.startAt,
		endAt: new Date(event.startAt.getTime() + 100 * 60_000),
	};
}

function examEntry(overrides: Partial<Exam> = {}): CalendarEntry {
	const exam: Exam = {
		id: 5 as Exam["id"],
		slug: "p1",
		type: "EXAM",
		status: "SCHEDULED",
		title: "P1",
		description: null,
		preamble: null,
		format: "PLAINTEXT",
		scheduledAt: START,
		duration: { hours: 1, minutes: 30 },
		extraTime: null,
		gradesReleasedAt: null,
		author: "ada",
		rev: null,
		tags: [],
		questions: [],
		createdAt: STAMP,
		updatedAt: STAMP,
		...overrides,
	};
	return {
		kind: "exam",
		exam,
		courseId: COURSE_ID,
		startAt: START,
		endAt: new Date("2026-03-10T14:30:00Z"),
	};
}

/// The content lines of the document, with folded lines joined back.
function contentLines(output: string): string[] {
	return output.replaceAll("\r\n ", "").split("\r\n").filter(Boolean);
}

/// The content lines of the only `VEVENT` in `entries`' rendering.
function veventLines(
	entry: CalendarEntry,
	opts: CalendarFeedOptions = OPTIONS,
): string[] {
	const lines = contentLines(renderCalendar([entry], opts));
	const begin = lines.indexOf("BEGIN:VEVENT");
	const end = lines.indexOf("END:VEVENT");
	expect(begin).toBeGreaterThan(-1);
	return lines.slice(begin + 1, end);
}

//
// Calendar header
//

test("the calendar carries VERSION, PRODID with the locale, CALSCALE, METHOD:PUBLISH and the localized name", () => {
	const lines = contentLines(renderCalendar([], OPTIONS));

	expect(lines).toEqual([
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Codehood//Calendar//pt-BR",
		"CALSCALE:GREGORIAN",
		"METHOD:PUBLISH",
		"X-WR-CALNAME:Codehood — Ada",
		"END:VCALENDAR",
	]);
});

test("the calendar name is escaped as text", () => {
	const output = renderCalendar([], {
		...OPTIONS,
		name: "Codehood, Ada; Lovelace",
	});

	expect(contentLines(output)).toContain(
		"X-WR-CALNAME:Codehood\\, Ada\\; Lovelace",
	);
});

test("entries become one VEVENT each, in the order given", () => {
	const output = renderCalendar(
		[
			eventEntry({ id: 3 as CalendarEvent["id"] }),
			examEntry(),
			eventEntry({ id: 1 as CalendarEvent["id"] }),
		],
		OPTIONS,
	);

	expect(contentLines(output).filter((l) => l.startsWith("UID:"))).toEqual([
		"UID:event-3@codehood.example:8443",
		"UID:exam-5@codehood.example:8443",
		"UID:event-1@codehood.example:8443",
	]);
});

test("rendering the same entries twice gives byte-identical output", () => {
	const entries = [eventEntry(), examEntry()];

	expect(renderCalendar(entries, OPTIONS)).toBe(
		renderCalendar(entries, OPTIONS),
	);
});

//
// Course meetings
//

test("a meeting without description reads as discipline, times in UTC, course URL and the schedule anchor", () => {
	const lines = veventLines(eventEntry());

	expect(lines).toEqual([
		"UID:event-12@codehood.example:8443",
		"DTSTAMP:20260301T083015Z",
		"DTSTART:20260310T130000Z",
		"DTEND:20260310T144000Z",
		"SUMMARY:cs101 · Lab 1",
		`DESCRIPTION:${COURSE_URL}`,
		`URL:${COURSE_URL}/schedule#event-12`,
	]);
});

test("a meeting description is followed by a blank line and the course URL", () => {
	const lines = veventLines(
		eventEntry({ description: "Bring a laptop, please" }),
	);

	expect(lines).toContain(
		`DESCRIPTION:Bring a laptop\\, please\\n\\n${COURSE_URL}`,
	);
});

test("DTSTAMP is the event's updatedAt, not its createdAt", () => {
	const lines = veventLines(
		eventEntry({ updatedAt: new Date("2026-03-05T09:00:00Z") }),
	);

	expect(lines).toContain("DTSTAMP:20260305T090000Z");
});

test("UIDs are keyed by the event id and the origin's host with its port, not by content", () => {
	const first = veventLines(eventEntry({ title: "Lab 1" }));
	const renamed = veventLines(eventEntry({ title: "Lab 1 (moved)" }));

	expect(first).toContain("UID:event-12@codehood.example:8443");
	expect(renamed).toContain("UID:event-12@codehood.example:8443");
});

test("an unknown course id is an error, not a silently dropped entry", () => {
	const orphan = eventEntry({ courseId: 99 as CourseId });

	expect(() => renderCalendar([eventEntry()], OPTIONS)).not.toThrow();
	expect(() => renderCalendar([orphan], OPTIONS)).toThrow();
});

//
// Exams
//

test("a dated exam reads as discipline, type label and title, window in UTC, and the exam page URL", () => {
	const lines = veventLines(examEntry());

	expect(lines).toEqual([
		"UID:exam-5@codehood.example:8443",
		"DTSTAMP:20260301T083015Z",
		"DTSTART:20260310T130000Z",
		"DTEND:20260310T143000Z",
		`SUMMARY:cs101 · ${examTypeLabels.EXAM}: P1`,
		`URL:${COURSE_URL}/exams/p1`,
	]);
});

test("the exam type label follows the exam's type", () => {
	const lines = veventLines(examEntry({ type: "QUIZ", title: "Quiz 2" }));

	expect(lines).toContain(`SUMMARY:cs101 · ${examTypeLabels.QUIZ}: Quiz 2`);
});

test("DTEND of an exam is the entry's endAt (the window end with extra time), not start plus duration", () => {
	const entry = examEntry({ extraTime: { hours: 0, minutes: 30 } });
	if (entry.kind !== "exam") throw new Error("expected an exam entry");
	entry.endAt = new Date("2026-03-10T15:00:00Z");

	expect(veventLines(entry)).toContain("DTEND:20260310T150000Z");
});

//
// Cancelled meetings, holidays, untimed and unpublished exams
//

test("a cancelled meeting stays in the feed with STATUS:CANCELLED", () => {
	const lines = veventLines(eventEntry({ kind: "CANCELLED" }));

	expect(lines).toContain("UID:event-12@codehood.example:8443");
	expect(lines).toContain("STATUS:CANCELLED");
});

test("a holiday is a normal VEVENT titled with the holiday, without STATUS", () => {
	const lines = veventLines(eventEntry({ kind: "HOLIDAY", title: "Carnival" }));

	expect(lines).toContain("SUMMARY:cs101 · Carnival");
	expect(lines.some((l) => l.startsWith("STATUS"))).toBe(false);
});

test("a regular meeting has no STATUS line", () => {
	const lines = veventLines(eventEntry({ kind: "REGULAR" }));

	expect(lines.some((l) => l.startsWith("STATUS"))).toBe(false);
});

test("an untimed exam is a zero-length event: DTEND equals DTSTART", () => {
	const entry: CalendarEntry = {
		...examEntry({ duration: null }),
		endAt: START,
	};

	const lines = veventLines(entry);

	expect(lines).toContain("DTSTART:20260310T130000Z");
	expect(lines).toContain("DTEND:20260310T130000Z");
});

for (const status of ["DRAFT", "ARCHIVED"] as const) {
	test(`a ${status} exam is left out of the feed while its neighbours stay`, () => {
		const output = renderCalendar(
			[
				eventEntry(),
				examEntry({ id: 6 as Exam["id"], status }),
				examEntry({ id: 7 as Exam["id"], status: "SCHEDULED" }),
			],
			OPTIONS,
		);

		const uids = contentLines(output).filter((l) => l.startsWith("UID:"));
		expect(uids).toEqual([
			"UID:event-12@codehood.example:8443",
			"UID:exam-7@codehood.example:8443",
		]);
	});
}

for (const status of ["SCHEDULED", "ONGOING", "COMPLETED"] as const) {
	test(`a ${status} exam is kept in the feed`, () => {
		const lines = veventLines(examEntry({ status }));

		expect(lines).toContain("UID:exam-5@codehood.example:8443");
	});
}
