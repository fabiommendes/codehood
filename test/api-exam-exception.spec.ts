import { type APIRequestContext, expect, test } from "@playwright/test";
import { buildOpenApiDocument } from "@/api/registry/openapi-document";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedExamFactory } from "@/fixtures/exam.factory";

/// Exam exceptions over HTTP, under the exam's natural key.

function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

const PASSWORD = "correct-horse-battery-staple";
const MINUTE = 60_000;

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
	return { Authorization: `Bearer ${token}` };
}

/** A course with two enrolled students and a timed exam, plus the REST URLs. */
async function setup(opts: { timed?: boolean } = {}) {
	const instructor = await makeUser("INSTRUCTOR");
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
			startAt: new Date("2026-01-01"),
			endAt: new Date("2030-05-01"),
		},
		FULL_ACCESS,
	);
	const [student, classmate] = [
		await makeUser("STUDENT"),
		await makeUser("STUDENT"),
	] as const;
	for (const user of [student, classmate]) {
		await db.enrollment.create(
			{ course: course.id, username: user.username },
			FULL_ACCESS,
		);
	}
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: tag("exam-"),
		type: "EXAM",
		status: "SCHEDULED",
		scheduledAt: new Date(Date.now() + 60 * MINUTE),
		duration: opts.timed === false ? undefined : { minutes: 60 },
	});
	const url = `/api/course/${discipline}/${instructor.username}_2026-1/exam/${exam.slug}/exception`;
	return { instructor, student, classmate, exam, url };
}

const MAKEUP = "2030-03-01T14:00:00.000Z";

test("PUT creates an exception, GET reads it back, PATCH changes it and DELETE removes it", async ({
	request,
}) => {
	const { instructor, student, url } = await setup();
	const headers = await tokenFor(request, instructor.username);
	const item = `${url}/${student.username}`;

	const put = await request.put(url, {
		headers,
		data: {
			username: student.username,
			extraTime: { minutes: 30 },
			note: "atestado",
		},
	});
	expect(put.status()).toBe(200);

	const got = await request.get(item, { headers });
	expect(got.status()).toBe(200);
	const exception = await got.json();
	expect(exception).toMatchObject({
		username: student.username,
		scheduledAt: null,
		note: "atestado",
	});
	expect(exception.extraTime).toMatchObject({ minutes: 30 });
	expect(JSON.stringify(exception)).not.toMatch(/"(id|examId)"/);

	const patched = await request.patch(item, {
		headers,
		data: { scheduledAt: MAKEUP },
	});
	expect(patched.status()).toBe(200);
	const after = await (await request.get(item, { headers })).json();
	expect(new Date(after.scheduledAt).toISOString()).toBe(MAKEUP);
	expect(after.note).toBe("atestado");
	expect(after.extraTime).toMatchObject({ minutes: 30 });

	expect((await request.delete(item, { headers })).status()).toBe(200);
	expect((await request.get(item, { headers })).status()).toBe(404);
});

test("a second PUT for the same student updates the exception instead of adding another", async ({
	request,
}) => {
	const { instructor, student, url } = await setup();
	const headers = await tokenFor(request, instructor.username);
	for (const minutes of [30, 45]) {
		const res = await request.put(url, {
			headers,
			data: { username: student.username, extraTime: { minutes } },
		});
		expect(res.status()).toBe(200);
	}

	const list = await (await request.get(url, { headers })).json();
	expect(list).toHaveLength(1);
	expect(list[0].extraTime).toMatchObject({ minutes: 45 });
});

test("GET on the collection lists the exceptions of the exam by username, note included", async ({
	request,
}) => {
	const { instructor, student, classmate, url } = await setup();
	const headers = await tokenFor(request, instructor.username);
	for (const user of [student, classmate]) {
		await request.put(url, {
			headers,
			data: {
				username: user.username,
				extraTime: { minutes: 15 },
				note: `for ${user.username}`,
			},
		});
	}

	const list = await (await request.get(url, { headers })).json();
	expect(list.map((e: { username: string }) => e.username)).toEqual(
		[student.username, classmate.username].sort(),
	);
	expect(list[0].note).toMatch(/^for /);
	expect(JSON.stringify(list)).not.toMatch(/"(id|examId)"/);
});

test("an exception granting nothing is a 400 invalid-data and nothing is stored", async ({
	request,
}) => {
	const { instructor, student, url } = await setup();
	const headers = await tokenFor(request, instructor.username);

	for (const data of [
		{ username: student.username },
		{ username: student.username, extraTime: { minutes: 0 } },
	]) {
		const res = await request.put(url, { headers, data });
		expect(res.status()).toBe(400);
		expect((await res.json()).code).toBe("invalid-data");
	}
	expect(
		(await request.get(`${url}/${student.username}`, { headers })).status(),
	).toBe(404);
});

test("a PATCH that would leave nothing is a 400 and the exception is kept", async ({
	request,
}) => {
	const { instructor, student, url } = await setup();
	const headers = await tokenFor(request, instructor.username);
	await request.put(url, {
		headers,
		data: { username: student.username, extraTime: { minutes: 30 } },
	});

	const res = await request.patch(`${url}/${student.username}`, {
		headers,
		data: { extraTime: null },
	});
	expect(res.status()).toBe(400);
	expect((await res.json()).code).toBe("invalid-data");
	const kept = await (
		await request.get(`${url}/${student.username}`, { headers })
	).json();
	expect(kept.extraTime).toMatchObject({ minutes: 30 });
});

test("a makeup date on an untimed exam, an unenrolled student and over 24 hours of extra time are 400s", async ({
	request,
}) => {
	const untimed = await setup({ timed: false });
	const headers = await tokenFor(request, untimed.instructor.username);
	const noDuration = await request.put(untimed.url, {
		headers,
		data: { username: untimed.student.username, scheduledAt: MAKEUP },
	});
	expect(noDuration.status()).toBe(400);

	const { instructor, url } = await setup();
	const own = await tokenFor(request, instructor.username);
	const outsider = await makeUser("STUDENT");
	const unenrolled = await request.put(url, {
		headers: own,
		data: { username: outsider.username, extraTime: { minutes: 30 } },
	});
	expect(unenrolled.status()).toBe(400);
	expect((await unenrolled.json()).code).toBe("invalid-data");

	const { student } = await setup();
	const tooLong = await request.put(url, {
		headers: own,
		data: { username: student.username, extraTime: { hours: 25 } },
	});
	expect(tooLong.status()).toBe(400);
});

test("a student reads their own exception without the note, cannot see a classmate's, and cannot write", async ({
	request,
}) => {
	const { instructor, student, classmate, url } = await setup();
	const owner = await tokenFor(request, instructor.username);
	for (const user of [student, classmate]) {
		await request.put(url, {
			headers: owner,
			data: {
				username: user.username,
				extraTime: { minutes: 30 },
				note: "private",
			},
		});
	}
	const headers = await tokenFor(request, student.username);

	const mine = await request.get(`${url}/${student.username}`, { headers });
	expect(mine.status()).toBe(200);
	const body = await mine.json();
	expect(body.extraTime).toMatchObject({ minutes: 30 });
	expect(Object.keys(body)).not.toContain("note");

	expect(
		(await request.get(`${url}/${classmate.username}`, { headers })).status(),
	).toBe(404);

	const list = await (await request.get(url, { headers })).json();
	expect(list.map((e: { username: string }) => e.username)).toEqual([
		student.username,
	]);
	expect(JSON.stringify(list)).not.toContain("private");

	const write = await request.put(url, {
		headers,
		data: { username: student.username, extraTime: { minutes: 600 } },
	});
	expect(write.status()).toBe(403);
	expect(
		(
			await request.patch(`${url}/${student.username}`, {
				headers,
				data: { extraTime: { minutes: 600 } },
			})
		).status(),
	).toBe(403);
	expect(
		(await request.delete(`${url}/${student.username}`, { headers })).status(),
	).toBe(403);
	const kept = await (
		await request.get(`${url}/${student.username}`, { headers: owner })
	).json();
	expect(kept.extraTime).toMatchObject({ minutes: 30 });
});

test("a user with no relation to the course is refused", async ({
	request,
}) => {
	const { instructor, student, url } = await setup();
	const owner = await tokenFor(request, instructor.username);
	await request.put(url, {
		headers: owner,
		data: { username: student.username, extraTime: { minutes: 30 } },
	});
	const stranger = await makeUser("STUDENT");
	const headers = await tokenFor(request, stranger.username);

	expect((await request.get(url, { headers })).status()).toBe(403);
	expect(
		(await request.get(`${url}/${student.username}`, { headers })).status(),
	).not.toBe(200);
	expect(
		(
			await request.put(url, {
				headers,
				data: { username: student.username, extraTime: { minutes: 5 } },
			})
		).status(),
	).toBe(403);
});

test("a missing token is a 401", async ({ request }) => {
	const { url } = await setup();
	expect((await request.get(url)).status()).toBe(401);
});

test("openapi.json documents the exception collection and item without raw ids", () => {
	const paths = buildOpenApiDocument().paths ?? {};
	const base = "/api/course/{discipline}/{course}/exam/{slug}/exception";
	expect(Object.keys(paths[base] ?? {}).sort()).toEqual(
		expect.arrayContaining(["get", "post", "put"]),
	);
	expect(Object.keys(paths[`${base}/{username}`] ?? {}).sort()).toEqual(
		expect.arrayContaining(["delete", "get", "patch"]),
	);
});
