import { expect, test } from "@playwright/test";
import { generateToken, hashToken } from "@/auth/token";

test("generateToken produces unique, URL-safe tokens", () => {
	const a = generateToken();
	const b = generateToken();
	expect(a).not.toBe(b);
	expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
});

test("hashToken is deterministic and does not return the raw token", () => {
	const token = generateToken();
	expect(hashToken(token)).toBe(hashToken(token));
	expect(hashToken(token)).not.toBe(token);
});
