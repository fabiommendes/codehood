/**
 * The one place a wall clock (a date plus minutes-since-midnight, as a course
 * author writes it) turns into an instant, and the one place an instant turns
 * back into a wall clock for display.
 *
 * No Prisma import — only a type-only one, erased at compile time — so this
 * module unit-tests without a database. Built on `Intl.DateTimeFormat` with an
 * explicit `timeZone`, so no dependency is added.
 *
 * The rule this file exists to enforce: nothing else in the codebase calls
 * `toLocaleDateString`/`toLocaleTimeString` without an explicit `timeZone`.
 * `toInstant` is for writers; `formatDateTime`/`formatTime`/`localDateOf`/
 * `weekdayOf` are for readers. Never mix the two.
 */
import { SERVER_TZ as ENV_SERVER_TZ } from "astro:env/client";
import type { ClockTime, Duration } from "@/core/schemas";
import type { Weekday } from "@/db/";

// This module is reachable from hydrated islands (e.g. `ExamsTable`), so it
// runs in the browser too, where a plain `process.env` read would throw —
// `astro:env/client` (schema in `astro.config.mjs`) is safe on both sides for
// exactly that reason.
//
// Caveat this doesn't solve, only makes legible: `astro:env/client` values
// are inlined into the bundle at BUILD time, not read from the running
// process's environment at request time. If `SERVER_TZ` changes without a
// rebuild, or differs between the machine that built the deployed artifact
// and the one running it, this stays at whatever value the build saw.
/** The server's configured time zone (FR-NFR-020) — every instant is rendered here. */
export const SERVER_TZ: string = ENV_SERVER_TZ;

const WEEKDAY_ORDER: readonly Weekday[] = [
	"SUNDAY",
	"MONDAY",
	"TUESDAY",
	"WEDNESDAY",
	"THURSDAY",
	"FRIDAY",
	"SATURDAY",
];

/** `{ year, month, day, hour, minute, second }` of `instant`, read in `timeZone`. */
function partsOf(
	instant: Date,
	timeZone: string,
): {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
} {
	const dtf = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	});
	const map: Record<string, string> = {};
	for (const part of dtf.formatToParts(instant)) {
		map[part.type] = part.value;
	}
	return {
		year: Number(map.year),
		month: Number(map.month),
		day: Number(map.day),
		// h23 still prints "24" for midnight in some environments; normalize it.
		hour: Number(map.hour) % 24,
		minute: Number(map.minute),
		second: Number(map.second),
	};
}

/** The UTC-instant equivalent of `instant`'s wall clock read in `timeZone`. */
function offsetMs(instant: Date, timeZone: string): number {
	const p = partsOf(instant, timeZone);
	const asUtc = Date.UTC(
		p.year,
		p.month - 1,
		p.day,
		p.hour,
		p.minute,
		p.second,
	);
	return asUtc - instant.getTime();
}

/**
 * Resolves an authored wall clock — a date and minutes-since-midnight, both
 * in `zone` (default `SERVER_TZ`) — to an instant. Used by writers (`manage
 * import-calendar`, `TimeSlotService`/`EventService`'s defaulting from the
 * slot), never by readers. `zone` is a parameter (rather than always reading
 * `SERVER_TZ`) purely so this module unit-tests DST behavior in a fixed zone
 * without depending on the process's own `TZ`.
 */
export function toInstant(
	date: string /* YYYY-MM-DD */,
	minutes: number,
	zone: string = SERVER_TZ,
): Date {
	const [year, month, day] = date.split("-").map(Number) as [
		number,
		number,
		number,
	];
	const hour = Math.floor(minutes / 60);
	const minute = minutes % 60;

	// Two-pass zone resolution: guess the offset at the naive UTC reading of the
	// wall clock, correct for it, then re-check the offset at the corrected
	// instant in case the guess crossed a DST boundary.
	const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
	const guess = new Date(naiveUtcMs);
	const firstOffset = offsetMs(guess, zone);
	const corrected = new Date(naiveUtcMs - firstOffset);
	const secondOffset = offsetMs(corrected, zone);
	if (secondOffset === firstOffset) return corrected;
	return new Date(naiveUtcMs - secondOffset);
}

/** Renders `instant` in `SERVER_TZ` — FR-CAL-022's only implementation. */
export function formatDateTime(
	instant: Date,
	opts?: Intl.DateTimeFormatOptions,
): string {
	return new Intl.DateTimeFormat("en-US", {
		timeZone: SERVER_TZ,
		weekday: "short",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		...opts,
	}).format(instant);
}

/**
 * Format minutes from midnight to human readable hour.
 *
 * Example: `formatTime(870) -> "14:30"`.
 */
export function formatTime(minutes: number): string {
	const hour = Math.floor(minutes / 60);
	const minute = minutes % 60;
	return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Minutes-since-midnight as a wall clock — the inverse of {@link toMinutes}.
 */
export function toClockTime(minutes: number): ClockTime {
	return {
		hour: Math.floor(minutes / 60),
		minute: minutes % 60,
	};
}

/**
 * A wall clock as minutes-since-midnight — the inverse of {@link toClockTime}.
 */
export function toMinutes(time: ClockTime): number {
	return time.hour * 60 + time.minute;
}

/** `minutes` as a {@link Duration}, carrying whole hours out of the minutes. */
export function toDuration(minutes: number): Duration {
	return {
		hours: Math.floor(minutes / 60),
		minutes: minutes % 60,
	};
}

/** A {@link Duration} as a plain count of minutes, treating an absent field as zero. */
export function durationToMinutes(length: Duration): number {
	return (length.hours ?? 0) * 60 + (length.minutes ?? 0);
}

/** time as "HH:MM".
 * Delegates to {@link formatTime}.
 */
export function formatClock(time: ClockTime): string {
	return formatTime(toMinutes(time));
}

/** `instant`'s local calendar day in `zone` (default `SERVER_TZ`), as `YYYY-MM-DD` — for grouping a month grid. */
export function localDateOf(instant: Date, zone: string = SERVER_TZ): string {
	const p = partsOf(instant, zone);
	return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * instant's local weekday in zone
 *
 * Defaults to `SERVER_TZ` — for the slot-agreement check.
 */
export function weekdayOf(instant: Date, zone: string = SERVER_TZ): Weekday {
	const p = partsOf(instant, zone);
	const index = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
	// biome-ignore lint/style/noNonNullAssertion: getUTCDay() always returns 0-6, and WEEKDAY_ORDER has exactly 7 entries.
	return WEEKDAY_ORDER[index]!;
}

/**
 * startAt plus durationMin.
 *
 * An event crossing midnight ends on the next local day.
 */
export function endOf(startAt: Date, durationMin: number): Date {
	return new Date(startAt.getTime() + durationMin * 60_000);
}

/**
 * Convert Weekday to ISO weekday number.
 *
 * Monday = 1, Sunday = 7.
 */
export function isoWeekDay(weekday: Weekday): number {
	// We use a switch statement to avoid relying on the order of WEEKDAY enum or any array lookups.
	switch (weekday) {
		case "MONDAY":
			return 1;
		case "TUESDAY":
			return 2;
		case "WEDNESDAY":
			return 3;
		case "THURSDAY":
			return 4;
		case "FRIDAY":
			return 5;
		case "SATURDAY":
			return 6;
		case "SUNDAY":
			return 7;
		default:
			throw new Error(`Invalid weekday: ${weekday}`);
	}
}

/**
 * The first date on or after `startAt` whose local weekday in `zone` is
 * `targetWeekday`.
 *
 * `startAt` itself qualifies: a course that opens on a Monday holds its
 * Monday slot in week 0 on the start date, not seven days later.
 *
 * @param zone The time zone `startAt`'s weekday is read in, defaulting to
 *   `SERVER_TZ`.
 */
export function weekdayOnOrAfter(
	startAt: Date,
	targetWeekday: Weekday,
	zone: string = SERVER_TZ,
): Date {
	const currentWeekday = weekdayOf(startAt, zone);
	const daysUntilTarget =
		(isoWeekDay(targetWeekday) - isoWeekDay(currentWeekday) + 7) % 7;
	const result = new Date(startAt);
	result.setDate(result.getDate() + daysUntilTarget);
	return result;
}

/**
 * The instant a weekly slot meets in the given week of a course.
 *
 * Week 0 falls on the first `weekday` on or after `courseStart`. `startMin` is
 * a wall clock in `zone`, so the meeting keeps its clock time whatever the
 * process's own time zone, and across DST changes.
 *
 * @param zone The time zone the slot's clock time is read in, defaulting to
 *   `SERVER_TZ`.
 */
export function slotInstant(
	courseStart: Date,
	weekday: Weekday,
	week: number,
	startMin: number,
	zone: string = SERVER_TZ,
): Date {
	const daysUntilWeekday =
		(isoWeekDay(weekday) - isoWeekDay(weekdayOf(courseStart, zone)) + 7) % 7;
	const day = addDays(
		localDateOf(courseStart, zone),
		daysUntilWeekday + week * 7,
	);
	return toInstant(day, startMin, zone);
}

/// The `YYYY-MM-DD` day `days` calendar days after `date`.
function addDays(date: string, days: number): string {
	const [year, month, day] = date.split("-").map(Number) as [
		number,
		number,
		number,
	];
	return new Date(Date.UTC(year, month - 1, day + days))
		.toISOString()
		.slice(0, 10);
}
