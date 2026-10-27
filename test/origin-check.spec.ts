import { type APIRequestContext, expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { TEST_BASE_URL } from "./env";

/// Form-like unsafe requests need the server's own Origin unless an API key
/// authenticates them; JSON requests are not subject to the rule.

const FOREIGN_ORIGIN = "https://evil.example";

/// One target of each kind: an Astro Action and a REST endpoint. Neither
/// needs the request to succeed; only whether the origin rule lets it through.
const TARGETS = [
	{ label: "an Astro Action", url: "/_actions/course.dropEnrollment" },
	{ label: "an API endpoint", url: "/api/auth/login" },
] as const;

const MULTIPART = {
	multipart: {
		field: { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("x") },
	},
};

/// A context with no cookies, so only the headers a test sets authenticate it.
async function freshContext(
	playwright: Parameters<Parameters<typeof test>[2]>[0]["playwright"],
	headers: Record<string, string> = {},
): Promise<APIRequestContext> {
	return playwright.request.newContext({
		baseURL: TEST_BASE_URL,
		extraHTTPHeaders: headers,
	});
}

const PASSWORD = "correct-horse-battery-staple";

/// A user of this file only, so no other test can change its password.
async function makeUser(): Promise<string> {
	const username = `origin-${Math.random().toString(36).slice(2, 10)}`;
	await db.user.create(
		{
			email: `${username}@codehood.test`,
			username,
			name: username,
			role: "INSTRUCTOR",
			password: PASSWORD,
			githubId: username,
			schoolId: username,
		},
		FULL_ACCESS,
	);
	return username;
}

async function validBearer(
	playwright: Parameters<Parameters<typeof test>[2]>[0]["playwright"],
): Promise<string> {
	const context = await freshContext(playwright);
	const login = await context.post("/api/auth/login", {
		data: { login: await makeUser(), password: PASSWORD },
	});
	expect(login.ok()).toBe(true);
	const { token } = await login.json();
	await context.dispose();
	return `Bearer ${token}`;
}

for (const target of TARGETS) {
	test.describe(`multipart POST to ${target.label}`, () => {
		test("without Origin is forbidden", async ({ playwright }) => {
			const context = await freshContext(playwright);

			const response = await context.post(target.url, MULTIPART);

			expect(response.status()).toBe(403);
			await context.dispose();
		});

		test("with a foreign Origin is forbidden", async ({ playwright }) => {
			const context = await freshContext(playwright, {
				Origin: FOREIGN_ORIGIN,
			});

			const response = await context.post(target.url, MULTIPART);

			expect(response.status()).toBe(403);
			await context.dispose();
		});

		test("with the server's Origin is not forbidden", async ({
			playwright,
		}) => {
			const context = await freshContext(playwright, { Origin: TEST_BASE_URL });

			const response = await context.post(target.url, MULTIPART);

			expect(response.status()).not.toBe(403);
			await context.dispose();
		});

		test("with a valid bearer key and no Origin is not forbidden", async ({
			playwright,
		}) => {
			const context = await freshContext(playwright, {
				Authorization: await validBearer(playwright),
			});

			const response = await context.post(target.url, MULTIPART);

			expect(response.status()).not.toBe(403);
			await context.dispose();
		});

		test("with an invalid bearer key and no Origin is forbidden", async ({
			playwright,
		}) => {
			const context = await freshContext(playwright, {
				Authorization: "Bearer not-a-real-key",
			});

			const response = await context.post(target.url, MULTIPART);

			expect(response.status()).toBe(403);
			await context.dispose();
		});

		test("urlencoded without Origin is forbidden", async ({ playwright }) => {
			const context = await freshContext(playwright);

			const response = await context.post(target.url, { form: { a: "1" } });

			expect(response.status()).toBe(403);
			await context.dispose();
		});

		test("text/plain without Origin is forbidden", async ({ playwright }) => {
			const context = await freshContext(playwright);

			const response = await context.post(target.url, {
				headers: { "Content-Type": "text/plain" },
				data: "a=1",
			});

			expect(response.status()).toBe(403);
			await context.dispose();
		});

		test("JSON without Origin is not stopped by the origin rule", async ({
			playwright,
		}) => {
			const context = await freshContext(playwright);

			const response = await context.post(target.url, { data: {} });

			expect(response.status()).not.toBe(403);
			await context.dispose();
		});
	});
}
