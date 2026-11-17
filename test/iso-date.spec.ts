import { expect, test } from "@playwright/test";
import { isoDate } from "@/core/schemas/base";

test("isoDate accepts a valid calendar date", () => {
	expect(isoDate.parse("2026-02-28")).toBe("2026-02-28");
	expect(isoDate.parse("2028-02-29")).toBe("2028-02-29"); // leap year
});

test("isoDate refuses an impossible day", () => {
	expect(isoDate.safeParse("2026-02-30").success).toBe(false);
	expect(isoDate.safeParse("2026-02-29").success).toBe(false);
	expect(isoDate.safeParse("2026-13-01").success).toBe(false);
});

test("isoDate refuses an instant, a blank value and other formats", () => {
	for (const value of [
		"2026-08-01T13:00:00Z",
		"2026-08-01T00:00:00.000+00:00",
		"",
		null,
		"01/08/2026",
		"2026-8-1",
	]) {
		expect(isoDate.safeParse(value).success).toBe(false);
	}
});
