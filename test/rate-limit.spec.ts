import { expect, test } from "@playwright/test";
import { createLimiter } from "@/utils/rate-limit";

const TEN_MINUTES = 10 * 60_000;
const START = new Date("2026-03-10T14:00:00.000Z");

/// Returns the instant `ms` milliseconds after `START`.
function at(ms: number): Date {
	return new Date(START.getTime() + ms);
}

/// A limiter with the settings of the roll call check-in: ten failures per ten minutes.
function checkInLimiter() {
	return createLimiter({ max: 10, windowMs: TEN_MINUTES });
}

test("T4-19 ten failures leave the key free and the eleventh blocks it", () => {
	const limiter = checkInLimiter();
	for (let i = 0; i < 10; i++) {
		limiter.fail("user:a", at(i));
	}
	expect(limiter.blocked("user:a", at(10))).toBe(false);
	limiter.fail("user:a", at(10));
	expect(limiter.blocked("user:a", at(11))).toBe(true);
});

test("T4-19 the block releases at the first failure plus the window", () => {
	const limiter = checkInLimiter();
	for (let i = 0; i < 11; i++) {
		limiter.fail("user:a", at(i));
	}
	expect(limiter.blocked("user:a", at(TEN_MINUTES - 1))).toBe(true);
	expect(limiter.blocked("user:a", at(TEN_MINUTES))).toBe(false);
});

test("T4-20 blocking one key does not block other keys", () => {
	const limiter = checkInLimiter();
	for (let i = 0; i < 11; i++) {
		limiter.fail("user:a", at(i));
	}
	expect(limiter.blocked("user:a", at(11))).toBe(true);
	expect(limiter.blocked("ip:x", at(11))).toBe(false);
	expect(limiter.blocked("user:b", at(11))).toBe(false);
});
