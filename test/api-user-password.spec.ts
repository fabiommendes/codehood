import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { verifyPassword } from "@/auth/password";
import { db } from "@/db";
import { userFactory } from "@/fixtures/user.factory";

// `PATCH /api/user/me` used to accept `password` straight out of `userUpdate`,
// so any momentarily captured session or leaked API key could reset it without
// knowing the current one and keep the account for good.

const NEW_PASSWORD = "correct horse battery staple";

/// Seeds a user and returns them alongside a Bearer token for the REST API.
async function seedAndLogin(
	request: import("@playwright/test").APIRequestContext,
) {
	const user = userFactory.build({ role: "STUDENT" });
	await db.user.create(user, FULL_ACCESS);

	const login = await request.post("/api/auth/login", {
		data: { login: user.username, password: user.password },
	});
	expect(login.ok()).toBe(true);
	const { token } = await login.json();
	return { user, token };
}

async function storedHash(username: string): Promise<string> {
	const row = await db.user.findOne({ username }, FULL_ACCESS);
	// biome-ignore lint/style/noNonNullAssertion: the test just created them
	return row!.passwordHash;
}

test("PATCH /api/user/me cannot reset the password", async ({ request }) => {
	const { user, token } = await seedAndLogin(request);
	const before = await storedHash(user.username);

	const patch = await request.patch("/api/user/me", {
		headers: { Authorization: `Bearer ${token}` },
		data: { password: "hijacked-by-a-stolen-key" },
	});

	// `userUpdate` is `.strict()`, so an unknown field is refused outright
	// rather than quietly dropped.
	expect(patch.status()).toBe(400);
	expect(await storedHash(user.username)).toBe(before);
	expect(await verifyPassword(before, user.password)).toBe(true);
});

test("PATCH /api/user/me still edits the profile fields it owns", async ({
	request,
}) => {
	const { token } = await seedAndLogin(request);

	const patch = await request.patch("/api/user/me", {
		headers: { Authorization: `Bearer ${token}` },
		data: { name: "Renamed Person" },
	});

	expect(patch.status()).toBe(200);
	expect((await patch.json()).name).toBe("Renamed Person");
});

test("POST /api/user/me/change-password swaps the password and revokes every session", async ({
	request,
}) => {
	const { user, token } = await seedAndLogin(request);
	const elsewhere = await db.session.create(
		{ username: user.username },
		FULL_ACCESS,
	);

	const changed = await request.post("/api/user/me/change-password", {
		headers: { Authorization: `Bearer ${token}` },
		data: { currentPassword: user.password, newPassword: NEW_PASSWORD },
	});
	expect(changed.status()).toBe(200);
	expect(await changed.json()).toEqual({ success: true });

	const hash = await storedHash(user.username);
	expect(await verifyPassword(hash, NEW_PASSWORD)).toBe(true);
	expect(await verifyPassword(hash, user.password)).toBe(false);

	// A session held on another device is gone, which is what makes the change
	// useful after a laptop is left open.
	expect(await db.session.validate(elsewhere.token)).toBeNull();

	const oldPassword = await request.post("/api/auth/login", {
		data: { login: user.username, password: user.password },
	});
	expect(oldPassword.status()).toBe(401);

	const newPassword = await request.post("/api/auth/login", {
		data: { login: user.username, password: NEW_PASSWORD },
	});
	expect(newPassword.ok()).toBe(true);
});

test("POST /api/user/me/change-password refuses a wrong current password", async ({
	request,
}) => {
	const { user, token } = await seedAndLogin(request);
	const before = await storedHash(user.username);

	const refused = await request.post("/api/user/me/change-password", {
		headers: { Authorization: `Bearer ${token}` },
		data: { currentPassword: "not-the-password", newPassword: NEW_PASSWORD },
	});

	expect(refused.status()).toBe(401);
	expect(await storedHash(user.username)).toBe(before);
});

test("POST /api/user/me/change-password refuses a weak new password", async ({
	request,
}) => {
	const { user, token } = await seedAndLogin(request);
	const before = await storedHash(user.username);

	const refused = await request.post("/api/user/me/change-password", {
		headers: { Authorization: `Bearer ${token}` },
		data: { currentPassword: user.password, newPassword: "12345678" },
	});

	expect(refused.ok()).toBe(false);
	expect(await storedHash(user.username)).toBe(before);
});
