import { expect, test } from "@playwright/test";
import { hashPassword, passwordStrengthIssues, verifyPassword } from "@/auth/password";

// Regression: `common-passwords.json` is a plain JSON array. A namespace import
// (`import * as X from "./x.json"`) gives an object with numeric-string keys, not
// an actual array, so `buildCommonWordsSet`'s `for...of` threw "words is not
// iterable" — at module load time, breaking every import of this module.
test("flags a word from the common-passwords list", async () => {
	const issues = await passwordStrengthIssues("12345678");
	expect(issues?.map((issue) => issue.code)).toContain("too-common");
});

test("hashes and verifies a password", async () => {
	const hash = await hashPassword("correct horse battery staple");
	expect(hash).not.toBe("correct horse battery staple");
	expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
	expect(await verifyPassword(hash, "wrong password")).toBe(false);
});

test("two hashes of the same password differ (random salt)", async () => {
	const a = await hashPassword("same-password");
	const b = await hashPassword("same-password");
	expect(a).not.toBe(b);
});
