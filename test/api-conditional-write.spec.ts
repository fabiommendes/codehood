import { createHash } from "node:crypto";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { type APIRequestContext, expect, test } from "./fixtures";
import { seedUser } from "./stories/helpers";

/// Conditional writes over REST (ADR 0013): `If-Match` and `If-None-Match: *`
/// on the routes the CLI writes, the 412 they answer, and the ETag of a write.

const PASSWORD = "correct-horse-battery-staple";
const STALE = '"2000-01-01T00:00:00.000Z"';

// A random suffix, not a counter: sibling spec files share one test database.
function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

async function makeUser(role: "INSTRUCTOR" | "STUDENT") {
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
	return { Authorization: `Bearer ${token}`, Cookie: "" };
}

/// A fresh course with a `mon` time slot, its REST base URL and an instructor token.
async function makeCourse(request: APIRequestContext) {
	const instructor = await makeUser("INSTRUCTOR");
	const discipline = tag("disc");
	await db.discipline.create(
		{ slug: discipline, name: discipline },
		FULL_ACCESS,
	);
	if (!(await db.edition.findOne({ slug: "2026-1" }, FULL_ACCESS))) {
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
	await db.timeSlot.create(
		{
			course: course.id,
			slug: "mon",
			day: "MONDAY",
			start: { hour: 14, minute: 0 },
			duration: { hours: 2 },
		},
		FULL_ACCESS,
	);
	const headers = await tokenFor(request, instructor.username);
	return {
		instructor,
		course,
		discipline,
		headers,
		base: `/api/course/${discipline}/${instructor.username}_2026-1`,
	};
}

/// The quoted `updatedAt` of a JSON body: the ETag a client builds itself.
function quoted(body: { updatedAt: string }): string {
	return `"${body.updatedAt}"`;
}

/// Asserts a 412 whose body carries `updatedAt` (the row's version, or null).
async function expect412(
	response: Awaited<ReturnType<APIRequestContext["put"]>>,
	updatedAt: string | null,
) {
	expect(response.status()).toBe(412);
	const body = await response.json();
	expect(body).toMatchObject({
		code: "precondition-failed",
		status: 412,
		updatedAt,
	});
}

function link(slug: string, title = "Syllabus") {
	return {
		slug,
		title,
		data: { type: "LINK" as const, url: "https://example.com" },
		rev: tag("h"),
	};
}

test("course: PUT answers an ETag, a stale If-Match is a 412 with the current updatedAt, and the fresh one writes", async ({
	request,
}) => {
	const { instructor, discipline, headers, base } = await makeCourse(request);
	const body = (description: string) => ({
		discipline,
		instructor: instructor.username,
		edition: "2026-1",
		description,
		startAt: "2026-01-05T12:00:00.000Z",
		endAt: "2026-05-01T00:00:00.000Z",
	});

	// No header: today's last-write-wins, now with an ETag.
	const first = await request.put("/api/course", {
		headers,
		data: body("first"),
	});
	expect(first.status()).toBe(200);
	const firstBody = await first.json();
	expect(first.headers().etag).toBe(quoted(firstBody));

	const stale = await request.put("/api/course", {
		headers: { ...headers, "If-Match": STALE },
		data: body("stale"),
	});
	await expect412(stale, firstBody.updatedAt);
	expect(
		(await (await request.get(base, { headers })).json()).description,
	).toBe("first");

	const fresh = await request.put("/api/course", {
		headers: { ...headers, "If-Match": first.headers().etag as string },
		data: body("second"),
	});
	expect(fresh.status()).toBe(200);
	const freshBody = await fresh.json();
	expect(freshBody.description).toBe("second");
	expect(fresh.headers().etag).toBe(quoted(freshBody));
	expect(fresh.headers().etag).not.toBe(first.headers().etag);

	// The old version no longer matches.
	await expect412(
		await request.put("/api/course", {
			headers: { ...headers, "If-Match": first.headers().etag as string },
			data: body("third"),
		}),
		freshBody.updatedAt,
	);

	// If-None-Match: * on a course that exists.
	await expect412(
		await request.put("/api/course", {
			headers: { ...headers, "If-None-Match": "*" },
			data: body("again"),
		}),
		freshBody.updatedAt,
	);

	// PATCH honors it too, and GET answers the same ETag as the body.
	const read = await request.get(base, { headers });
	expect(read.headers().etag).toBe(quoted(await read.json()));
	await expect412(
		await request.patch(base, {
			headers: { ...headers, "If-Match": STALE },
			data: { description: "patched" },
		}),
		freshBody.updatedAt,
	);
	const patched = await request.patch(base, {
		headers: { ...headers, "If-Match": read.headers().etag as string },
		data: { description: "patched" },
	});
	expect(patched.status()).toBe(200);
	expect(patched.headers().etag).toBe(quoted(await patched.json()));
});

test("resource: If-None-Match: * creates a new row and refuses an existing one", async ({
	request,
}) => {
	const { headers, base } = await makeCourse(request);
	const url = `${base}/resource`;

	const created = await request.put(url, {
		headers: { ...headers, "If-None-Match": "*" },
		data: link("syllabus"),
	});
	expect(created.status()).toBe(200);
	const createdBody = await created.json();
	expect(created.headers().etag).toBe(quoted(createdBody));

	await expect412(
		await request.put(url, {
			headers: { ...headers, "If-None-Match": "*" },
			data: link("syllabus", "Overwritten"),
		}),
		createdBody.updatedAt,
	);
	expect(
		(await (await request.get(`${url}/syllabus`, { headers })).json()).title,
	).toBe("Syllabus");

	// A Date on a row that does not exist is a 412 with null.
	await expect412(
		await request.put(url, {
			headers: { ...headers, "If-Match": STALE },
			data: link("ghost"),
		}),
		null,
	);
	expect((await request.get(`${url}/ghost`, { headers })).status()).toBe(404);
});

test("resource: the updatedAt of a listing, in quotes, works as If-Match, and DELETE honors it", async ({
	request,
}) => {
	const { headers, base } = await makeCourse(request);
	const url = `${base}/resource`;
	expect(
		(await request.put(url, { headers, data: link("notes") })).status(),
	).toBe(200);

	const [listed] = await (await request.get(url, { headers })).json();
	const updated = await request.put(url, {
		headers: { ...headers, "If-Match": quoted(listed) },
		data: link("notes", "Notes v2"),
	});
	expect(updated.status()).toBe(200);
	const current = await updated.json();
	expect(current.title).toBe("Notes v2");

	await expect412(
		await request.delete(`${url}/notes`, {
			headers: { ...headers, "If-Match": quoted(listed) },
		}),
		current.updatedAt,
	);
	expect((await request.get(`${url}/notes`, { headers })).status()).toBe(200);

	const removed = await request.delete(`${url}/notes`, {
		headers: { ...headers, "If-Match": quoted(current) },
	});
	expect(removed.status()).toBe(200);
	expect((await removed.json()).deleted).toBe(true);
	expect((await request.get(`${url}/notes`, { headers })).status()).toBe(404);
});

/// The sha-256 of `bytes`, the name its multipart part travels under.
function sha256(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/// A multipart PUT of a `FILE` resource with its bytes.
function fileUpload(slug: string, bytes: Buffer) {
	const hash = sha256(bytes);
	return {
		json: JSON.stringify({
			slug,
			title: "Notes",
			rev: tag("h"),
			data: { type: "FILE", filename: "notes.pdf", hash },
		}),
		[hash]: {
			name: "file",
			mimeType: "application/octet-stream",
			buffer: bytes,
		},
	};
}

test("resource: a multipart PUT honors If-Match", async ({ request }) => {
	const { headers, base } = await makeCourse(request);
	const url = `${base}/resource`;
	const first = await request.put(url, {
		headers: { ...headers, "If-None-Match": "*" },
		multipart: fileUpload("slides", Buffer.from(`%PDF-1.4 ${tag("a")}`)),
	});
	expect(first.status()).toBe(200);
	const firstBody = await first.json();
	expect(first.headers().etag).toBe(quoted(firstBody));

	await expect412(
		await request.put(url, {
			headers: { ...headers, "If-Match": STALE },
			multipart: fileUpload("slides", Buffer.from(`%PDF-1.4 ${tag("b")}`)),
		}),
		firstBody.updatedAt,
	);

	const second = await request.put(url, {
		headers: { ...headers, "If-Match": quoted(firstBody) },
		multipart: fileUpload("slides", Buffer.from(`%PDF-1.4 ${tag("c")}`)),
	});
	expect(second.status()).toBe(200);
	expect(second.headers().etag).toBe(quoted(await second.json()));
});

test("question: PUT with If-None-Match, PATCH with a stale and a listed If-Match", async ({
	request,
}) => {
	const { headers, base } = await makeCourse(request);
	const url = `${base}/question`;
	const question = {
		slug: "q1",
		status: "PUBLISHED",
		version: "v1",
		question: {
			type: "true-false",
			stem: "Judge each statement.",
			choices: [
				{ id: "s0", text: "Statement 0", correct: true },
				{ id: "s1", text: "Statement 1", correct: false },
			],
		},
	};

	const created = await request.put(url, {
		headers: { ...headers, "If-None-Match": "*" },
		data: question,
	});
	expect(created.status()).toBe(200);
	const createdBody = await created.json();

	await expect412(
		await request.patch(`${url}/q1`, {
			headers: { ...headers, "If-Match": STALE },
			data: { status: "DRAFT" },
		}),
		createdBody.updatedAt,
	);

	const [listed] = await (await request.get(url, { headers })).json();
	const patched = await request.patch(`${url}/q1`, {
		headers: { ...headers, "If-Match": quoted(listed) },
		data: { status: "DRAFT" },
	});
	expect(patched.status()).toBe(200);
	expect((await patched.json()).status).toBe("DRAFT");
});

test("time slot, calendar event and grade column: PUT honors If-Match", async ({
	request,
}) => {
	const { headers, base } = await makeCourse(request);
	const cases = [
		{
			url: `${base}/time-slot`,
			body: (title: string) => ({
				slug: "mon",
				title,
				day: "MONDAY",
				start: { hour: 14, minute: 0 },
				duration: { hours: 2 },
			}),
		},
		{
			url: `${base}/calendar-event`,
			body: (title: string) => ({
				timeSlot: "mon",
				week: 2,
				kind: "REGULAR",
				title,
				rev: tag("r"),
			}),
		},
		{
			url: `${base}/grade-column`,
			body: (title: string) => ({
				slug: "final",
				title,
				kind: "NUMBER",
				position: 1,
				rev: tag("r"),
				values: [],
			}),
		},
	];
	for (const { url, body } of cases) {
		const first = await request.put(url, { headers, data: body("first") });
		expect(first.status(), url).toBe(200);
		const firstBody = await first.json();

		await expect412(
			await request.put(url, {
				headers: { ...headers, "If-Match": STALE },
				data: body("stale"),
			}),
			firstBody.updatedAt,
		);

		const second = await request.put(url, {
			headers: { ...headers, "If-Match": quoted(firstBody) },
			data: body("second"),
		});
		expect(second.status(), url).toBe(200);
		expect((await second.json()).title).toBe("second");
		expect(second.headers().etag).not.toBe(quoted(firstBody));
	}
});

test("calendar event and roll call: DELETE with a stale If-Match is a 412 and the row stays", async ({
	request,
}) => {
	const { instructor, course, headers, base } = await makeCourse(request);
	const event = await db.calendarEvent.create(
		{
			course: course.id,
			timeSlot: "mon",
			week: 3,
			title: "Class 3",
			rev: tag("r"),
		},
		FULL_ACCESS,
	);
	await db.rollCall.create({ event: { id: event.id } }, { actor: instructor });
	const otherEvent = `${base}/calendar-event/4/mon`;
	expect(
		(
			await request.put(`${base}/calendar-event`, {
				headers,
				data: { timeSlot: "mon", week: 4, kind: "REGULAR", title: "Class 4" },
			})
		).status(),
	).toBe(200);

	const rollCallUrl = `${base}/roll-call/3/mon`;
	const rollCall = await (await request.get(rollCallUrl, { headers })).json();
	await expect412(
		await request.delete(rollCallUrl, {
			headers: { ...headers, "If-Match": STALE },
		}),
		rollCall.updatedAt,
	);
	expect((await request.get(rollCallUrl, { headers })).status()).toBe(200);
	const removed = await request.delete(rollCallUrl, {
		headers: { ...headers, "If-Match": quoted(rollCall) },
	});
	expect(removed.status()).toBe(200);
	expect((await request.get(rollCallUrl, { headers })).status()).toBe(404);

	const read = await request.get(otherEvent, { headers });
	const eventBody = await read.json();
	expect(read.headers().etag).toBe(quoted(eventBody));
	await expect412(
		await request.delete(otherEvent, {
			headers: { ...headers, "If-Match": STALE },
		}),
		eventBody.updatedAt,
	);
	expect((await request.get(otherEvent, { headers })).status()).toBe(200);
	expect(
		(
			await request.delete(otherEvent, {
				headers: { ...headers, "If-Match": read.headers().etag as string },
			})
		).status(),
	).toBe(200);
});

test("repository: PUT with If-None-Match on an existing slug and DELETE with a stale If-Match are 412", async ({
	request,
}) => {
	const { headers, base } = await makeCourse(request);
	const url = `${base}/repository`;
	const created = await request.put(url, {
		headers: { ...headers, "If-None-Match": "*" },
		data: { slug: "lab1" },
	});
	expect(created.status()).toBe(200);
	const body = await created.json();
	expect(created.headers().etag).toBe(quoted(body));

	await expect412(
		await request.put(url, {
			headers: { ...headers, "If-None-Match": "*" },
			data: { slug: "lab1" },
		}),
		body.updatedAt,
	);
	await expect412(
		await request.delete(`${url}/lab1`, {
			headers: { ...headers, "If-Match": STALE },
		}),
		body.updatedAt,
	);
	expect((await request.get(`${url}/lab1`, { headers })).status()).toBe(200);
	expect(
		(
			await request.delete(`${url}/lab1`, {
				headers: { ...headers, "If-Match": quoted(body) },
			})
		).status(),
	).toBe(200);
	expect((await request.get(`${url}/lab1`, { headers })).status()).toBe(404);
});

test("a malformed or unsupported precondition is a 400 and writes nothing", async ({
	request,
}) => {
	const { headers, base } = await makeCourse(request);
	const url = `${base}/resource`;
	const created = await (
		await request.put(url, { headers, data: link("doc") })
	).json();

	const refused: Record<string, string>[] = [
		{ "If-Match": `W/${quoted(created)}` },
		{ "If-Match": "*" },
		{ "If-Match": `${quoted(created)}, ${STALE}` },
		{ "If-Match": created.updatedAt },
		{ "If-Match": '"2026-01-01T00:00:00Z"' },
		{ "If-None-Match": quoted(created) },
		{ "If-Match": quoted(created), "If-None-Match": "*" },
	];
	for (const extra of refused) {
		const response = await request.put(url, {
			headers: { ...headers, ...extra },
			data: link("doc", "Changed"),
		});
		expect(response.status(), JSON.stringify(extra)).toBe(400);
		expect((await response.json()).code).toBe("invalid-data");
	}
	const patch = await request.patch(`${url}/doc`, {
		headers: { ...headers, "If-None-Match": "*" },
		data: { title: "Changed" },
	});
	expect(patch.status()).toBe(400);
	expect(
		(await (await request.get(`${url}/doc`, { headers })).json()).title,
	).toBe("Syllabus");
});

test("routes over rows without a version refuse If-Match with a 400", async ({
	request,
}) => {
	const { headers, base } = await makeCourse(request);
	const admin = await seedUser({ role: "ADMIN" });
	const login = await request.post("/api/auth/login", {
		data: { login: admin.username, password: admin.password },
	});
	const { token } = await login.json();
	const adminHeaders = { Authorization: `Bearer ${token}`, Cookie: "" };

	const edition = await request.patch("/api/edition/2026-1", {
		headers: { ...adminHeaders, "If-Match": STALE },
		data: { name: "2026-1" },
	});
	expect(edition.status()).toBe(400);
	expect((await edition.json()).code).toBe("invalid-data");

	const submission = await request.patch(`${base}/submission/nope`, {
		headers: { ...headers, "If-Match": STALE },
		data: { status: "PENDING" },
	});
	expect(submission.status()).toBe(400);

	const me = await request.patch("/api/user/me", {
		headers: { ...headers, "If-Match": STALE },
		data: { name: "Changed" },
	});
	expect(me.status()).toBe(400);
});
