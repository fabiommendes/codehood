import { expect, test } from "@playwright/test";
import {
	endOf,
	formatDateTime,
	formatTime,
	localDateOf,
	parseLocalDateTime,
	slotInstant,
	toInstant,
	toLocalDateTimeInput,
	weekdayOf,
	weekdayOnOrAfter,
} from "@/utils/schedule-time";

const NY = "America/New_York";

test("toInstant resolves the same wall clock to different instants on either side of a spring-forward boundary, and localDateOf maps both back to the authored day", () => {
	// US spring-forward in 2026 is March 8th: America/New_York moves from
	// EST (UTC-5) to EDT (UTC-4).
	const beforeDst = toInstant("2026-03-01", 14 * 60, NY); // still EST
	const afterDst = toInstant("2026-03-15", 14 * 60, NY); // now EDT

	expect(beforeDst.getTime()).not.toBe(afterDst.getTime());
	// A one-hour gap between the same wall clock on either side of the boundary.
	const beforeUtcHour = beforeDst.getUTCHours();
	const afterUtcHour = afterDst.getUTCHours();
	expect(afterUtcHour).toBe((beforeUtcHour - 1 + 24) % 24);

	expect(localDateOf(beforeDst, NY)).toBe("2026-03-01");
	expect(localDateOf(afterDst, NY)).toBe("2026-03-15");
});

test("formatTime pads minutes-since-midnight into HH:MM", () => {
	expect(formatTime(540)).toBe("09:00");
	expect(formatTime(0)).toBe("00:00");
	expect(formatTime(1439)).toBe("23:59");
});

test("formatDateTime renders in SERVER_TZ, not whatever the process's own default zone is", () => {
	// Noon wall clock in SERVER_TZ, whatever that zone is. 2026-06-15 is a Monday.
	const instant = toInstant("2026-06-15", 12 * 60);
	expect(formatDateTime(instant)).toBe("Mon, Jun 15, 12:00");

	// Explicitly rendering in a different zone must diverge from SERVER_TZ's
	// rendering (SERVER_TZ defaults to America/Sao_Paulo, UTC-3; UTC never
	// shares that offset), proving the function is zone-sensitive rather than
	// hardcoding a display regardless of the requested zone.
	const inUtc = formatDateTime(instant, { timeZone: "UTC" });
	expect(inUtc).not.toBe(formatDateTime(instant));
});

test("formatDateTime uses a 24-hour clock, with no AM/PM marker", () => {
	const cases: [string, string][] = [
		["2026-09-28T22:03:00Z", "Mon, Sep 28, 22:03"],
		["2026-09-28T09:05:00Z", "Mon, Sep 28, 09:05"],
		["2026-09-28T12:00:00Z", "Mon, Sep 28, 12:00"],
		// Midnight is 00:xx of the new day, never "24:xx" of the old one.
		["2026-09-29T00:05:00Z", "Tue, Sep 29, 00:05"],
	];
	for (const [iso, expected] of cases) {
		const rendered = formatDateTime(new Date(iso), { timeZone: "UTC" });
		expect(rendered).toBe(expected);
		expect(rendered).not.toMatch(/AM|PM/i);
	}
});

test("weekdayOf reads an instant near midnight as the local day, not the UTC one", () => {
	// 2026-01-05T02:00:00Z is 2026-01-04 23:00 in America/Sao_Paulo (UTC-3):
	// UTC's calendar day is Monday, but the local one is still Sunday.
	const instant = new Date("2026-01-05T02:00:00Z");
	expect(instant.getUTCDay()).toBe(1); // Monday, in UTC
	expect(weekdayOf(instant, "America/Sao_Paulo")).toBe("SUNDAY");
});

test("endOf adds minutes, and an event crossing midnight ends on the next local day", () => {
	const zone = "America/Sao_Paulo";
	const startAt = toInstant("2026-01-05", 23 * 60, zone); // 23:00
	const end = endOf(startAt, 120); // +2h -> 01:00 the next day
	expect(localDateOf(startAt, zone)).toBe("2026-01-05");
	expect(localDateOf(end, zone)).toBe("2026-01-06");
	expect(end.getTime() - startAt.getTime()).toBe(120 * 60_000);
});

test("weekdayOnOrAfter keeps a date that already falls on the target weekday", () => {
	const zone = "America/Sao_Paulo";
	// 2026-01-05 is a Monday.
	const monday = toInstant("2026-01-05", 9 * 60, zone);
	const result = weekdayOnOrAfter(monday, "MONDAY", zone);

	expect(localDateOf(result, zone)).toBe("2026-01-05");
	expect(result.getTime()).toBe(monday.getTime());
});

test("weekdayOnOrAfter advances to the coming weekday, wrapping across the week", () => {
	const zone = "America/Sao_Paulo";
	const monday = toInstant("2026-01-05", 9 * 60, zone);

	// Later in the same week.
	expect(localDateOf(weekdayOnOrAfter(monday, "WEDNESDAY", zone), zone)).toBe(
		"2026-01-07",
	);
	// ISO weeks end on Sunday, so Sunday is six days out, not the day before.
	expect(localDateOf(weekdayOnOrAfter(monday, "SUNDAY", zone), zone)).toBe(
		"2026-01-11",
	);

	// Wrapping from the end of the week back to its start.
	const saturday = toInstant("2026-01-10", 9 * 60, zone);
	expect(localDateOf(weekdayOnOrAfter(saturday, "MONDAY", zone), zone)).toBe(
		"2026-01-12",
	);
});

test("weekdayOnOrAfter reads the starting weekday in the given zone, not the process's", () => {
	// 2026-01-05T02:00:00Z is Monday in UTC but still Sunday 23:00 in
	// America/Sao_Paulo, so the two zones disagree on where the next Monday is.
	const instant = new Date("2026-01-05T02:00:00Z");

	expect(localDateOf(weekdayOnOrAfter(instant, "MONDAY", "UTC"), "UTC")).toBe(
		"2026-01-05",
	);
	expect(
		localDateOf(
			weekdayOnOrAfter(instant, "MONDAY", "America/Sao_Paulo"),
			"America/Sao_Paulo",
		),
	).toBe("2026-01-05");
});

test("slotInstant lands on the slot's weekday and clock time in the zone, week after week, across a DST change", () => {
	// 2026-03-02 is a Monday; New York springs forward on 2026-03-08.
	const courseStart = toInstant("2026-03-02", 9 * 60, NY);

	const week0 = slotInstant(courseStart, "WEDNESDAY", 0, 14 * 60, NY);
	const week1 = slotInstant(courseStart, "WEDNESDAY", 1, 14 * 60, NY);

	expect(week0.getTime()).toBe(toInstant("2026-03-04", 14 * 60, NY).getTime());
	expect(week1.getTime()).toBe(toInstant("2026-03-11", 14 * 60, NY).getTime());
	// One hour short of a week: the clock time holds, not the elapsed time.
	expect(week1.getTime() - week0.getTime()).toBe((7 * 24 - 1) * 3600_000);
});

test("slotInstant reads the course start's weekday in the zone, not in UTC", () => {
	// Sunday 23:00 in Sao Paulo is already Monday in UTC.
	const zone = "America/Sao_Paulo";
	const courseStart = toInstant("2026-01-04", 23 * 60, zone);

	const monday = slotInstant(courseStart, "MONDAY", 0, 8 * 60, zone);
	expect(localDateOf(monday, zone)).toBe("2026-01-05");
});

test("parseLocalDateTime reads a datetime-local value as wall time in SERVER_TZ, not in the process's zone", () => {
	expect(parseLocalDateTime("2026-06-15T14:30")).toEqual(
		toInstant("2026-06-15", 14 * 60 + 30),
	);
	expect(parseLocalDateTime("2026-12-01T00:00")).toEqual(
		toInstant("2026-12-01", 0),
	);
});

test("toLocalDateTimeInput renders an instant as the datetime-local value of its SERVER_TZ wall time", () => {
	expect(toLocalDateTimeInput(toInstant("2026-06-15", 14 * 60 + 30))).toBe(
		"2026-06-15T14:30",
	);
	expect(toLocalDateTimeInput(toInstant("2026-01-02", 5))).toBe(
		"2026-01-02T00:05",
	);
});

test("a datetime-local value survives the trip through parseLocalDateTime and back", () => {
	for (const value of [
		"2026-03-08T12:30",
		"2026-07-01T23:59",
		"2027-01-01T00:00",
	]) {
		expect(toLocalDateTimeInput(parseLocalDateTime(value))).toBe(value);
	}
});
