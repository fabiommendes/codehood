import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
	type APIRequestContext,
	expect,
	type PlaywrightWorkerArgs,
	test,
} from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db, type User } from "@/db";
import { repositoryTree } from "@/fixtures/repository.factory";
import { hashBytes } from "@/utils/content-hash";
import { TEST_BASE_URL, TEST_RESOURCE_ROOT } from "./env";

/// Repository routes over HTTP: the push flow, permissions, the zip download
/// and what the OpenAPI document leaves out.

function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

const PASSWORD = "correct-horse-battery-staple";

async function makeUser(role: "INSTRUCTOR" | "STUDENT"): Promise<User> {
	const username = tag(role.toLowerCase());
	return db.user.create(
		{
			email: `${username}@codehood.test`,
			username,
			name: username,
			role,
			password: PASSWORD,
			githubId: username,
			schoolId: username,
		},
		FULL_ACCESS,
	);
}

const contexts: APIRequestContext[] = [];

/// A request context of its own, so one user's session cookie never outranks
/// another's bearer key. Logs in when `bearer` is set; the cookie the login
/// leaves behind is what the zip route reads.
async function contextFor(
	playwright: PlaywrightWorkerArgs["playwright"],
	username: string | null,
	{ bearer }: { bearer: boolean },
): Promise<APIRequestContext> {
	const context = await playwright.request.newContext({
		baseURL: TEST_BASE_URL,
	});
	contexts.push(context);
	if (!username) return context;
	const login = await context.post("/api/auth/login", {
		data: { login: username, password: PASSWORD },
	});
	expect(login.ok()).toBe(true);
	if (!bearer) return context;
	const { token } = await login.json();
	const withBearer = await playwright.request.newContext({
		baseURL: TEST_BASE_URL,
		extraHTTPHeaders: { Authorization: `Bearer ${token}` },
	});
	contexts.push(withBearer);
	return withBearer;
}

async function makeCourse() {
	const instructor = await makeUser("INSTRUCTOR");
	const student = await makeUser("STUDENT");
	const outsider = await makeUser("STUDENT");
	const discipline = tag("disc");
	await db.discipline.create(
		{ slug: discipline, name: discipline },
		FULL_ACCESS,
	);
	if (!(await db.edition.findOne({ slug: "2026-1" }))) {
		await db.edition.create(
			{
				slug: "2026-1",
				name: "2026-1",
				startAt: new Date("2026-01-01"),
				endAt: new Date("2030-12-31"),
			},
			FULL_ACCESS,
		);
	}
	const course = await db.course.create(
		{
			discipline,
			instructor: instructor.username,
			edition: "2026-1",
			startAt: new Date("2026-01-05T12:00:00Z"),
			endAt: new Date("2026-05-01"),
		},
		FULL_ACCESS,
	);
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	const courseSegment = `${discipline}/${instructor.username}_2026-1`;
	return {
		instructor,
		student,
		outsider,
		course,
		api: `/api/course/${courseSegment}/repository`,
		page: `/${courseSegment}`,
	};
}

/// Seeds a committed repository through the service, not the API.
async function seedRepository(
	setup: Awaited<ReturnType<typeof makeCourse>>,
	slug: string,
	spec: Parameters<typeof repositoryTree>[0] = { "README.md": "# Seeded\n" },
) {
	const opts = { actor: setup.instructor };
	const pk = { course: setup.course.id, slug };
	await db.repository.upsert(pk, opts);
	const { files, tree } = repositoryTree(spec);
	await db.repository.addFiles(pk, files, opts);
	return db.repository.commit(pk, { tree, message: "seed" }, opts);
}

test.afterAll(async () => {
	await Promise.all(contexts.map((context) => context.dispose()));
});

const SHA1 = /^[0-9a-f]{40}$/;

function multipartOf(files: Record<string, Buffer>) {
	return Object.fromEntries(
		Object.entries(files).map(([name, buffer]) => [
			name,
			{ name, mimeType: "application/octet-stream", buffer },
		]),
	);
}

test.describe("push flow", () => {
	test("upsert, missing, files and commit make a repository", async ({
		playwright,
	}) => {
		const setup = await makeCourse();
		const api = await contextFor(playwright, setup.instructor.username, {
			bearer: true,
		});
		const slug = tag("lab");
		const { files, tree } = repositoryTree({
			"README.md": "# Flow Lab\n",
			"bin/run.sh": { content: "#!/bin/sh\necho hi\n", mode: "100755" },
			"data/blob.bin": Buffer.from([0, 1, 2, 255]),
		});
		const hashes = Object.keys(files);

		const created = await api.put(setup.api, { data: { slug } });
		expect(created.status()).toBe(200);
		const empty = await created.json();
		expect(empty.slug).toBe(slug);
		expect(empty.head).toBeNull();
		expect(new URL(empty.cloneUrl).pathname).toMatch(
			new RegExp(`^/git/[^/]+/${slug}\\.git$`),
		);

		const again = await api.put(setup.api, { data: { slug } });
		expect(again.status()).toBe(200);
		expect((await again.json()).cloneUrl).toBe(empty.cloneUrl);

		const before = await api.post("/api/blob/missing", { data: { hashes } });
		expect(before.status()).toBe(200);
		expect(new Set((await before.json()).missing)).toEqual(new Set(hashes));

		const upload = await api.post(`${setup.api}/${slug}/files`, {
			multipart: multipartOf(files),
		});
		expect(upload.status()).toBe(200);
		expect(new Set((await upload.json()).added)).toEqual(new Set(hashes));

		const after = await api.post("/api/blob/missing", { data: { hashes } });
		expect((await after.json()).missing).toEqual([]);

		const commit = await api.post(`${setup.api}/${slug}/commit`, {
			data: { tree, message: "first push" },
		});
		expect(commit.status()).toBe(200);
		const pushed = await commit.json();
		expect(pushed.head).toMatch(SHA1);
		expect(pushed.tree).toMatch(SHA1);
		expect(pushed.message).toBe("first push");
		expect(pushed.title).toBe("Flow Lab");

		const one = await api.get(`${setup.api}/${slug}`);
		expect(one.status()).toBe(200);
		const found = await one.json();
		expect(found.head).toBe(pushed.head);
		for (const forbidden of ["id", "token", "zipHash", "courseId"]) {
			expect(found, forbidden).not.toHaveProperty(forbidden);
		}

		const many = await api.get(setup.api);
		expect(many.status()).toBe(200);
		expect((await many.json()).map((r: { slug: string }) => r.slug)).toContain(
			slug,
		);
	});

	test("a repeated commit of the same tree keeps the head", async ({
		playwright,
	}) => {
		const setup = await makeCourse();
		const api = await contextFor(playwright, setup.instructor.username, {
			bearer: true,
		});
		const slug = tag("same");
		const { files, tree } = repositoryTree({ "a.txt": "a\n" });
		await api.put(setup.api, { data: { slug } });
		await api.post(`${setup.api}/${slug}/files`, {
			multipart: multipartOf(files),
		});
		const first = await (
			await api.post(`${setup.api}/${slug}/commit`, { data: { tree } })
		).json();

		const second = await (
			await api.post(`${setup.api}/${slug}/commit`, { data: { tree } })
		).json();

		expect(second.head).toBe(first.head);
	});

	test("a part whose sha-256 differs from its name is refused and stores nothing", async ({
		playwright,
	}) => {
		const setup = await makeCourse();
		const api = await contextFor(playwright, setup.instructor.username, {
			bearer: true,
		});
		const slug = tag("bad");
		await api.put(setup.api, { data: { slug } });
		const honest = Buffer.from("honest\n");
		const forged = hashBytes(Buffer.from("something else\n"));

		const response = await api.post(`${setup.api}/${slug}/files`, {
			multipart: multipartOf({ [forged]: honest }),
		});

		expect(response.status()).toBeGreaterThanOrEqual(400);
		expect(response.status()).toBeLessThan(500);
		const missing = await api.post("/api/blob/missing", {
			data: { hashes: [forged, hashBytes(honest)] },
		});
		expect(new Set((await missing.json()).missing)).toEqual(
			new Set([forged, hashBytes(honest)]),
		);
	});

	test("a commit naming a hash the server does not have is refused", async ({
		playwright,
	}) => {
		const setup = await makeCourse();
		const api = await contextFor(playwright, setup.instructor.username, {
			bearer: true,
		});
		const slug = tag("ghost");
		await api.put(setup.api, { data: { slug } });
		const { tree } = repositoryTree({ "ghost.txt": tag("never uploaded") });

		const response = await api.post(`${setup.api}/${slug}/commit`, {
			data: { tree },
		});

		expect(response.status()).toBe(400);
	});

	test("rotate-token changes the clone URL and delete removes the repository", async ({
		playwright,
	}) => {
		const setup = await makeCourse();
		const api = await contextFor(playwright, setup.instructor.username, {
			bearer: true,
		});
		const slug = tag("rot");
		await seedRepository(setup, slug);
		const before = await (await api.get(`${setup.api}/${slug}`)).json();

		const rotated = await api.post(`${setup.api}/${slug}/rotate-token`);
		expect(rotated.status()).toBe(200);
		const after = await rotated.json();

		expect(after.cloneUrl).not.toBe(before.cloneUrl);
		expect(after.slug).toBe(slug);
		expect(after).not.toHaveProperty("token");

		const removed = await api.delete(`${setup.api}/${slug}`);
		expect(removed.status()).toBe(200);
		expect((await api.get(`${setup.api}/${slug}`)).status()).toBe(404);
	});

	test("the API requires authentication", async ({ playwright }) => {
		const setup = await makeCourse();
		const anonymous = await contextFor(playwright, null, { bearer: false });

		expect((await anonymous.get(setup.api)).status()).toBe(401);
		expect(
			(await anonymous.put(setup.api, { data: { slug: "x" } })).status(),
		).toBe(401);
	});
});

test.describe("permissions", () => {
	test("a student with a bearer key cannot push, delete or rotate", async ({
		playwright,
	}) => {
		const setup = await makeCourse();
		const api = await contextFor(playwright, setup.student.username, {
			bearer: true,
		});
		const slug = tag("locked");
		await seedRepository(setup, slug);
		const { files, tree } = repositoryTree({ "x.txt": "x\n" });

		const statuses = {
			upsert: (
				await api.put(setup.api, { data: { slug: tag("new") } })
			).status(),
			create: (
				await api.post(setup.api, { data: { slug: tag("new") } })
			).status(),
			files: (
				await api.post(`${setup.api}/${slug}/files`, {
					multipart: multipartOf(files),
				})
			).status(),
			commit: (
				await api.post(`${setup.api}/${slug}/commit`, { data: { tree } })
			).status(),
			rotate: (await api.post(`${setup.api}/${slug}/rotate-token`)).status(),
			delete: (await api.delete(`${setup.api}/${slug}`)).status(),
		};

		expect(statuses).toEqual({
			upsert: 403,
			create: 403,
			files: 403,
			commit: 403,
			rotate: 403,
			delete: 403,
		});
	});

	test("a student sees repositories with a commit and not the empty ones", async ({
		playwright,
	}) => {
		const setup = await makeCourse();
		const api = await contextFor(playwright, setup.student.username, {
			bearer: true,
		});
		const committed = tag("done");
		const empty = tag("empty");
		await seedRepository(setup, committed);
		await db.repository.upsert(
			{ course: setup.course.id, slug: empty },
			{ actor: setup.instructor },
		);

		const list = await (await api.get(setup.api)).json();
		const slugs = list.map((r: { slug: string }) => r.slug);

		expect(slugs).toContain(committed);
		expect(slugs).not.toContain(empty);
		expect((await api.get(`${setup.api}/${committed}`)).status()).toBe(200);
		expect((await api.get(`${setup.api}/${empty}`)).status()).toBe(404);
	});

	test("the instructor sees the empty repository", async ({ playwright }) => {
		const setup = await makeCourse();
		const api = await contextFor(playwright, setup.instructor.username, {
			bearer: true,
		});
		const empty = tag("empty");
		await db.repository.upsert(
			{ course: setup.course.id, slug: empty },
			{ actor: setup.instructor },
		);

		const response = await api.get(`${setup.api}/${empty}`);

		expect(response.status()).toBe(200);
		expect((await response.json()).head).toBeNull();
	});

	test("a user outside the course cannot read its repositories", async ({
		playwright,
	}) => {
		const setup = await makeCourse();
		const api = await contextFor(playwright, setup.outsider.username, {
			bearer: true,
		});
		const slug = tag("hidden");
		await seedRepository(setup, slug);

		const response = await api.get(`${setup.api}/${slug}`);

		expect([403, 404]).toContain(response.status());
	});
});

test.describe("zip download", () => {
	test("a student of the course gets the zip with the files under the slug", async ({
		playwright,
	}) => {
		const setup = await makeCourse();
		const session = await contextFor(playwright, setup.student.username, {
			bearer: false,
		});
		const slug = tag("zipped");
		await seedRepository(setup, slug, {
			"README.md": "# Zipped\n",
			"src/run.sh": { content: "#!/bin/sh\n", mode: "100755" },
		});

		const response = await session.get(
			`${setup.page}/repositories/${slug}.zip`,
		);

		expect(response.status()).toBe(200);
		expect(response.headers()["content-type"]).toContain("application/zip");
		const body = await response.body();
		expect(body.subarray(0, 2).toString("latin1")).toBe("PK");
		const dir = path.join(TEST_RESOURCE_ROOT, "api-repository-zip");
		mkdirSync(dir, { recursive: true });
		const file = path.join(mkdtempSync(path.join(dir, "z-")), `${slug}.zip`);
		writeFileSync(file, body);
		const listing = execFileSync("unzip", ["-Z1", file]).toString();
		expect(listing.trim().split("\n")).toEqual([
			`${slug}/README.md`,
			`${slug}/src/run.sh`,
		]);
	});

	test("without a session the zip is refused or redirected to the login", async ({
		playwright,
	}) => {
		const setup = await makeCourse();
		const anonymous = await contextFor(playwright, null, { bearer: false });
		const slug = tag("private");
		await seedRepository(setup, slug);

		const response = await anonymous.get(
			`${setup.page}/repositories/${slug}.zip`,
			{ maxRedirects: 0 },
		);

		expect([302, 303, 307, 401, 403]).toContain(response.status());
		if (response.status() < 400) {
			expect(response.headers().location ?? "").toContain("login");
		}
		expect(response.headers()["content-type"] ?? "").not.toContain(
			"application/zip",
		);
	});

	test("a user outside the course does not get the zip", async ({
		playwright,
	}) => {
		const setup = await makeCourse();
		const session = await contextFor(playwright, setup.outsider.username, {
			bearer: false,
		});
		const slug = tag("closed");
		await seedRepository(setup, slug);

		const response = await session.get(
			`${setup.page}/repositories/${slug}.zip`,
			{ maxRedirects: 0 },
		);

		expect(response.status()).not.toBe(200);
	});
});

test.describe("OpenAPI", () => {
	type Schema = { properties?: Record<string, unknown> };
	type Document = {
		paths: Record<
			string,
			Record<string, { requestBody?: { content: Record<string, unknown> } }>
		>;
		components?: { schemas?: Record<string, Schema> };
	};

	test("documents the repository routes", async ({ request }) => {
		const document = (await (
			await request.get("/openapi.json")
		).json()) as Document;
		const paths = Object.keys(document.paths);

		const find = (pattern: RegExp, method: string) =>
			paths.find(
				(p) => pattern.test(p) && document.paths[p]?.[method] !== undefined,
			);
		expect(find(/\/repository$/, "get")).toBeDefined();
		expect(find(/\/repository$/, "put")).toBeDefined();
		expect(find(/\/repository\/\{[^}]+\}$/, "delete")).toBeDefined();
		expect(find(/\/repository\/\{[^}]+\}\/commit$/, "post")).toBeDefined();
		expect(
			find(/\/repository\/\{[^}]+\}\/rotate-token$/, "post"),
		).toBeDefined();
		expect(paths).toContain("/api/blob/missing");
		const files = find(/\/repository\/\{[^}]+\}\/files$/, "post");
		expect(files).toBeDefined();
		expect(
			Object.keys(
				document.paths[files ?? ""]?.post?.requestBody?.content ?? {},
			),
		).toEqual(["multipart/form-data"]);
	});

	test("repository schemas expose no token, zipHash or id", async ({
		request,
	}) => {
		const document = (await (
			await request.get("/openapi.json")
		).json()) as Document;
		const schemas = Object.entries(document.components?.schemas ?? {}).filter(
			([name]) => /repositor/i.test(name),
		);

		expect(schemas.length).toBeGreaterThan(0);
		for (const [name, schema] of schemas) {
			for (const forbidden of ["token", "zipHash", "id"]) {
				expect(
					schema.properties ?? {},
					`${name}.${forbidden}`,
				).not.toHaveProperty(forbidden);
			}
		}
	});
});
