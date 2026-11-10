import { expect, test } from "@playwright/test";
import {
	RETRY_BASE_MS,
	RETRY_CAP_MS,
	retryDelay,
} from "@/components/exam/save-retry";

test("the delay doubles with each failure and stops at the cap", () => {
	const full = () => 1;
	expect(retryDelay(1, full)).toBe(RETRY_BASE_MS);
	expect(retryDelay(2, full)).toBe(RETRY_BASE_MS * 2);
	expect(retryDelay(3, full)).toBe(RETRY_BASE_MS * 4);
	expect(retryDelay(50, full)).toBe(RETRY_CAP_MS);
});

test("jitter takes between half and all of the delay", () => {
	expect(retryDelay(1, () => 0)).toBe(RETRY_BASE_MS / 2);
	expect(retryDelay(1, () => 0.5)).toBe(RETRY_BASE_MS * 0.75);
	expect(retryDelay(50, () => 0)).toBe(RETRY_CAP_MS / 2);
});
