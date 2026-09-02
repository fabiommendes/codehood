/**
 * The one place a wall clock (a date plus minutes-since-midnight, as a course
 * author writes it) turns into an instant, and the one place an instant turns
 * back into a wall clock for display. See `dev/specs/to-review/calendar.md`.
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
import type { Weekday } from "@/db/client";

/** The server's configured time zone (FR-NFR-020) — every instant is rendered here. */
export const SERVER_TZ: string = process.env.TZ ?? "America/Sao_Paulo";

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
	const [year, month, day] = date.split("-").map(Number);
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

/** `870 -> "14:30"`. Pure: minutes-since-midnight carry no time zone. */
export function formatTime(minutes: number): string {
	const hour = Math.floor(minutes / 60);
	const minute = minutes % 60;
	return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** `instant`'s local calendar day in `zone` (default `SERVER_TZ`), as `YYYY-MM-DD` — for grouping a month grid. */
export function localDateOf(instant: Date, zone: string = SERVER_TZ): string {
	const p = partsOf(instant, zone);
	return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** `instant`'s local weekday in `zone` (default `SERVER_TZ`) — for the slot-agreement check. */
export function weekdayOf(instant: Date, zone: string = SERVER_TZ): Weekday {
	const p = partsOf(instant, zone);
	const index = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
	return WEEKDAY_ORDER[index];
}

/** `startAt` plus `durationMin`. An event crossing midnight ends on the next local day. */
export function endOf(startAt: Date, durationMin: number): Date {
	return new Date(startAt.getTime() + durationMin * 60_000);
}
