import { expect, test } from "@playwright/test";
import { rollCallOpenable } from "@/services/roll-call-window";

const ZONE = "America/Sao_Paulo";

/// Friday 2026-10-16, 14:00-18:00 in São Paulo (UTC-3).
const FRIDAY = {
	startAt: new Date("2026-10-16T17:00:00Z"),
	endAt: new Date("2026-10-16T21:00:00Z"),
};
/// Wednesday 2026-10-14, 14:00-18:00 in São Paulo.
const WEDNESDAY = {
	startAt: new Date("2026-10-14T17:00:00Z"),
	endAt: new Date("2026-10-14T21:00:00Z"),
};

test("a meeting later today is openable hours before it starts", () => {
	const morning = new Date("2026-10-16T14:50:00Z"); // 11:50 local
	expect(rollCallOpenable(FRIDAY, morning, ZONE)).toBe(true);
});

test("an earlier meeting of the same week is not openable", () => {
	const morning = new Date("2026-10-16T14:50:00Z");
	expect(rollCallOpenable(WEDNESDAY, morning, ZONE)).toBe(false);
});

test("a meeting is openable while it runs and not after it ends", () => {
	expect(rollCallOpenable(FRIDAY, new Date("2026-10-16T20:59:00Z"), ZONE)).toBe(
		true,
	);
	expect(rollCallOpenable(FRIDAY, new Date("2026-10-16T21:00:00Z"), ZONE)).toBe(
		false,
	);
});

test("the day is the local one, not the UTC one", () => {
	// 22:30 local on Thursday is already Friday in UTC.
	const thursdayNight = new Date("2026-10-16T01:30:00Z");
	expect(rollCallOpenable(FRIDAY, thursdayNight, ZONE)).toBe(false);
	// 00:30 local on Friday.
	const fridayDawn = new Date("2026-10-16T03:30:00Z");
	expect(rollCallOpenable(FRIDAY, fridayDawn, ZONE)).toBe(true);
});
