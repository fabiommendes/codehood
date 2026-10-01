import { expect, test } from "@playwright/test";
import type { CalendarEvent, Exam } from "@/db";
import type { CalendarEntry } from "@/services/calendar-entries";
import { courseSchedule } from "@/services/course-schedule";

const DAY = 86_400_000;
const HOUR = 3_600_000;

/// A Monday at noon, when the course starts.
const START = new Date("2026-03-02T15:00:00Z");

/// `START` shifted by `days`, at the same time of day.
function day(days: number): Date {
	return new Date(START.getTime() + days * DAY);
}

/// A two-hour meeting in `week`, held `weekday` days after that week's Monday.
function meeting(
	title: string,
	week: number,
	weekday = 0,
	kind: CalendarEvent["kind"] = "REGULAR",
): CalendarEntry {
	const startAt = day(week * 7 + weekday);
	return {
		kind: "event",
		courseId: 1 as CalendarEvent["courseId"],
		startAt,
		endAt: new Date(startAt.getTime() + 2 * HOUR),
		event: { title, week, kind } as CalendarEvent,
	};
}

/// An untimed exam on `startAt`.
function exam(
	title: string,
	startAt: Date,
	status: Exam["status"] = "SCHEDULED",
): CalendarEntry {
	return {
		kind: "exam",
		courseId: 1 as CalendarEvent["courseId"],
		startAt,
		endAt: startAt,
		exam: { title, status } as Exam,
	};
}

/// Each week's number and entry titles, so a case reads as a table.
function titles(weeks: { week: number; entries: CalendarEntry[] }[]) {
	return weeks.map(({ week, entries }) => [
		week,
		entries.map((entry) =>
			entry.kind === "event" ? entry.event.title : entry.exam.title,
		),
	]);
}

test("an exam joins the week its date falls in", () => {
	const entries = [
		meeting("Intro", 0),
		exam("Quiz", day(9)),
		meeting("Loops", 1, 2),
		exam("Midterm", day(15)),
	];

	const { ahead } = courseSchedule(entries, START, day(-1));

	expect(titles(ahead)).toEqual([
		[0, ["Intro"]],
		[1, ["Quiz", "Loops"]],
		[2, ["Midterm"]],
	]);
});

test("a week stays ahead until its last entry is over", () => {
	const entries = [
		meeting("Intro", 0),
		meeting("Lab", 0, 2),
		meeting("Loops", 1),
	];

	// Between Monday's and Wednesday's meetings of week 0.
	const midWeek = courseSchedule(entries, START, day(1));
	expect(titles(midWeek.past)).toEqual([]);
	expect(titles(midWeek.ahead).map(([week]) => week)).toEqual([0, 1]);

	const nextWeek = courseSchedule(entries, START, day(5));
	expect(titles(nextWeek.past)).toEqual([[0, ["Intro", "Lab"]]]);
	expect(titles(nextWeek.ahead)).toEqual([[1, ["Loops"]]]);
});

test("once the term is over every week is past and nothing is next", () => {
	const schedule = courseSchedule([meeting("Intro", 0)], START, day(30));

	expect(schedule.ahead).toEqual([]);
	expect(schedule.past).toHaveLength(1);
	expect(schedule.next).toBeUndefined();
});

test("next is the meeting going on now", () => {
	const entries = [meeting("Intro", 0), meeting("Lab", 0, 2)];

	const { next } = courseSchedule(
		entries,
		START,
		new Date(START.getTime() + HOUR),
	);

	expect(next?.kind === "event" && next.event.title).toBe("Intro");
});

test("next skips holidays, cancelled meetings and drafts", () => {
	const entries = [
		meeting("Carnival", 0, 0, "HOLIDAY"),
		meeting("Lab", 0, 2, "CANCELLED"),
		exam("Unfinished quiz", day(3), "DRAFT"),
		meeting("Loops", 1),
	];

	const { next } = courseSchedule(entries, START, day(-1));

	expect(next?.kind === "event" && next.event.title).toBe("Loops");
});
