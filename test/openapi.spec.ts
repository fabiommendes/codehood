import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { buildOpenApiDocument } from "@/api/registry/openapi-document";

const publicPath = path.resolve(import.meta.dirname, "../public/openapi.json");

test("public/openapi.json matches what the Zod schemas/route registrations currently generate", () => {
	const onDisk = JSON.parse(readFileSync(publicPath, "utf8"));
	expect(onDisk).toEqual(buildOpenApiDocument());
});

test("documents both REST endpoints, unauthenticated", () => {
	const document = buildOpenApiDocument();
	expect(document.paths?.["/api/health"]?.get?.security).toEqual([]);
	expect(document.paths?.["/api/auth/cli-login"]?.post?.security).toEqual([]);
});

test("GET /openapi.json is served statically and matches the generated document", async ({
	request,
}) => {
	const res = await request.get("/openapi.json");
	expect(res.ok()).toBe(true);
	expect(await res.json()).toEqual(buildOpenApiDocument());
});

test("GET /api/docs renders the Swagger UI page pointed at /openapi.json", async ({
	request,
}) => {
	const res = await request.get("/api/docs");
	expect(res.ok()).toBe(true);
	const html = await res.text();
	expect(html).toContain('url: "/openapi.json"');
});

test("GET /api/docs/vendor/swagger-ui.css serves the allowlisted asset", async ({
	request,
}) => {
	const res = await request.get("/api/docs/vendor/swagger-ui.css");
	expect(res.ok()).toBe(true);
	expect(res.headers()["content-type"]).toContain("text/css");
});

test("GET /api/docs/vendor/<anything not allowlisted> is a 404, not a path traversal", async ({
	request,
}) => {
	const randomFile = await request.get("/api/docs/vendor/package.json");
	expect(randomFile.status()).toBe(404);

	const traversal = await request.get(
		"/api/docs/vendor/..%2f..%2f..%2fpackage.json",
	);
	expect(traversal.status()).toBe(404);
});
