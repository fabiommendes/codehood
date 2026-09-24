import { type APIRequestContext, expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db, type Weekday } from "@/db";

/**
 * Time slots are addressed under their course's natural key, same as
 * resources and questions — see `test/api-resource.spec.ts`.
 */

function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

const PASSWORD = "correct-horse-battery-staple";

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

/** A fresh course taught by a fresh instructor, and its REST collection URL. */
async function makeCourse() {
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
			endAt: new Date("2026-05-01"),
		},
		FULL_ACCESS,
	);
	const url = `/api/course/${discipline}/${instructor.username}_2026-1/time-slot`;
	return { instructor, course, url };
}

function slot(overrides: Partial<{ day: Weekday; hour: number }> = {}) {
	return {
		title: "Lecture",
		day: overrides.day ?? "MONDAY",
		start: { hour: overrides.hour ?? 14, minute: 0 },
		duration: { hours: 1 },
	};
}

test("GET lists a course's time slots and GET <slug> reads one", async ({
	request,
}) => {
	const { instructor, course, url } = await makeCourse();
	await db.timeSlot.create(
		{ course: course.id, slug: "mon", ...slot() },
		{ actor: instructor },
	);
	const headers = await tokenFor(request, instructor.username);

	const list = await request.get(url, { headers });
	expect(list.status()).toBe(200);
	expect((await list.json()).map((s: { slug: string }) => s.slug)).toEqual([
		"mon",
	]);

	const one = await request.get(`${url}/mon`, { headers });
	expect(one.status()).toBe(200);
	const body = await one.json();
	expect(body.slug).toBe("mon");
	expect(body.start).toEqual({ hour: 14, minute: 0 });
});

test("/api/time-slot is gone", async ({ request }) => {
	const { instructor } = await makeCourse();
	const headers = await tokenFor(request, instructor.username);
	expect((await request.get("/api/time-slot", { headers })).status()).toBe(404);
	expect((await request.get("/api/time-slot/1", { headers })).status()).toBe(
		404,
	);
});

test("POST creates, PATCH updates and DELETE removes a time slot, all under the course path", async ({
	request,
}) => {
	const { instructor, url } = await makeCourse();
	const headers = await tokenFor(request, instructor.username);

	const created = await request.post(url, {
		headers,
		data: { slug: "mon", ...slot() },
	});
	expect(created.status()).toBe(200);
	const createdBody = await created.json();
	expect(createdBody.slug).toBe("mon");
	expect(createdBody.start).toEqual({ hour: 14, minute: 0 });

	const patched = await request.patch(`${url}/mon`, {
		headers,
		data: { start: { hour: 9, minute: 30 } },
	});
	expect(patched.status()).toBe(200);
	expect((await patched.json()).start).toEqual({ hour: 9, minute: 30 });

	const deleted = await request.delete(`${url}/mon`, { headers });
	expect(deleted.status()).toBe(200);
	expect((await request.get(`${url}/mon`, { headers })).status()).toBe(404);
});

test("POST ignores a courseId in the body: the path names the course", async ({
	request,
}) => {
	const { instructor, url } = await makeCourse();
	const other = await makeCourse();
	const headers = await tokenFor(request, instructor.username);

	const res = await request.post(url, {
		headers,
		data: { courseId: other.course.id, slug: "pinned", ...slot() },
	});
	expect(res.status()).toBe(200);

	// The slot landed under this course, not `other`'s: it shows up on this
	// course's list and 404s under the other course's path.
	expect(
		(await (await request.get(url, { headers })).json()).map(
			(s: { slug: string }) => s.slug,
		),
	).toContain("pinned");
	const otherHeaders = await tokenFor(request, other.instructor.username);
	expect(
		(
			await request.get(`${other.url}/pinned`, { headers: otherHeaders })
		).status(),
	).toBe(404);
});

test("status codes: 400 malformed segment or slug, 404 no course or no slug, 403 a course the actor cannot see", async ({
	request,
}) => {
	const { instructor, course, url } = await makeCourse();
	const outsider = await makeUser("STUDENT");
	const mine = await tokenFor(request, instructor.username);
	const theirs = await tokenFor(request, outsider.username);
	const ghost = url.replace(
		/\/api\/course\/[^/]+\//,
		`/api/course/${tag("nope")}/`,
	);
	await db.timeSlot.create(
		{ course: course.id, slug: "mon", ...slot() },
		{ actor: instructor },
	);

	const cases: [string, Promise<{ status(): number }>, number][] = [
		[
			"malformed course",
			request.get("/api/course/cs101/no-underscore/time-slot", {
				headers: mine,
			}),
			400,
		],
		[
			"malformed slug",
			request.get(`${url}/Not_A_Slug`, { headers: mine }),
			400,
		],
		["no such course, list", request.get(ghost, { headers: mine }), 404],
		[
			"no such course, item",
			request.get(`${ghost}/mon`, { headers: mine }),
			404,
		],
		[
			"no such slug, read",
			request.get(`${url}/missing`, { headers: mine }),
			404,
		],
		[
			"no such slug, update",
			request.patch(`${url}/missing`, {
				headers: mine,
				data: { title: "x" },
			}),
			404,
		],
		[
			// Delete is idempotent: a missing key is a no-op 200
			// (`{deleted: false}`), not a 404 — see `CRUDApi.deleteHandler`.
			"no such slug, delete",
			request.delete(`${url}/missing`, { headers: mine }),
			200,
		],
		["invisible course, list", request.get(url, { headers: theirs }), 403],
		[
			"invisible course, missing item",
			request.get(`${url}/missing`, { headers: theirs }),
			404,
		],
		[
			"invisible course, existing item",
			request.get(`${url}/mon`, { headers: theirs }),
			403,
		],
	];
	for (const [label, response, status] of cases) {
		expect.soft((await response).status(), label).toBe(status);
	}
});

test("PUT creates on the first call and updates the same time slot on the next, taking the slug from the body and the course from the path", async ({
	request,
}) => {
	const { instructor, url } = await makeCourse();
	const headers = await tokenFor(request, instructor.username);

	const first = await request.put(url, {
		headers,
		data: { slug: "mon", ...slot() },
	});
	expect(first.status()).toBe(200);
	const created = await first.json();
	expect(created).toMatchObject({
		slug: "mon",
		duration: { hours: 1 },
	});

	const again = await request.put(url, {
		headers,
		data: { slug: "mon", ...slot({ hour: 9 }) },
	});
	expect(again.status()).toBe(200);
	expect((await again.json()).start).toEqual({ hour: 9, minute: 0 });

	const list = await (await request.get(url, { headers })).json();
	expect(list).toHaveLength(1);
});
