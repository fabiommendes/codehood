import { expect, test } from "@playwright/test";

test("login as dev admin, invite a student, accept the invite, and lose admin permissions", async ({
	request,
}) => {
	const login = await request.post("/_actions/auth.login", {
		form: { login: "admin@codehood.local", password: "admin" },
	});
	expect(login.ok()).toBe(true);

	const invite = await request.post("/_actions/auth.createPersonalInvite", {
		data: { email: "e2e-student@codehood.test", role: "STUDENT" },
	});
	expect(invite.ok()).toBe(true);
	const [, token] = await invite.json();

	const invitePage = await request.get(`/invite/${token}`);
	expect(invitePage.status()).toBe(200);
	expect(await invitePage.text()).toContain("You're accepting an invite");

	const accept = await request.post("/_actions/auth.acceptInvite", {
		form: {
			token,
			email: "e2e-student@codehood.test",
			username: "e2e-student",
			name: "E2E Student",
			password: "correcthorse",
			githubId: "e2e-student",
			schoolId: "E2E-1",
		},
	});
	expect(accept.ok()).toBe(true);

	// The client's cookie jar now holds the newly created student's session, not admin's.
	const forbidden = await request.post("/_actions/auth.createPersonalInvite", {
		data: { email: "x@codehood.test", role: "STUDENT" },
	});
	expect(forbidden.status()).toBe(403);
});

test("cli-login issues a bearer token that authenticates API-key middleware", async ({
	request,
}) => {
	const login = await request.post("/api/auth/login", {
		data: { login: "admin@codehood.local", password: "admin" },
	});
	expect(login.ok()).toBe(true);
	const { token } = await login.json();
	expect(typeof token).toBe("string");

	// "/" reads context.locals.user and redirects logged-in visitors to "/courses",
	// which the api-key middleware populates from the Authorization header when
	// there's no session cookie.
	const authed = await request.get("/", {
		headers: { Authorization: `Bearer ${token}` },
	});
	expect(authed.url()).toContain("/courses");
	expect(await authed.text()).toContain("My courses");
});

test("cli-login rejects a login that is neither a valid email nor a valid username with 400, and a missing password with 400", async ({
	request,
}) => {
	const badLogin = await request.post("/api/auth/login", {
		data: { login: "not a valid login!", password: "admin" },
	});
	expect(badLogin.status()).toBe(400);

	const noPassword = await request.post("/api/auth/login", {
		data: { login: "admin@codehood.local" },
	});
	expect(noPassword.status()).toBe(400);
});

test("cli-login accepts a username as well as an email", async ({
	request,
}) => {
	const login = await request.post("/api/auth/login", {
		data: { login: "admin", password: "admin" },
	});
	expect(login.ok()).toBe(true);
	const { token } = await login.json();
	expect(typeof token).toBe("string");
});

test("rejects invalid credentials", async ({ request }) => {
	const login = await request.post("/_actions/auth.login", {
		form: { login: "admin@codehood.local", password: "not-the-password" },
	});
	expect(login.status()).toBe(401);
});

test("logs in with a username as well as an email", async ({ request }) => {
	const login = await request.post("/_actions/auth.login", {
		form: { login: "admin", password: "admin" },
	});
	expect(login.ok()).toBe(true);
});

test("rejects JSON bodies now that the login action only accepts form data", async ({
	request,
}) => {
	const login = await request.post("/_actions/auth.login", {
		data: { login: "admin", password: "admin" },
	});
	expect(login.status()).toBe(415);
});
