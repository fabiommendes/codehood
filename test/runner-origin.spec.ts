import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { userFactory } from "@/fixtures/user.factory";
import { resolveRunnerOrigin } from "@/runner/server/config";
import { APP_CSP, requestSide } from "@/runner/server/routing";
import { TEST_BASE_URL, TEST_RUNNER_ORIGIN } from "./env";

/// Evaluates `expression` over `src/core/constants.ts` in a fresh Node process.
function constantsIn(env: Record<string, string>, expression: string): string {
	return execFileSync(
		"node_modules/.bin/tsx",
		[
			"-e",
			`import("@/core/constants").then((m) => console.log(JSON.stringify(${expression})));`,
		],
		{ env: { ...process.env, ...env }, encoding: "utf8" },
	).trim();
}

test.describe("resolveRunnerOrigin", () => {
	test("dev derives the other loopback name from the app URL", () => {
		expect(resolveRunnerOrigin(undefined, "http://localhost:4321", "dev")).toBe(
			"http://127.0.0.1:4321",
		);
		expect(resolveRunnerOrigin(undefined, "http://127.0.0.1:4321", "dev")).toBe(
			"http://localhost:4321",
		);
	});

	test("production without a value turns code execution off", () => {
		expect(
			resolveRunnerOrigin(undefined, "https://codehood.example", "prod"),
		).toBeNull();
		expect(
			resolveRunnerOrigin("  ", "https://codehood.example", "prod"),
		).toBeNull();
	});

	test("an explicit value wins and is reduced to its origin", () => {
		expect(
			resolveRunnerOrigin(
				"https://runner.example.net/ignored",
				"https://codehood.example",
				"prod",
			),
		).toBe("https://runner.example.net");
		expect(
			resolveRunnerOrigin(
				"http://runner.test:9000",
				"http://localhost:4321",
				"dev",
			),
		).toBe("http://runner.test:9000");
	});

	test("rejects the app origin, http in production and invalid values", () => {
		expect(() =>
			resolveRunnerOrigin(
				"http://localhost:4321",
				"http://localhost:4321",
				"dev",
			),
		).toThrow(/differ/);
		expect(() =>
			resolveRunnerOrigin(
				"http://runner.example.net",
				"https://codehood.example",
				"prod",
			),
		).toThrow(/https/);
		expect(() =>
			resolveRunnerOrigin("not a url", "http://localhost:4321", "dev"),
		).toThrow(/RUNNER_ORIGIN/);
		expect(() =>
			resolveRunnerOrigin("ftp://runner.test", "http://localhost:4321", "dev"),
		).toThrow(/http/);
	});

	test("a non-loopback dev app without a value has no runner", () => {
		expect(
			resolveRunnerOrigin(undefined, "http://codehood.test", "dev"),
		).toBeNull();
	});
});

test.describe("requestSide", () => {
	const runner = "http://127.0.0.1:4321";
	const side = (url: string, origin: string | null = runner) =>
		requestSide(new URL(url), origin);

	test("on the runner origin only /runner/ answers", () => {
		expect(side("http://127.0.0.1:4321/runner/frame")).toBe("runner");
		expect(side("http://127.0.0.1:4321/login")).toBe("not-found");
		expect(side("http://127.0.0.1:4321/api/courses")).toBe("not-found");
		expect(side("http://127.0.0.1:4321/")).toBe("not-found");
	});

	test("on the app origin /runner/ is not found", () => {
		expect(side("http://localhost:4321/runner/frame")).toBe("not-found");
		expect(side("http://localhost:4321/login")).toBe("app");
	});

	test("with no runner origin /runner/ is not found everywhere", () => {
		expect(side("http://127.0.0.1:4321/runner/frame", null)).toBe("not-found");
		expect(side("http://localhost:4321/runner/frame", null)).toBe("not-found");
		expect(side("http://localhost:4321/login", null)).toBe("app");
	});
});

test("SESSION_COOKIE carries the __Host- prefix exactly in production", () => {
	expect(constantsIn({ ENVIRONMENT: "prod" }, "m.SESSION_COOKIE")).toBe(
		JSON.stringify("__Host-session"),
	);
	expect(constantsIn({ ENVIRONMENT: "dev" }, "m.SESSION_COOKIE")).toBe(
		JSON.stringify("session"),
	);
});

test("RUNNER_ORIGIN is null in production unless configured", () => {
	const prod = { ENVIRONMENT: "prod", PUBLIC_URL: "https://codehood.example" };
	expect(constantsIn({ ...prod, RUNNER_ORIGIN: "" }, "m.RUNNER_ORIGIN")).toBe(
		"null",
	);
	expect(
		constantsIn(
			{ ...prod, RUNNER_ORIGIN: "https://runner.example.net" },
			"m.RUNNER_ORIGIN",
		),
	).toBe(JSON.stringify("https://runner.example.net"));
});

test.describe("server", () => {
	test("the app and the runner are different sites", () => {
		expect(new URL(TEST_BASE_URL).hostname).toBe("localhost");
		expect(new URL(TEST_RUNNER_ORIGIN).hostname).toBe("127.0.0.1");
	});

	test("the session cookie is stored for the app host only", async ({
		playwright,
	}) => {
		const user = userFactory.build({ role: "STUDENT" });
		await db.user.create(user, FULL_ACCESS);
		const app = await playwright.request.newContext({ baseURL: TEST_BASE_URL });
		const res = await app.post("/api/auth/login", {
			data: { login: user.username, password: user.password },
		});
		expect(res.status()).toBe(200);
		const { cookies } = await app.storageState();
		expect(cookies.map((c) => c.name)).toContain("session");
		expect(cookies.every((c) => c.domain === "localhost")).toBe(true);

		const onRunner = await app.get(`${TEST_RUNNER_ORIGIN}/login`);
		expect(onRunner.status()).toBe(404);
		await app.dispose();
	});

	test("the runner origin answers 404 outside /runner/", async ({
		request,
	}) => {
		for (const path of ["/login", "/", "/api/courses", "/api/auth/login"]) {
			const res = await request.get(`${TEST_RUNNER_ORIGIN}${path}`);
			expect(res.status(), path).toBe(404);
		}
	});

	test("the app origin answers 404 on /runner/", async ({ request }) => {
		const res = await request.get(`${TEST_BASE_URL}/runner/frame`);
		expect(res.status()).toBe(404);
	});

	test("app responses forbid framing by other sites", async ({ request }) => {
		for (const path of ["/login", "/api/courses"]) {
			const res = await request.get(`${TEST_BASE_URL}${path}`);
			expect(res.headers()["content-security-policy"], path).toBe(APP_CSP);
		}
	});

	// Records today's behaviour, not a goal: `public/` and `/_astro/` are
	// answered before the middleware, on any host. In production the reverse
	// proxy restricts the runner host to `/runner/` (see README, "Deploying").
	// If these ever answer 404, change this test together with the README.
	test("public/ and /_astro/ files answer on the runner origin", async ({
		request,
	}) => {
		const favicon = await request.get(`${TEST_RUNNER_ORIGIN}/favicon.svg`);
		expect(favicon.status()).toBe(200);

		const page = await (await request.get(`${TEST_BASE_URL}/login`)).text();
		const asset = page.match(/\/_astro\/[^"')\s]+\.(?:css|js)/)?.[0];
		expect(asset, "login page references an /_astro/ file").toBeTruthy();
		const res = await request.get(`${TEST_RUNNER_ORIGIN}${asset}`);
		expect(res.status()).toBe(200);
	});
});
