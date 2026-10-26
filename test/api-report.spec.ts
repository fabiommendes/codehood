import { type APIRequestContext, expect, test } from "@playwright/test";
import { buildOpenApiDocument } from "@/api/registry/openapi-document";
import { FULL_ACCESS } from "@/auth/actor";
import { db, type User } from "@/db";

/// User reports over HTTP: the local triage loop and the attachment route.

function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

const PASSWORD = "correct-horse-battery-staple";

async function makeUser(role: "ADMIN" | "INSTRUCTOR" | "STUDENT") {
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

async function tokenFor(request: APIRequestContext, username: string) {
	const login = await request.post("/api/auth/login", {
		data: { login: username, password: PASSWORD },
	});
	expect(login.ok()).toBe(true);
	const { token } = await login.json();
	return { Authorization: `Bearer ${token}` };
}

function actorOf(user: User) {
	return {
		actor: { username: user.username, name: user.name, role: user.role },
	};
}

test("local triage: pull the OPEN reports, PATCH one, and it does not come back", async ({
	request,
}) => {
	const student = await makeUser("STUDENT");
	const admin = await makeUser("ADMIN");
	const asStudent = await tokenFor(request, student.username);
	const asAdmin = await tokenFor(request, admin.username);

	const created = await request.post("/api/report", {
		headers: asStudent,
		data: {
			kind: "BUG",
			message: "The calendar shows the wrong week",
			url: "http://localhost/calendar",
		},
	});
	expect(created.status()).toBe(200);
	const report = await created.json();
	expect(report).toMatchObject({
		kind: "BUG",
		status: "OPEN",
		author: student.username,
		url: "http://localhost/calendar",
		course: null,
		attachments: [],
	});
	expect(report).not.toHaveProperty("id");
	const second = await (
		await request.post("/api/report", {
			headers: asStudent,
			data: { kind: "SUGGESTION", message: "Add a dark theme please" },
		})
	).json();

	const queueUrl = `/api/report?status=OPEN&author=${student.username}`;
	const pulled = await request.get(queueUrl, { headers: asAdmin });
	expect(pulled.status()).toBe(200);
	expect(
		(await pulled.json()).map((r: { publicId: string }) => r.publicId),
	).toEqual([report.publicId, second.publicId]);

	const patched = await request.patch(`/api/report/${report.publicId}`, {
		headers: asAdmin,
		data: { status: "TRIAGED", note: "Off-by-one in the week anchor" },
	});
	expect(patched.status()).toBe(200);
	expect(await patched.json()).toMatchObject({
		status: "TRIAGED",
		note: "Off-by-one in the week anchor",
		triagedBy: admin.username,
	});

	const again = await request.get(queueUrl, { headers: asAdmin });
	expect(
		(await again.json()).map((r: { publicId: string }) => r.publicId),
	).toEqual([second.publicId]);

	const byKind = await request.get(
		`/api/report?kind=SUGGESTION&author=${student.username}`,
		{ headers: asAdmin },
	);
	expect(
		(await byKind.json()).map((r: { publicId: string }) => r.publicId),
	).toEqual([second.publicId]);

	const mine = await request.get(`/api/report/${report.publicId}`, {
		headers: asStudent,
	});
	expect(mine.status()).toBe(200);
	const mineBody = await mine.json();
	expect(mineBody.status).toBe("TRIAGED");
	expect(mineBody).not.toHaveProperty("note");

	const refused = await request.patch(`/api/report/${second.publicId}`, {
		headers: asStudent,
		data: { status: "DISMISSED" },
	});
	expect(refused.status()).toBe(403);

	const deleted = await request.delete(`/api/report/${second.publicId}`, {
		headers: asStudent,
	});
	expect(deleted.ok()).toBe(true);
	expect(
		(
			await request.get(`/api/report/${second.publicId}`, {
				headers: asAdmin,
			})
		).status(),
	).toBe(404);
});

test("POST refuses CONTENT without a course and a short message", async ({
	request,
}) => {
	const student = await makeUser("STUDENT");
	const headers = await tokenFor(request, student.username);

	const noCourse = await request.post("/api/report", {
		headers,
		data: { kind: "CONTENT", message: "Question 2 has two right answers" },
	});
	expect(noCourse.status()).toBe(400);

	const short = await request.post("/api/report", {
		headers,
		data: { kind: "BUG", message: "broken" },
	});
	expect(short.status()).toBe(400);
});

test("reports need a logged-in user", async ({ request }) => {
	const res = await request.post("/api/report", {
		data: { kind: "BUG", message: "Nobody is logged in here" },
	});
	expect(res.status()).toBe(401);
});

test("the attachment route serves the bytes to readers and answers 404 to everyone else", async ({
	request,
}) => {
	const student = await makeUser("STUDENT");
	const outsider = await makeUser("STUDENT");
	const admin = await makeUser("ADMIN");
	const bytes = Buffer.from(`png-bytes ${tag("b")}`);
	const report = await db.report.create(
		{
			kind: "BUG",
			message: "Look at this screenshot",
			attachments: [{ filename: "screenshot.png", bytes }],
		},
		actorOf(student),
	);
	const url = `/api/report/${report.publicId}/attachment/screenshot.png`;
	expect(report.attachments[0]?.url).toBe(url);

	for (const user of [student, admin]) {
		const res = await request.get(url, {
			headers: await tokenFor(request, user.username),
		});
		expect(res.status()).toBe(200);
		expect(res.headers()["content-type"]).toBe("image/png");
		expect(Buffer.from(await res.body())).toEqual(bytes);
	}

	const asOutsider = await tokenFor(request, outsider.username);
	expect((await request.get(url, { headers: asOutsider })).status()).toBe(404);
	expect((await request.get(url)).status()).toBe(404);
	expect(
		(
			await request.get(
				`/api/report/${report.publicId}/attachment/missing.png`,
				{ headers: await tokenFor(request, student.username) },
			)
		).status(),
	).toBe(404);
});

test("the OpenAPI document has report routes without PUT, and no hash anywhere", () => {
	const document = buildOpenApiDocument();
	const paths = document.paths ?? {};

	expect(Object.keys(paths["/api/report"] ?? {}).sort()).toEqual([
		"get",
		"post",
	]);
	expect(Object.keys(paths["/api/report/{publicId}"] ?? {}).sort()).toEqual([
		"delete",
		"get",
		"patch",
	]);

	const reportOps = JSON.stringify([
		paths["/api/report"],
		paths["/api/report/{publicId}"],
	]);
	const schemas = JSON.stringify(document.components?.schemas ?? {});
	expect(reportOps).not.toMatch(/"hash"/);
	expect(reportOps).not.toMatch(/"bytes"/);
	expect(schemas).not.toMatch(/"Report[^"]*":\{[^}]*"hash"/);
});
