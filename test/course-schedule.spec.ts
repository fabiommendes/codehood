import { expect, test } from "@playwright/test";
import { isoDate } from "@/core/schemas";
import type { CalendarEvent, Exam } from "@/db";
import type { CalendarEntry } from "@/services/calendar-entries";
import { courseSchedule, weekOf } from "@/services/course-schedule";
import { toInstant } from "@/utils/schedule-time";

const DAY = 86_400_000;
const HOUR = 3_600_000;

/// A Monday at noon, when the course starts.
const START = new Date("2026-03-02T15:00:00Z");

/// The date the course starts.
const START_DATE = isoDate.parse("2026-03-02");

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

	const { ahead } = courseSchedule(entries, START_DATE, day(-1));

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
	const midWeek = courseSchedule(entries, START_DATE, day(1));
	expect(titles(midWeek.past)).toEqual([]);
	expect(titles(midWeek.ahead).map(([week]) => week)).toEqual([0, 1]);

	const nextWeek = courseSchedule(entries, START_DATE, day(5));
	expect(titles(nextWeek.past)).toEqual([[0, ["Intro", "Lab"]]]);
	expect(titles(nextWeek.ahead)).toEqual([[1, ["Loops"]]]);
});

test("once the term is over every week is past and nothing is next", () => {
	const schedule = courseSchedule([meeting("Intro", 0)], START_DATE, day(30));

	expect(schedule.ahead).toEqual([]);
	expect(schedule.past).toHaveLength(1);
	expect(schedule.next).toBeUndefined();
});

test("next is the meeting going on now", () => {
	const entries = [meeting("Intro", 0), meeting("Lab", 0, 2)];

	const { next } = courseSchedule(
		entries,
		START_DATE,
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

	const { next } = courseSchedule(entries, START_DATE, day(-1));

	expect(next?.kind === "event" && next.event.title).toBe("Loops");
});

test("a week whose last meeting ended earlier today stays ahead until the day turns", () => {
	const entries = [meeting("Intro", 0), meeting("Loops", 1)];

	// An hour after Intro ended, still Monday.
	const sameDay = courseSchedule(
		entries,
		START_DATE,
		new Date(START.getTime() + 3 * HOUR),
	);
	expect(titles(sameDay.past)).toEqual([]);
	expect(titles(sameDay.ahead)).toEqual([
		[0, ["Intro"]],
		[1, ["Loops"]],
	]);
	expect(sameDay.next?.kind === "event" && sameDay.next.event.title).toBe(
		"Loops",
	);

	const nextDay = courseSchedule(entries, START_DATE, day(1));
	expect(titles(nextDay.past)).toEqual([[0, ["Intro"]]]);
});

test("weeks are ISO weeks: a course starting on a Wednesday puts the next Monday in week 1", () => {
	const wednesday = new Date("2026-03-04T15:00:00Z");
	const entries = [
		exam("Kickoff", wednesday),
		exam("Quiz", new Date("2026-03-09T15:00:00Z")),
	];

	const { ahead } = courseSchedule(
		entries,
		isoDate.parse("2026-03-04"),
		day(-1),
	);

	expect(titles(ahead)).toEqual([
		[0, ["Kickoff"]],
		[1, ["Quiz"]],
	]);
});

test("weekOf counts ISO weeks from the Monday of the start date's week, for a Monday, Saturday and Sunday start", () => {
	const at = (iso: string) => toInstant(iso, 12 * 60);
	// Monday start: the 2nd is day 0 of week 0, the 9th opens week 1.
	expect(weekOf(at("2026-03-08"), isoDate.parse("2026-03-02"))).toBe(0);
	expect(weekOf(at("2026-03-09"), isoDate.parse("2026-03-02"))).toBe(1);
	// Saturday start: week 0 is the week that holds it, so Monday after is week 1.
	expect(weekOf(at("2026-03-07"), isoDate.parse("2026-03-07"))).toBe(0);
	expect(weekOf(at("2026-03-09"), isoDate.parse("2026-03-07"))).toBe(1);
	// Sunday start: it closes week 0, and the next day opens week 1.
	expect(weekOf(at("2026-03-08"), isoDate.parse("2026-03-08"))).toBe(0);
	expect(weekOf(at("2026-03-09"), isoDate.parse("2026-03-08"))).toBe(1);
});
