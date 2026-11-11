import { FULL_ACCESS } from "@/auth/actor";
import { SESSION_COOKIE } from "@/core/constants";
import { db } from "@/db";
import { persistedUserFactory, userFactory } from "@/fixtures/user.factory";
import { TEST_BASE_URL } from "./env";
import { expect, test } from "./fixtures";

// `POST /api/auth/login` is the CLI's way in, not the browser's — the web app
// uses the `auth.login` action and a session cookie. These stay API-level
// tests rather than user stories for that reason: no page exercises them.
// They came out of the deleted `auth-flow.spec.ts`.

test("cli-login issues a bearer token that authenticates API-key middleware", async ({
	request,
}) => {
	const user = userFactory.build({ role: "INSTRUCTOR" });
	await db.user.create(user, FULL_ACCESS);

	const login = await request.post("/api/auth/login", {
		data: { login: user.email, password: user.password },
	});
	expect(login.ok()).toBe(true);
	const { token } = await login.json();
	expect(typeof token).toBe("string");

	// "/" reads context.locals.user, which the api-key middleware populates from
	// the Authorization header when there's no session cookie.
	const authed = await request.get("/", {
		headers: { Authorization: `Bearer ${token}`, Cookie: "" },
	});
	expect(authed.status()).toBe(200);
});

test("cli-login accepts a username as well as an email", async ({
	request,
}) => {
	const user = userFactory.build({ role: "INSTRUCTOR" });
	await db.user.create(user, FULL_ACCESS);

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
	await db.user.create(user, FULL_ACCESS);

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
	await db.user.create(user, FULL_ACCESS);

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

test("a bearer token and session cookie are rejected before credential validation", async ({
	request,
}) => {
	const first = userFactory.build({ role: "STUDENT" });
	const second = userFactory.build({ role: "STUDENT" });
	await db.user.create(first, FULL_ACCESS);
	await db.user.create(second, FULL_ACCESS);

	const tokenOf = async (user: typeof first) => {
		const login = await request.post("/api/auth/login", {
			data: { login: user.username, password: user.password },
		});
		expect(login.ok()).toBe(true);
		return (await login.json()).token as string;
	};
	const firstToken = await tokenOf(first);
	// Logging in again leaves `second`'s session cookie on `request`.
	await tokenOf(second);

	const me = await request.get("/api/user/me", {
		headers: { Authorization: `Bearer ${firstToken}` },
	});
	expect(me.status()).toBe(400);
	expect((await me.json()).code).toBe("ambiguous-credentials");

	const bogus = await request.get("/api/user/me", {
		headers: { Authorization: "Bearer not-a-real-token" },
	});
	expect(bogus.status()).toBe(400);

	const cookieOnly = await request.get("/api/user/me");
	expect((await cookieOnly.json()).username).toBe(second.username);
});

async function bearerCredentials() {
	const user = await persistedUserFactory.create({
		role: "ADMIN",
		password: "correct-horse-battery-staple",
	});
	const key = await db.apiKey.create(
		{
			name: "auth-test",
			kind: "CLI",
			createdBy: { username: user.username, name: user.name },
		},
		{ actor: user },
	);
	return {
		user,
		headers: { Authorization: `Bearer ${key.token}`, Cookie: "" },
	};
}

test("REST and RPC reject conflicting credentials before validation, even invalid or empty cookies", async ({
	request,
}) => {
	const { headers } = await bearerCredentials();
	for (const token of [headers.Authorization, "bearer invalid", "Bearer"]) {
		for (const cookie of [`${SESSION_COOKIE}=invalid`, `${SESSION_COOKIE}=`]) {
			const response = await request.post("/rpc", {
				headers: { Authorization: token, Cookie: cookie },
				data: { invalid: true },
			});
			expect(response.status()).toBe(400);
			expect((await response.json()).code).toBe("ambiguous-credentials");
			expect(response.headers()["set-cookie"]).toBeUndefined();
			const rest = await request.get("/api/user/me", {
				headers: { Authorization: token, Cookie: cookie },
			});
			expect(rest.status()).toBe(400);
		}
	}
	const unrelated = await request.get("/api/user/me", {
		headers: { ...headers, Cookie: "theme=dark" },
	});
	expect(unrelated.status()).toBe(200);
});

test("REST and RPC share session and origin protection, and allow isolated Bearer", async ({
	playwright,
}) => {
	const request = await playwright.request.newContext({
		baseURL: TEST_BASE_URL,
		extraHTTPHeaders: {},
	});
	const { user, headers } = await bearerCredentials();
	const login = await request.post("/api/auth/login", {
		data: { login: user.username, password: "correct-horse-battery-staple" },
	});
	expect(login.status()).toBe(200);
	const sameUserConflict = await request.get("/api/user/me", {
		headers: { Authorization: headers.Authorization },
	});
	expect(sameUserConflict.status()).toBe(400);
	const cookieOnly = await request.get("/api/user/me");
	expect((await cookieOnly.json()).username).toBe(user.username);
	for (const path of ["/api/user/me/change-password", "/rpc"]) {
		const foreign = await request.post(path, {
			headers: { Origin: "https://evil.example" },
			data: {},
		});
		expect(foreign.status()).toBe(403);
		const form = await request.post(path, {
			data: Buffer.from("{}"),
			headers: { "content-type": "text/plain" },
		});
		expect(form.status(), `${path}: ${await form.text()}`).toBe(403);
	}
	for (const path of ["/rpc/", "/%72pc"]) {
		const response = await request.post(path, {
			headers: { Origin: "https://evil.example" },
			data: { jsonrpc: "2.0", id: 1, method: "health.check" },
		});
		expect([403, 404]).toContain(response.status());
	}
	const bearer = await request.get("/api/user/me", {
		headers: { ...headers, Origin: "https://evil.example" },
	});
	expect((await bearer.json()).username).toBe(user.username);
	await request.dispose();
});
