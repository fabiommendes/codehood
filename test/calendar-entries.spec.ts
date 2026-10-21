import { expect, test } from "@playwright/test";
import type { CalendarEvent, Exam } from "@/db";
import { calendarEntries } from "@/services/calendar-entries";
import type { ExceptionTiming } from "@/services/exam-state";

const MINUTE = 60_000;

const T0 = new Date("2026-03-10T10:00:00Z");

/// `T0` shifted by `minutes`.
function at(minutes: number): Date {
	return new Date(T0.getTime() + minutes * MINUTE);
}

const COURSE_A = 1 as CalendarEvent["courseId"];
const COURSE_B = 2 as CalendarEvent["courseId"];

let nextId = 1;

/// A regular 100-minute meeting of `courseId` starting at `startAt`.
function event(
	title: string,
	startAt: Date,
	courseId = COURSE_A,
): CalendarEvent {
	const id = nextId++;
	return {
		id: id as CalendarEvent["id"],
		courseId,
		kind: "REGULAR",
		title,
		description: null,
		startAt,
		week: 1,
		timeSlot: {
			id: id as CalendarEvent["timeSlot"]["id"],
			day: "TUESDAY",
			slug: "lab",
			duration: { hours: 1, minutes: 40 },
			start: { hour: 10, minute: 0 },
		},
		rev: null,
		createdAt: T0,
		updatedAt: T0,
	};
}

/// A scheduled exam of the given slug, overridable field by field.
function exam(slug: string, overrides: Partial<Exam> = {}): Exam {
	return {
		id: nextId++ as Exam["id"],
		slug,
		type: "EXAM",
		status: "SCHEDULED",
		title: slug,
		description: null,
		preamble: null,
		format: "PLAINTEXT",
		scheduledAt: null,
		duration: null,
		extraTime: null,
		gradesReleasedAt: null,
		author: "ada",
		rev: null,
		tags: [],
		questions: [],
		createdAt: T0,
		updatedAt: T0,
		...overrides,
	};
}

/// The entries' titles in order, so a case reads as a sequence.
function titles(entries: ReturnType<typeof calendarEntries>): string[] {
	return entries.map((e) =>
		e.kind === "event" ? e.event.title : e.exam.title,
	);
}

test("events and exams merge into one list in start order", () => {
	const entries = calendarEntries(
		[event("lab 1", at(0)), event("lab 2", at(2000))],
		[
			{
				courseId: COURSE_B,
				exam: exam("midterm", { scheduledAt: at(1000) }),
			},
			{ courseId: COURSE_A, exam: exam("quiz", { scheduledAt: at(-500) }) },
		],
	);

	expect(titles(entries)).toEqual(["quiz", "lab 1", "midterm", "lab 2"]);
});

test("the inputs need not be sorted", () => {
	const entries = calendarEntries(
		[event("late", at(50)), event("early", at(10))],
		[
			{ courseId: COURSE_A, exam: exam("last", { scheduledAt: at(90) }) },
			{ courseId: COURSE_A, exam: exam("first", { scheduledAt: at(0) }) },
		],
	);

	expect(titles(entries)).toEqual(["first", "early", "late", "last"]);
});

test("at the same instant an exam comes before an event", () => {
	const entries = calendarEntries(
		[event("lab", at(0))],
		[{ courseId: COURSE_A, exam: exam("midterm", { scheduledAt: at(0) }) }],
	);

	expect(titles(entries)).toEqual(["midterm", "lab"]);
});

test("entries of one kind at the same instant keep their input order", () => {
	const entries = calendarEntries(
		[event("b", at(0)), event("a", at(0), COURSE_B)],
		[
			{ courseId: COURSE_A, exam: exam("y", { scheduledAt: at(5) }) },
			{ courseId: COURSE_B, exam: exam("x", { scheduledAt: at(5) }) },
		],
	);

	expect(titles(entries)).toEqual(["b", "a", "y", "x"]);
});

test("an exam without a date has no place on the calendar", () => {
	const entries = calendarEntries(
		[event("lab", at(0))],
		[
			{ courseId: COURSE_A, exam: exam("practice", { type: "PRACTICE" }) },
			{ courseId: COURSE_A, exam: exam("final") },
		],
	);

	expect(titles(entries)).toEqual(["lab"]);
});

test("archived exams stay off the calendar even with a date; drafts stay on, for whoever may see them", () => {
	const entries = calendarEntries(
		[],
		[
			{
				courseId: COURSE_A,
				exam: exam("draft", { status: "DRAFT", scheduledAt: at(0) }),
			},
			{
				courseId: COURSE_A,
				exam: exam("archived", { status: "ARCHIVED", scheduledAt: at(10) }),
			},
			{
				courseId: COURSE_A,
				exam: exam("ongoing", { status: "ONGOING", scheduledAt: at(20) }),
			},
			{
				courseId: COURSE_A,
				exam: exam("done", { status: "COMPLETED", scheduledAt: at(30) }),
			},
		],
	);

	expect(titles(entries)).toEqual(["draft", "ongoing", "done"]);
});

test("each entry keeps its own kind, record and course", () => {
	const lab = event("lab", at(0), COURSE_B);
	const midterm = exam("midterm", { scheduledAt: at(60) });
	const [first, second] = calendarEntries(
		[lab],
		[{ courseId: COURSE_A, exam: midterm }],
	);

	expect(first).toMatchObject({
		kind: "event",
		event: lab,
		courseId: COURSE_B,
		startAt: at(0),
	});
	expect(second).toMatchObject({
		kind: "exam",
		exam: midterm,
		courseId: COURSE_A,
		startAt: at(60),
	});
});

test("an entry ends after its meeting length or its answering window", () => {
	const [lab, timed, untimed] = calendarEntries(
		[event("lab", at(0))],
		[
			{
				courseId: COURSE_A,
				exam: exam("timed", {
					scheduledAt: at(200),
					duration: { hours: 1, minutes: 30 },
					extraTime: { minutes: 15 },
				}),
			},
			{ courseId: COURSE_A, exam: exam("untimed", { scheduledAt: at(400) }) },
		],
	);

	expect(lab?.endAt).toEqual(at(100));
	expect(timed?.endAt).toEqual(at(200 + 105));
	expect(untimed?.endAt).toEqual(at(400));
});

test("nothing in, nothing out", () => {
	expect(calendarEntries([], [])).toEqual([]);
});

//
// Personal timing
//

test("a makeup moves the viewer's entry to the personal window", () => {
	const midterm = exam("midterm", {
		scheduledAt: at(0),
		duration: { minutes: 60 },
	});
	const makeup: ExceptionTiming = { extraTime: null, scheduledAt: at(1000) };

	const [entry] = calendarEntries(
		[],
		[{ courseId: COURSE_A, exam: midterm, exception: makeup }],
	);
	const [classmate] = calendarEntries(
		[],
		[{ courseId: COURSE_A, exam: midterm }],
	);

	expect([entry?.startAt, entry?.endAt]).toEqual([at(1000), at(1060)]);
	expect(entry?.kind === "exam" && entry.exam).toBe(midterm);
	expect([classmate?.startAt, classmate?.endAt]).toEqual([at(0), at(60)]);
});

test("extra time lengthens the viewer's entry and keeps its start", () => {
	const midterm = exam("midterm", {
		scheduledAt: at(0),
		duration: { minutes: 60 },
		extraTime: { minutes: 10 },
	});
	const extra: ExceptionTiming = {
		extraTime: { minutes: 30 },
		scheduledAt: null,
	};

	const [entry] = calendarEntries(
		[],
		[{ courseId: COURSE_A, exam: midterm, exception: extra }],
	);

	expect([entry?.startAt, entry?.endAt]).toEqual([at(0), at(100)]);
});

test("a makeup reorders the viewer's calendar", () => {
	const midterm = exam("midterm", {
		scheduledAt: at(0),
		duration: { minutes: 60 },
	});
	const makeup: ExceptionTiming = { extraTime: null, scheduledAt: at(1000) };

	const entries = calendarEntries(
		[event("lab", at(500))],
		[{ courseId: COURSE_A, exam: midterm, exception: makeup }],
	);

	expect(titles(entries)).toEqual(["lab", "midterm"]);
});
