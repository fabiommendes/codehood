import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/core/actor";
import { userService } from "@/db/services/user.service";
import { userFactory } from "@/fixtures/user.factory";

// `POST /api/auth/login` is the CLI's way in, not the browser's — the web app
// uses the `auth.login` action and a session cookie. These stay API-level
// tests rather than user stories for that reason: no page exercises them.
// They came out of the deleted `auth-flow.spec.ts`.

test("cli-login issues a bearer token that authenticates API-key middleware", async ({
	request,
}) => {
	const user = userFactory.build({ role: "INSTRUCTOR" });
	await userService.create(user, FULL_ACCESS);

	const login = await request.post("/api/auth/login", {
		data: { login: user.email, password: user.password },
	});
	expect(login.ok()).toBe(true);
	const { token } = await login.json();
	expect(typeof token).toBe("string");

	// "/" reads context.locals.user, which the api-key middleware populates from
	// the Authorization header when there's no session cookie.
	const authed = await request.get("/", {
		headers: { Authorization: `Bearer ${token}` },
	});
	expect(authed.status()).toBe(200);
});

test("cli-login accepts a username as well as an email", async ({
	request,
}) => {
	const user = userFactory.build({ role: "INSTRUCTOR" });
	await userService.create(user, FULL_ACCESS);

	const login = await request.post("/api/auth/login", {
		data: { login: user.username, password: user.password },
	});
	expect(login.ok()).toBe(true);
	expect(typeof (await login.json()).token).toBe("string");
});

test("cli-login rejects a malformed login and a missing password with 400", async ({
	request,
}) => {
	const badLogin = await request.post("/api/auth/login", {
		data: { login: "not a valid login!", password: "whatever" },
	});
	expect(badLogin.status()).toBe(400);

	const noPassword = await request.post("/api/auth/login", {
		data: { login: "someone@codehood.test" },
	});
	expect(noPassword.status()).toBe(400);
});

test("cli-login rejects bad credentials", async ({ request }) => {
	const user = userFactory.build({ role: "STUDENT" });
	await userService.create(user, FULL_ACCESS);

	const login = await request.post("/api/auth/login", {
		data: { login: user.username, password: "not-the-password" },
	});
	expect(login.ok()).toBe(false);
});

// Not a story either, and not about the CLI: the web action is form-only, and
// a JSON body must bounce rather than be coerced. There is no user behind it —
// it guards the `accept: "form"` on `auth.login` against a silent revert.
test("the web login action refuses a JSON body", async ({ request }) => {
	const user = userFactory.build({ role: "STUDENT" });
	await userService.create(user, FULL_ACCESS);

	const asJson = await request.post("/_actions/auth.login", {
		data: { login: user.username, password: user.password },
	});
	expect(asJson.status()).toBe(415);

	// The same credentials as a form are accepted, so 415 is about the encoding
	// and nothing else.
	const asForm = await request.post("/_actions/auth.login", {
		form: { login: user.username, password: user.password },
	});
	expect(asForm.ok()).toBe(true);
});
