import { expect, test } from "@playwright/test";
import { instant } from "@/core/schemas/base";

/// `instant` is what input schemas use for a point in time, whether it
/// arrives as a `Date` from server code or as a string from a JSON body.

test("instant reads an ISO string with an offset as the same instant", () => {
	expect(instant.parse("2026-08-01T13:00:00Z")).toEqual(
		new Date("2026-08-01T13:00:00Z"),
	);
	expect(instant.parse("2026-08-01T10:00:00.5-03:00")).toEqual(
		new Date("2026-08-01T13:00:00.500Z"),
	);
});

test("instant passes a Date through", () => {
	const date = new Date("2026-08-01T13:00:00Z");
	expect(instant.parse(date)).toBe(date);
});

test("instant refuses what z.coerce.date() would turn into some other date", () => {
	for (const value of [
		null,
		0,
		true,
		"",
		"2026-08-01",
		"2026-08-01T13:00:00",
		"August 1, 2026",
		new Date("invalid"),
	]) {
		expect(instant.safeParse(value).success, String(value)).toBe(false);
	}
});

test("instant.nullish() keeps null and undefined", () => {
	expect(instant.nullish().parse(null)).toBeNull();
	expect(instant.nullish().parse(undefined)).toBeUndefined();
});
