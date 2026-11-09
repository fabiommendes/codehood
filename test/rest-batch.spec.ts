import { type APIRequestContext, expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { SESSION_COOKIE } from "@/core/constants";
import { InvalidData } from "@/core/error";
import { db } from "@/db";
import { persistedUserFactory } from "@/fixtures/user.factory";
import { readEnvelope } from "@/rpc/registry";
import { TEST_BASE_URL } from "./env";

async function credentials(role: "ADMIN" | "STUDENT" = "ADMIN") {
	const user = await persistedUserFactory.create({
		role,
		password: "correct-horse-battery-staple",
	});
	const key = await db.apiKey.create(
		{
			name: "batch-test",
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

async function batch(
	request: APIRequestContext,
	headers: Record<string, string>,
	verb: string,
	requests: unknown[],
) {
	const response = await request.post("/rpc", {
		headers,
		data: {
			jsonrpc: "2.0",
			id: "batch",
			method: "rest.batch",
			params: { verb, requests },
		},
	});
	expect(response.status()).toBe(200);
	return response.json();
}

test("rest.batch reuses REST output schemas, static paths and query coercion", async ({
	request,
}) => {
	const { user, headers } = await credentials();
	const direct = await request.get("/api/user/me", { headers });
	const response = await batch(request, headers, "GET", [
		{ id: "me", path: "/api/user/me" },
		{ id: 2, path: "/api/user", query: { usernames: [user.username] } },
	]);
	expect(response.result[0]).toEqual({
		id: "me",
		status: 200,
		body: await direct.json(),
	});
	expect(response.result[0].body.passwordHash).toBeUndefined();
	expect(response.result[0].body.id).toBeUndefined();
	expect(
		response.result[1].body.map((row: { username: string }) => row.username),
	).toEqual([user.username]);
});

test("rest.batch supports every registered verb and commits successes around failures in order", async ({
	request,
}) => {
	const { headers } = await credentials();
	const slug = `batch-${Math.random().toString(36).slice(2, 10)}`;
	const post = await batch(request, headers, "POST", [
		{ id: "created", path: "/api/discipline", body: { slug, name: "First" } },
		{ id: "invalid", path: "/api/discipline", body: {} },
		{
			id: "duplicate",
			path: "/api/discipline",
			body: { slug, name: "Duplicate" },
		},
		{
			id: "second",
			path: "/api/discipline",
			body: { slug: `${slug}-two`, name: "Second" },
		},
	]);
	expect(post.result.map((item: { status: number }) => item.status)).toEqual([
		200, 400, 500, 200,
	]);
	expect(JSON.stringify(post.result[2].body)).not.toContain(slug);
	const patch = await batch(request, headers, "PATCH", [
		{ id: 1, path: `/api/discipline/${slug}`, body: { name: "Patched" } },
		{ id: 2, path: `/api/discipline/${slug}`, body: { name: "Patched again" } },
	]);
	expect(
		patch.result.map((item: { body: { name: string } }) => item.body.name),
	).toEqual(["Patched", "Patched again"]);
	const put = await batch(request, headers, "PUT", [
		{ id: 1, path: "/api/discipline", body: { slug, name: "Upserted" } },
	]);
	expect(put.result[0].status).toBe(200);
	const read = await request.get(`/api/discipline/${slug}`, { headers });
	expect((await read.json()).name).toBe("Upserted");
	const deleted = await batch(request, headers, "DELETE", [
		{ id: 1, path: `/api/discipline/${slug}` },
	]);
	expect(deleted.result[0].status).toBe(200);
	expect(
		(await request.get(`/api/discipline/${slug}`, { headers })).status(),
	).toBe(404);
});

test("rest.batch preserves service authorization and continues after denied operations", async ({
	request,
}) => {
	const { headers } = await credentials("STUDENT");
	const direct = await request.post("/api/discipline", {
		headers,
		data: { slug: "not-allowed", name: "Denied" },
	});
	const response = await batch(request, headers, "POST", [
		{
			id: 1,
			path: "/api/discipline",
			body: { slug: "not-allowed", name: "Denied" },
		},
		{ id: 2, path: "/rpc", body: {} },
	]);
	expect(direct.status()).toBe(403);
	expect(
		response.result.map((item: { status: number }) => item.status),
	).toEqual([403, 400]);
	expect(
		await db.discipline.findOne({ slug: "not-allowed" }, FULL_ACCESS),
	).toBeNull();
});

test("rest.batch rejects external, ambiguous, auth, multipart and unregistered routes per item", async ({
	request,
}) => {
	const { headers } = await credentials();
	const paths = [
		"https://evil.example/api/user",
		"//evil.example/api/user",
		"/api/../rpc",
		"/api/%2e%2e/rpc",
		"/api/user%2fme",
		"/api/%2575ser",
		"/api//user",
		"/api/user?role=ADMIN",
		"/api/user#x",
		"/api/user\\me",
		"/api/auth/login",
		"/api/auth/logout",
		"/api/course/cs101/ada_2026-1/resource",
		"/api/report/unknown/attachment/file",
		"/rpc",
		"/_actions/exam.answer",
	];
	const response = await batch(
		request,
		headers,
		"POST",
		paths.map((path, id) => ({ id, path, body: {} })),
	);
	expect(response.result).toHaveLength(paths.length);
	for (const result of response.result)
		expect([400, 404, 405]).toContain(result.status);
});

test("rest.batch validates envelopes before execution and bounds each payload independently", async ({
	request,
}) => {
	const { headers } = await credentials();
	for (const verb of ["HEAD", "get"]) {
		const response = await batch(request, headers, verb, [
			{ id: 1, path: "/api/health" },
		]);
		expect(response.error.code).toBe(-32602);
	}
	for (const count of [0, 51]) {
		const response = await batch(
			request,
			headers,
			"GET",
			Array.from({ length: count }, (_, id) => ({ id, path: "/api/health" })),
		);
		expect(response.error.code).toBe(-32602);
	}
	const response = await batch(request, headers, "GET", [
		{ id: 1, path: "/api/health", query: { text: "é".repeat(32768) } },
		{ id: 2, path: "/api/health", body: {} },
		{ id: 3, path: "/api/health" },
	]);
	expect(
		response.result.map((item: { status: number }) => item.status),
	).toEqual([413, 400, 200]);
	const large = await request.post("/rpc", {
		data: Buffer.from(JSON.stringify({ text: "x".repeat(1024 * 1024) })),
		headers: { ...headers, "content-type": "application/json" },
	});
	expect(large.status()).toBe(413);
});

test("REST and RPC reject conflicting credentials before validation, even invalid or empty cookies", async ({
	request,
}) => {
	const { headers } = await credentials();
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
	const unrelated = await batch(
		request,
		{ ...headers, Cookie: "theme=dark" },
		"GET",
		[{ id: 1, path: "/api/user/me" }],
	);
	expect(unrelated.result[0].status).toBe(200);
});

test("REST and its bridge share session and origin protection, and allow isolated Bearer", async ({
	playwright,
}) => {
	const request = await playwright.request.newContext({
		baseURL: TEST_BASE_URL,
		extraHTTPHeaders: {},
	});
	const { user, headers } = await credentials();
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
	const session = await batch(request, { Origin: TEST_BASE_URL }, "GET", [
		{ id: 1, path: "/api/user/me" },
	]);
	expect(session.result[0].body.username).toBe(user.username);
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
	const bearer = await batch(
		request,
		{ ...headers, Origin: "https://evil.example" },
		"GET",
		[{ id: 1, path: "/api/user/me" }],
	);
	expect(bearer.result[0].body.username).toBe(user.username);
	await request.dispose();
});

test("rest.batch needs authentication and preserves sequential JSON-RPC batches and notifications", async ({
	request,
}) => {
	const unauthenticated = await batch(request, {}, "GET", [
		{ id: 1, path: "/api/health" },
	]);
	expect(unauthenticated.error.code).toBe(-32001);
	const { headers } = await credentials();
	const response = await request.post("/rpc", {
		headers,
		data: [
			{
				jsonrpc: "2.0",
				method: "rest.batch",
				params: {
					verb: "POST",
					requests: [
						{
							id: 1,
							path: "/api/discipline",
							body: { slug: "batch-outer-order", name: "Created first" },
						},
					],
				},
				id: "create",
			},
			{
				jsonrpc: "2.0",
				method: "rest.batch",
				params: {
					verb: "GET",
					requests: [{ id: 4, path: "/api/discipline/batch-outer-order" }],
				},
				id: "rest",
			},
			{ jsonrpc: "2.0", method: "health.check" },
		],
	});
	const body = await response.json();
	expect(body.map((item: { id: string }) => item.id)).toEqual([
		"create",
		"rest",
	]);
	expect(body[1].result[0].status).toBe(200);
	expect(body[1].result[0].body.name).toBe("Created first");
});

test("RPC envelope byte limit also applies to chunked bodies without Content-Length", async () => {
	const chunks = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(Buffer.from('{"padding":"'));
			controller.enqueue(Buffer.alloc(1024 * 1024, 120));
			controller.enqueue(Buffer.from('"}'));
			controller.close();
		},
	});
	const request = new Request("http://localhost/rpc", {
		method: "POST",
		body: chunks,
		duplex: "half",
	} as RequestInit);
	expect(request.headers.has("content-length")).toBe(false);
	await expect(readEnvelope(request)).rejects.toBeInstanceOf(InvalidData);
});
