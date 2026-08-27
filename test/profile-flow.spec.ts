import { type APIRequestContext, expect, test } from "@playwright/test";

async function loginAsDevAdmin(request: APIRequestContext) {
	const login = await request.post("/_actions/auth.login", {
		form: { login: "admin@codehood.local", password: "admin" },
	});
	expect(login.ok()).toBe(true);
}

/**
 * Creates a brand-new, isolated user via the invite flow and leaves `request`
 * logged in as them — so password/session/API-key mutations in a test never
 * touch the shared seeded admin other spec files also log in as.
 */
async function createAndLoginFreshUser(
	request: APIRequestContext,
	slug: string,
) {
	await loginAsDevAdmin(request);

	const email = `${slug}@codehood.test`;
	const invite = await request.post("/_actions/auth.createPersonalInvite", {
		data: { email, role: "STUDENT" },
	});
	expect(invite.ok()).toBe(true);
	const [, token] = await invite.json();

	const accept = await request.post("/_actions/auth.acceptInvite", {
		form: {
			token,
			email,
			username: slug,
			name: slug,
			password: "correcthorse",
			githubId: slug,
			schoolId: slug,
		},
	});
	expect(accept.ok()).toBe(true);

	return { email, username: slug, password: "correcthorse" };
}

test("updates profile fields", async ({ request }) => {
	const user = await createAndLoginFreshUser(request, "profile-update");

	const update = await request.post("/_actions/profile.update", {
		form: {
			name: "Updated Name",
			email: user.email,
			githubId: user.username,
			schoolId: user.username,
		},
	});
	expect(update.ok()).toBe(true);

	const page = await request.get("/profile");
	expect(await page.text()).toContain("Updated Name");
});

test("username field on /profile is not editable", async ({ request }) => {
	const user = await createAndLoginFreshUser(request, "profile-username-lock");

	const update = await request.post("/_actions/profile.update", {
		form: {
			name: user.username,
			email: user.email,
			username: "renamed",
			githubId: user.username,
			schoolId: user.username,
		},
	});
	expect(update.ok()).toBe(true);

	const page = await request.get("/profile");
	const html = await page.text();
	expect(html).toContain(`value="${user.username}"`);
	expect(html).not.toContain("renamed");
});

test("rejects a profile update that collides with another user's email", async ({
	request,
}) => {
	await loginAsDevAdmin(request);
	const invite = await request.post("/_actions/auth.createPersonalInvite", {
		data: { email: "collision-target@codehood.test", role: "STUDENT" },
	});
	const [, token] = await invite.json();
	await request.post("/_actions/auth.acceptInvite", {
		form: {
			token,
			email: "collision-target@codehood.test",
			username: "collision-target",
			name: "Collision Target",
			password: "correcthorse",
			githubId: "collision-target",
			schoolId: "collision-target",
		},
	});

	const user = await createAndLoginFreshUser(request, "profile-collision");

	const update = await request.post("/_actions/profile.update", {
		form: {
			name: "Whatever",
			email: "collision-target@codehood.test",
			githubId: user.username,
			schoolId: user.username,
		},
	});
	expect(update.status()).toBe(400);
	const body = await update.json();
	expect(body.message).toContain("email");
});

test("changes password and rejects a wrong current password", async ({
	request,
}) => {
	const user = await createAndLoginFreshUser(request, "profile-password");

	const wrongCurrent = await request.post("/_actions/profile.changePassword", {
		form: {
			currentPassword: "not-the-password",
			newPassword: "brand-new-password",
		},
	});
	expect(wrongCurrent.status()).toBe(401);

	const changed = await request.post("/_actions/profile.changePassword", {
		form: { currentPassword: user.password, newPassword: "brand-new-password" },
	});
	expect(changed.ok()).toBe(true);

	const oldPasswordLogin = await request.post("/_actions/auth.login", {
		form: { login: user.username, password: user.password },
	});
	expect(oldPasswordLogin.status()).toBe(401);

	const newPasswordLogin = await request.post("/_actions/auth.login", {
		form: { login: user.username, password: "brand-new-password" },
	});
	expect(newPasswordLogin.ok()).toBe(true);
});

test("logs out everywhere and invalidates the session", async ({ request }) => {
	await createAndLoginFreshUser(request, "profile-logout");

	const beforeLogout = await request.get("/profile");
	expect(beforeLogout.status()).toBe(200);

	const logout = await request.post("/_actions/profile.logoutEverywhere", {
		form: {},
	});
	expect(logout.ok()).toBe(true);

	const afterLogout = await request.get("/profile", { maxRedirects: 0 });
	expect(afterLogout.status()).toBe(302);
});

test("creates, lists, and revokes an API key from the profile page", async ({
	request,
}) => {
	await createAndLoginFreshUser(request, "profile-apikey");

	const create = await request.post("/_actions/auth.createApiKey", {
		form: { name: "test key", kind: "CLI" },
	});
	expect(create.ok()).toBe(true);
	const [, token] = await create.json();
	expect(typeof token).toBe("string");

	const profilePage = await request.get("/profile");
	const html = await profilePage.text();
	expect(html).toContain("test key");

	const idMatch = html.match(/name="id" value="(\d+)"/);
	expect(idMatch).not.toBeNull();
	const keyId = idMatch?.[1];

	const revoke = await request.post("/_actions/auth.revokeApiKey", {
		form: { id: keyId ?? "" },
	});
	expect(revoke.ok()).toBe(true);

	const afterRevoke = await request.get("/profile");
	expect(await afterRevoke.text()).not.toContain("test key");
});
