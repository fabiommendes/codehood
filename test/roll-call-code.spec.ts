import { expect, test } from "@playwright/test";
import {
	CODE_ALPHABET,
	codeAt,
	generateSecret,
	isCodeValid,
} from "@/services/roll-call-code";

const SECRET = "test-secret";
const WINDOW_MS = 15_000;
const GRACE_MS = 30_000;
/** Start of a 15 s window: a multiple of 15000 ms. */
const T0 = new Date(1_800_000_000_000);

/** Returns the instant `ms` milliseconds after `T0`. */
function plus(ms: number): Date {
	return new Date(T0.getTime() + ms);
}

test("T2-01 codes are six characters from the unambiguous alphabet", () => {
	const codes = Array.from(
		{ length: 500 },
		(_, k) => codeAt(SECRET, plus(k * WINDOW_MS)).code,
	);
	for (const code of codes) {
		expect(code).toMatch(/^[A-Z2-9]{6}$/);
		for (const ch of code) {
			expect(CODE_ALPHABET).toContain(ch);
		}
	}
	for (const ch of "0OI1L") {
		expect(CODE_ALPHABET).not.toContain(ch);
	}
});

test("T2-02 codes of the wrong length or with 0 or I are refused", () => {
	expect(isCodeValid(SECRET, "ABCDE", T0)).toBe(false);
	expect(isCodeValid(SECRET, "ABCDEFG", T0)).toBe(false);
	expect(isCodeValid(SECRET, "ABCD0F", T0)).toBe(false);
	expect(isCodeValid(SECRET, "ABCDIF", T0)).toBe(false);
});

test("T2-03 a valid code is accepted in lower case with spaces around it", () => {
	const { code } = codeAt(SECRET, T0);
	expect(isCodeValid(SECRET, ` ${code.toLowerCase()} `, T0)).toBe(true);
});

test("T2-04 the code holds for 15 s and then changes", () => {
	const before = codeAt(SECRET, T0).code;
	expect(codeAt(SECRET, plus(WINDOW_MS - 1)).code).toBe(before);
	expect(codeAt(SECRET, plus(WINDOW_MS)).code).not.toBe(before);
});

test("T2-05 changedAt and nextChangeAt are the start and end of the current window", () => {
	const { changedAt, nextChangeAt } = codeAt(SECRET, plus(7_000));
	expect(changedAt.getTime()).toBe(T0.getTime());
	expect(nextChangeAt.getTime()).toBe(plus(WINDOW_MS).getTime());
});

test("T2-06 different secrets give different codes over ten windows", () => {
	const differ = Array.from({ length: 10 }, (_, k) => {
		const at = plus(k * WINDOW_MS);
		return codeAt("a", at).code !== codeAt("b", at).code;
	}).some((d) => d);
	expect(differ).toBe(true);
});

test("T2-07 generateSecret returns a different secret on each call", () => {
	expect(generateSecret()).not.toBe(generateSecret());
});

test("T2-08 a code is accepted during its window and up to 30 s after it closes", () => {
	const { code } = codeAt(SECRET, T0);
	expect(isCodeValid(SECRET, code, T0)).toBe(true);
	expect(isCodeValid(SECRET, code, plus(WINDOW_MS + GRACE_MS - 1))).toBe(true);
});

test("T2-09 a code is refused from exactly 30 s after its window closes", () => {
	const { code } = codeAt(SECRET, T0);
	expect(isCodeValid(SECRET, code, plus(WINDOW_MS + GRACE_MS))).toBe(false);
	expect(isCodeValid(SECRET, code, plus(WINDOW_MS + GRACE_MS + 1_000))).toBe(
		false,
	);
});

test("T2-10 the next window's code is refused before its window starts", () => {
	const next = codeAt(SECRET, plus(WINDOW_MS)).code;
	expect(isCodeValid(SECRET, next, plus(WINDOW_MS - 1))).toBe(false);
});

test("T2-11 a code from one secret is refused under another secret", () => {
	const { code } = codeAt(SECRET, T0);
	expect(isCodeValid("other", code, T0)).toBe(false);
});
