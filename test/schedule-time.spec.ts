import { expect, test } from "@playwright/test";
import {
	endOf,
	formatDateTime,
	formatTime,
	localDateOf,
	SERVER_TZ,
	toInstant,
	weekdayOf,
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
	const instant = toInstant("2026-06-15", 12 * 60);
	const expected = new Intl.DateTimeFormat("en-US", {
		timeZone: SERVER_TZ,
		weekday: "short",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(instant);
	expect(formatDateTime(instant)).toBe(expected);

	// Explicitly rendering in a different zone must diverge from SERVER_TZ's
	// rendering (SERVER_TZ defaults to America/Sao_Paulo, UTC-3; UTC never
	// shares that offset), proving the function is zone-sensitive rather than
	// hardcoding a display regardless of the requested zone.
	const inUtc = formatDateTime(instant, { timeZone: "UTC" });
	expect(inUtc).not.toBe(formatDateTime(instant));
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
