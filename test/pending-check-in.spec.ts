import { expect, test } from "@playwright/test";
import type { RollCallId } from "@/core/schemas";
import { readClaim, signClaim } from "@/utils/pending-check-in";

const KEY = "test-signing-key";
const OTHER_KEY = "another-signing-key";
const CLAIMED_AT = new Date("2026-03-10T14:00:00.000Z");
const claim = { rollCallId: 42 as RollCallId, claimedAt: CLAIMED_AT };

/// Returns the instant `ms` milliseconds after `CLAIMED_AT`.
function after(ms: number): Date {
	return new Date(CLAIMED_AT.getTime() + ms);
}

test("T4-16 a claim reads back within ten minutes and not after", () => {
	const cookie = signClaim(claim, KEY);
	expect(readClaim(cookie, KEY, after(9 * 60_000 + 59_000))).toEqual(claim);
	expect(readClaim(cookie, KEY, after(10 * 60_000))).toBeNull();
});

test("T4-17 a tampered cookie reads as null", () => {
	const cookie = signClaim(claim, KEY);
	const middle = Math.floor(cookie.length / 2);
	const flipped = cookie[middle] === "A" ? "B" : "A";
	const tampered = cookie.slice(0, middle) + flipped + cookie.slice(middle + 1);
	expect(tampered).not.toBe(cookie);
	expect(readClaim(tampered, KEY, after(0))).toBeNull();
});

test("T4-17 a cookie signed with another key reads as null", () => {
	const cookie = signClaim(claim, OTHER_KEY);
	expect(readClaim(cookie, KEY, after(0))).toBeNull();
});
