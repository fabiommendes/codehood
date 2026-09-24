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
	const document = buildOpenApiDocument();
	const paths = document.paths ?? {};
	const collection = paths["/api/course/{discipline}/{course}/resource"];
	const item = paths["/api/course/{discipline}/{course}/resource/{slug}"];

	expect(
		Object.keys(paths).filter((p) => p.startsWith("/api/resource")),
	).toEqual([]);
	expect(Object.keys(collection ?? {}).sort()).toEqual(["get", "post", "put"]);
	expect(Object.keys(item ?? {}).sort()).toEqual(["delete", "get", "patch"]);

	const queryNames = (collection?.get?.parameters ?? [])
		.map((p) => ("name" in p ? p.name : ""))
		.filter((name) => !["discipline", "course"].includes(name));
	expect(queryNames).not.toContain("courseId");
	expect(queryNames.some((name) => name.startsWith("courseRef"))).toBe(false);

	/// Resolves a `$ref` against the document's component schemas.
	const deref = (schema: unknown): Record<string, unknown> | undefined => {
		if (!schema || typeof schema !== "object") return undefined;
		const ref = (schema as { $ref?: string }).$ref;
		if (!ref) return schema as Record<string, unknown>;
		const name = ref.replace("#/components/schemas/", "");
		return document.components?.schemas?.[name] as
			| Record<string, unknown>
			| undefined;
	};

	const bodyFields = (operation: NonNullable<typeof item>["patch"]) => {
		const body = operation?.requestBody;
		const schema =
			body && "content" in body
				? body.content["application/json"]?.schema
				: undefined;
		const resolved = deref(schema);
		const properties = resolved?.properties as
			| Record<string, unknown>
			| undefined;
		expect(properties).toBeDefined();
		return Object.keys(properties ?? {});
	};
	expect(bodyFields(collection?.post)).not.toContain("courseId");
	expect(bodyFields(collection?.post)).not.toContain("courseRef");
	expect(bodyFields(collection?.post)).toContain("slug");
	expect(bodyFields(collection?.put)).toEqual(
		expect.not.arrayContaining(["courseId", "courseRef"]),
	);
	expect(bodyFields(collection?.put)).toContain("slug");
	expect(bodyFields(item?.patch)).toEqual(
		expect.not.arrayContaining(["courseId", "courseRef", "slug"]),
	);
	expect(bodyFields(item?.patch)).toContain("title");
});

test("time slots are documented only under their course, and the flat /api/time-slot path is gone", () => {
	const document = buildOpenApiDocument();
	const paths = document.paths ?? {};
	const collection = paths["/api/course/{discipline}/{course}/time-slot"];
	const item = paths["/api/course/{discipline}/{course}/time-slot/{slug}"];

	expect(
		Object.keys(paths).filter(
			(p) => p.startsWith("/api/time-slot") || p === "/api/time-slot",
		),
	).toEqual([]);
	expect(collection).toBeDefined();
	expect(item).toBeDefined();
	expect(Object.keys(collection ?? {}).sort()).toEqual(["get", "post", "put"]);
	expect(Object.keys(item ?? {}).sort()).toEqual(["delete", "get", "patch"]);

	const queryNames = (collection?.get?.parameters ?? [])
		.map((p) => ("name" in p ? p.name : ""))
		.filter((name) => !["discipline", "course"].includes(name));
	expect(queryNames).not.toContain("courseId");
});

// Every `/api/course/{discipline}/{course}/...` collection carries its course
// in the path, so its `GET` query string must never re-offer it as a field —
// see `dev/specs/to-review/course-ref-unification.md`. `feedback` is nested
// one level deeper, under the submission it grades.
const courseScopedCollections = [
	"/api/course/{discipline}/{course}/calendar-event",
	"/api/course/{discipline}/{course}/exam",
	"/api/course/{discipline}/{course}/resource",
	"/api/course/{discipline}/{course}/question",
	"/api/course/{discipline}/{course}/response",
	"/api/course/{discipline}/{course}/submission",
	"/api/course/{discipline}/{course}/time-slot",
	"/api/course/{discipline}/{course}/submission/{publicId}/feedback",
];

for (const path of courseScopedCollections) {
	test(`${path}: the list query string never re-offers the course as a field`, () => {
		const document = buildOpenApiDocument();
		const collection = document.paths?.[path];
		expect(collection?.get).toBeDefined();

		const queryNames = (collection?.get?.parameters ?? [])
			.map((p) => ("name" in p ? p.name : ""))
			.filter((name) => !["discipline", "course", "publicId"].includes(name));
		expect(queryNames).not.toContain("courseId");
		expect(queryNames).not.toContain("course");
		expect(queryNames.some((name) => name.startsWith("courseRef"))).toBe(false);
		expect(queryNames).not.toContain("discipline");
		expect(queryNames).not.toContain("instructor");
		expect(queryNames).not.toContain("edition");
	});
}
