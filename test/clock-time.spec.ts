import { expect, test } from "@playwright/test";
import fc from "fast-check";
import { clockTime, duration } from "@/core/schemas/base";
import {
	durationToMinutes,
	formatClock,
	toClockTime,
	toDuration,
	toMinutes,
} from "@/utils/schedule-time";

const validClockTime = fc.record({
	hour: fc.integer({ min: 0, max: 23 }),
	minute: fc.integer({ min: 0, max: 59 }),
});

test("toMinutes(toClockTime(m)) === m for every minute of the day", () => {
	fc.assert(
		fc.property(fc.integer({ min: 0, max: 1439 }), (m) => {
			expect(toMinutes(toClockTime(m))).toBe(m);
		}),
	);
});

test("toClockTime(toMinutes(t)) === t for every valid clock time", () => {
	fc.assert(
		fc.property(validClockTime, (t) => {
			expect(toClockTime(toMinutes(t))).toEqual(t);
		}),
	);
});

test("clockTime rejects an hour or minute outside its range", () => {
	const cases: Array<[string, unknown]> = [
		["hour below 0", { hour: -1, minute: 0 }],
		["hour above 23", { hour: 24, minute: 0 }],
		["minute below 0", { hour: 0, minute: -1 }],
		["minute above 59", { hour: 0, minute: 60 }],
		["non-integer hour", { hour: 1.5, minute: 0 }],
		["non-integer minute", { hour: 0, minute: 1.5 }],
	];
	for (const [label, input] of cases) {
		expect(clockTime.safeParse(input).success, label).toBe(false);
	}
});

test("clockTime accepts every hour/minute pair on the boundary", () => {
	for (const input of [
		{ hour: 0, minute: 0 },
		{ hour: 0, minute: 59 },
		{ hour: 23, minute: 0 },
		{ hour: 23, minute: 59 },
	]) {
		expect(clockTime.safeParse(input).success).toBe(true);
	}
});

test("formatClock: midnight, noon, 09:05, 23:59", () => {
	const cases: Array<[{ hour: number; minute: number }, string]> = [
		[{ hour: 0, minute: 0 }, "00:00"],
		[{ hour: 12, minute: 0 }, "12:00"],
		[{ hour: 9, minute: 5 }, "09:05"],
		[{ hour: 23, minute: 59 }, "23:59"],
	];
	for (const [time, expected] of cases) {
		expect(formatClock(time)).toBe(expected);
	}
});

test("durationToMinutes(toDuration(m)) === m for any length up to a week", () => {
	fc.assert(
		fc.property(fc.integer({ min: 0, max: 7 * 24 * 60 }), (minutes) => {
			expect(durationToMinutes(toDuration(minutes))).toBe(minutes);
		}),
	);
});

test("a duration needs neither field, and an absent one counts as zero", () => {
	expect(durationToMinutes({})).toBe(0);
	expect(durationToMinutes({ hours: 2 })).toBe(120);
	expect(durationToMinutes({ minutes: 90 })).toBe(90);
	expect(duration.safeParse({}).success).toBe(true);
	expect(duration.safeParse({ hours: 1 }).success).toBe(true);
});

test("a duration caps neither field: 150 minutes and 2h30 are the same length", () => {
	expect(duration.safeParse({ minutes: 150 }).success).toBe(true);
	expect(duration.safeParse({ hours: 40 }).success).toBe(true);
	expect(durationToMinutes({ minutes: 150 })).toBe(
		durationToMinutes({ hours: 2, minutes: 30 }),
	);
});

test("a duration rejects a negative or fractional field", () => {
	expect(duration.safeParse({ minutes: -1 }).success).toBe(false);
	expect(duration.safeParse({ hours: 1.5 }).success).toBe(false);
});
