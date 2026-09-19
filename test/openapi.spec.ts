import { expect, test } from "@playwright/test";
import { buildOpenApiDocument } from "@/api/registry/openapi-document";

test("documents both REST endpoints, unauthenticated", () => {
	const document = buildOpenApiDocument();
	expect(document.paths?.["/api/health"]?.get?.security).toEqual([]);
	expect(document.paths?.["/api/auth/login"]?.post?.security).toEqual([]);
});

test("GET /openapi.json is generated on demand and matches the registrations", async ({
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

test("resources are documented only under their course, and never offer the course as a field", () => {
	const paths = buildOpenApiDocument().paths ?? {};
	const collection = paths["/api/course/{discipline}/{course}/resource"];
	const item = paths["/api/course/{discipline}/{course}/resource/{slug}"];

	expect(
		Object.keys(paths).filter((p) => p.startsWith("/api/resource")),
	).toEqual([]);
	expect(Object.keys(collection ?? {}).sort()).toEqual(["get", "post"]);
	expect(Object.keys(item ?? {}).sort()).toEqual([
		"delete",
		"get",
		"patch",
		"put",
	]);

	const queryNames = (collection?.get?.parameters ?? [])
		.map((p) => ("name" in p ? p.name : ""))
		.filter((name) => !["discipline", "course"].includes(name));
	expect(queryNames).not.toContain("courseId");
	expect(queryNames.some((name) => name.startsWith("courseRef"))).toBe(false);

	const bodyFields = (operation: NonNullable<typeof item>["put"]) => {
		const body = operation?.requestBody;
		const schema =
			body && "content" in body
				? body.content["application/json"]?.schema
				: undefined;
		return Object.keys(
			(schema && "properties" in schema ? schema.properties : undefined) ?? {},
		);
	};
	expect(bodyFields(collection?.post)).not.toContain("courseId");
	expect(bodyFields(collection?.post)).not.toContain("courseRef");
	expect(bodyFields(collection?.post)).toContain("slug");
	expect(bodyFields(item?.put)).toEqual(
		expect.not.arrayContaining(["courseId", "courseRef", "slug"]),
	);
	expect(bodyFields(item?.put)).toContain("title");
});
