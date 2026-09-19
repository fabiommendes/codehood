import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { userFactory } from "@/fixtures/user.factory";
import { buildOpenRpcDocument } from "@/rpc/registry/openrpc-document";

/** Issues a bearer token the way the CLI does. */
async function login(request: {
	post: (
		url: string,
		options: { data: unknown },
	) => Promise<{
		json: () => Promise<{ token: string }>;
	}>;
}) {
	const user = userFactory.build({ role: "INSTRUCTOR" });
	await db.user.create(user, FULL_ACCESS);
	const res = await request.post("/api/auth/login", {
		data: { login: user.username, password: user.password },
	});
	return { user, token: (await res.json()).token };
}

test("health.check answers with no credentials", async ({ request }) => {
	const res = await request.post("/rpc", {
		data: { jsonrpc: "2.0", method: "health.check", params: {}, id: 1 },
	});
	expect(res.status()).toBe(200);
	expect(await res.json()).toEqual({
		jsonrpc: "2.0",
		id: 1,
		result: { status: "ok", database: "ok" },
	});
});

test("an unknown method is -32601 inside a 200", async ({ request }) => {
	const res = await request.post("/rpc", {
		data: { jsonrpc: "2.0", method: "nope.gone", id: "x" },
	});
	expect(res.status()).toBe(200);
	const body = await res.json();
	expect(body.id).toBe("x");
	expect(body.error.code).toBe(-32601);
	expect(body.result).toBeUndefined();
});

test("a non-public method without credentials is -32001", async ({
	request,
}) => {
	const res = await request.post("/rpc", {
		data: { jsonrpc: "2.0", method: "debug.whoami", id: 1 },
	});
	expect(res.status()).toBe(200);
	expect((await res.json()).error.code).toBe(-32001);
});

test("a non-public method with a bearer token reaches its handler", async ({
	request,
}) => {
	const { user, token } = await login(request);

	const res = await request.post("/rpc", {
		data: { jsonrpc: "2.0", method: "debug.whoami", id: 1 },
		headers: { Authorization: `Bearer ${token}` },
	});
	expect((await res.json()).result).toEqual({
		username: user.username,
		name: user.name,
		role: "INSTRUCTOR",
	});
});

test("bad params are -32602 carrying the field errors", async ({ request }) => {
	// `params` as an array is the one input every method rejects, whatever its
	// schema: there is no argument order to map it onto.
	const res = await request.post("/rpc", {
		data: { jsonrpc: "2.0", method: "health.check", params: [1, 2], id: 1 },
	});
	const body = await res.json();
	expect(body.error.code).toBe(-32602);
	expect(body.error.data.errors.$[0].message).toContain("Positional");
});

test("a batch returns one response per request, matched by id", async ({
	request,
}) => {
	const res = await request.post("/rpc", {
		data: [
			{ jsonrpc: "2.0", method: "health.check", id: "a" },
			{ jsonrpc: "2.0", method: "nope.gone", id: "b" },
		],
	});
	const body = await res.json();
	expect(body).toHaveLength(2);
	expect(body[0]).toEqual({
		jsonrpc: "2.0",
		id: "a",
		result: { status: "ok", database: "ok" },
	});
	expect(body[1].id).toBe("b");
	expect(body[1].error.code).toBe(-32601);
});

test("a notification runs and answers 204 with no body", async ({
	request,
}) => {
	const res = await request.post("/rpc", {
		data: { jsonrpc: "2.0", method: "health.check" },
	});
	expect(res.status()).toBe(204);
	expect(await res.text()).toBe("");
});

test("unparseable JSON is -32700 with HTTP 400", async ({ request }) => {
	// A Buffer, not a string: Playwright re-encodes a string body as JSON,
	// which would make this request perfectly valid JSON.
	const res = await request.post("/rpc", {
		data: Buffer.from("{ not json"),
		headers: { "content-type": "application/json" },
	});
	expect(res.status()).toBe(400);
	expect((await res.json()).error.code).toBe(-32700);
});

test("a request that is not a JSON-RPC object is -32600", async ({
	request,
}) => {
	const res = await request.post("/rpc", { data: { method: "health.check" } });
	expect(res.status()).toBe(200);
	expect((await res.json()).error.code).toBe(-32600);
});

test("GET /rpc is 405, not a 404 suggesting the endpoint is missing", async ({
	request,
}) => {
	const res = await request.get("/rpc");
	expect(res.status()).toBe(405);
	expect(res.headers().allow).toBe("POST");
});

test("GET /openrpc.json matches the registrations and lists health.check", async ({
	request,
}) => {
	const res = await request.get("/openrpc.json");
	expect(res.ok()).toBe(true);
	const document = await res.json();
	expect(document).toEqual(JSON.parse(JSON.stringify(buildOpenRpcDocument())));

	const health = document.methods.find(
		(method: { name: string }) => method.name === "health.check",
	);
	expect(health.paramStructure).toBe("by-name");
	expect(health["x-authentication"]).toBe("none");
	expect(
		document.methods.find(
			(method: { name: string }) => method.name === "debug.whoami",
		)["x-authentication"],
	).toBe("required");
});

test("GET /rpc/docs renders Swagger UI over the projected document", async ({
	request,
}) => {
	const page = await request.get("/rpc/docs");
	expect(page.ok()).toBe(true);
	expect(await page.text()).toContain('url: "/rpc/docs/openapi.json"');

	const document = await (await request.get("/rpc/docs/openapi.json")).json();

	// We verify a few paths, but this list can expand
	const keys = Object.keys(document.paths);
	expect(keys).toContain("/rpc#health.check");
	expect(keys).toContain("/rpc#debug.whoami");

	expect(document.paths["/rpc#health.check"].post.security).toEqual([]);
	expect(document.paths["/rpc#debug.whoami"].post.security).toBeUndefined();
});
