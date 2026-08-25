import { expect, test } from "@playwright/test";
import { hashPassword, verifyPassword } from "@/auth/password";

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
