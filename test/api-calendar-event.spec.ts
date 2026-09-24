import { type APIRequestContext, expect, test } from "@playwright/test";
import { type Actor, FULL_ACCESS } from "@/auth/actor";
import type { CourseId } from "@/core/schemas";
import { db } from "@/db";

/**
 * Calendar events are addressed under their course's natural key, same as
 * time slots — see `test/api-time-slot.spec.ts`. An event's own key is the
 * `(week, time slot slug)` pair that is unique within the course, so the
 * REST API never needs an autoincrement id.
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

/** A fresh course with one MONDAY slot, and its REST collection URL. */
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
			// A Monday in SERVER_TZ, so week 0 of a MONDAY slot is the start date.
			startAt: new Date("2026-01-05T12:00:00Z"),
			endAt: new Date("2026-05-01"),
		},
		FULL_ACCESS,
	);
	const slot = await db.timeSlot.create(
		{
			course: course.id,
			slug: "mon",
			title: "Lecture",
			day: "MONDAY",
			start: { hour: 14, minute: 0 },
			duration: { hours: 2 },
		},
		{ actor: instructor },
	);
	const url = `/api/course/${discipline}/${instructor.username}_2026-1/calendar-event`;
	return { instructor, course, slot, url };
}

/// Seeds through the service, not the API: logging a second user in over the
/// same request context leaves a session cookie that outranks the bearer
/// header, so a test that needs two actors cannot also write over HTTP.
async function seed(
	course: { id: CourseId },
	instructor: Actor,
	overrides: Partial<{ week: number; title: string }> = {},
) {
	return db.calendarEvent.create(
		{
			course: course.id,
			timeSlot: "mon",
			week: overrides.week ?? 1,
			title: overrides.title ?? "Week 1: recursion",
			ref: tag("ref"),
		},
		{ actor: instructor },
	);
}

function event(overrides: Partial<{ week: number; title: string }> = {}) {
	return {
		timeSlot: "mon",
		week: overrides.week ?? 1,
		kind: "REGULAR",
		title: overrides.title ?? "Week 1: recursion",
		ref: tag("ref"),
	};
}

test("POST creates under the course path, and the response carries neither ids nor a course", async ({
	request,
}) => {
	const { instructor, url } = await makeCourse();
	const headers = await tokenFor(request, instructor.username);

	const created = await request.post(url, { headers, data: event() });
	expect(created.status()).toBe(200);

	const body = await created.json();
	expect(body).toMatchObject({ week: 1, title: "Week 1: recursion" });
	expect(body).not.toHaveProperty("id");
	expect(body).not.toHaveProperty("courseId");
	expect(body.timeSlot).toMatchObject({ slug: "mon", day: "MONDAY" });
	expect(body.timeSlot).not.toHaveProperty("id");
});

test("GET lists a course's events and GET <week>/<slot> reads one", async ({
	request,
}) => {
	const { instructor, url } = await makeCourse();
	const headers = await tokenFor(request, instructor.username);
	await request.post(url, { headers, data: event({ week: 0 }) });
	await request.post(url, { headers, data: event({ week: 2 }) });

	const list = await request.get(url, { headers });
	expect(list.status()).toBe(200);
	expect((await list.json()).map((e: { week: number }) => e.week)).toEqual([
		0, 2,
	]);

	const one = await request.get(`${url}/2/mon`, { headers });
	expect(one.status()).toBe(200);
	expect((await one.json()).week).toBe(2);
});

test("the listing is scoped to the course in the path, not to every course the actor may read", async ({
	request,
}) => {
	const mine = await makeCourse();
	const theirs = await makeCourse();
	await seed(mine.course, mine.instructor, { title: "mine" });
	await seed(theirs.course, theirs.instructor, { title: "theirs" });

	const headers = await tokenFor(request, mine.instructor.username);
	const listed = await (await request.get(mine.url, { headers })).json();
	expect(listed.map((e: { title: string }) => e.title)).toEqual(["mine"]);
});

test("the API addresses a slot by slug only, while the service still takes its id", async ({
	request,
}) => {
	const { course, instructor, slot, url } = await makeCourse();
	const headers = await tokenFor(request, instructor.username);

	const byId = await request.post(url, {
		headers,
		data: { ...event(), timeSlot: slot.id },
	});
	expect(byId.status()).toBe(400);

	const created = await db.calendarEvent.create(
		{
			course: course.id,
			timeSlot: slot.id,
			week: 1,
			title: "x",
			ref: tag("r"),
		},
		{ actor: instructor },
	);
	expect(created.timeSlot.slug).toBe("mon");
});

test("/api/calendar-event is gone", async ({ request }) => {
	const { instructor } = await makeCourse();
	const headers = await tokenFor(request, instructor.username);
	expect((await request.get("/api/calendar-event", { headers })).status()).toBe(
		404,
	);
	expect(
		(await request.get("/api/calendar-event/1", { headers })).status(),
	).toBe(404);
});

test("PATCH updates and DELETE removes an event addressed by week and slot", async ({
	request,
}) => {
	const { instructor, url } = await makeCourse();
	const headers = await tokenFor(request, instructor.username);
	await request.post(url, { headers, data: event() });

	const patched = await request.patch(`${url}/1/mon`, {
		headers,
		data: { kind: "CANCELLED", description: "Public holiday." },
	});
	expect(patched.status()).toBe(200);
	expect(await patched.json()).toMatchObject({
		kind: "CANCELLED",
		description: "Public holiday.",
	});

	const deleted = await request.delete(`${url}/1/mon`, { headers });
	expect(deleted.status()).toBe(200);
	expect((await request.get(`${url}/1/mon`, { headers })).status()).toBe(404);
});

test("PUT creates on the first call and updates the same event on the next, taking week and slot from the body", async ({
	request,
}) => {
	const { instructor, url } = await makeCourse();
	const headers = await tokenFor(request, instructor.username);

	const first = await request.put(url, {
		headers,
		data: event({ title: "first" }),
	});
	expect(first.status()).toBe(200);
	expect((await first.json()).title).toBe("first");

	const again = await request.put(url, {
		headers,
		data: event({ title: "second" }),
	});
	expect(again.status()).toBe(200);
	expect((await again.json()).title).toBe("second");

	expect(await (await request.get(url, { headers })).json()).toHaveLength(1);
});

test("status codes: 400 a malformed segment or week, 404 no course or no event, 403 a course the actor cannot see", async ({
	request,
}) => {
	const { course, instructor, url } = await makeCourse();
	const outsider = await makeUser("STUDENT");
	await seed(course, instructor);
	const mine = await tokenFor(request, instructor.username);
	const theirs = await tokenFor(request, outsider.username);
	const ghost = url.replace(
		/\/api\/course\/[^/]+\//,
		`/api/course/${tag("nope")}/`,
	);

	const cases: [string, Promise<{ status(): number }>, number][] = [
		[
			"malformed course",
			request.get("/api/course/cs101/no-underscore/calendar-event", {
				headers: mine,
			}),
			400,
		],
		["malformed week", request.get(`${url}/one/mon`, { headers: mine }), 400],
		["negative week", request.get(`${url}/-1/mon`, { headers: mine }), 400],
		["no such course, list", request.get(ghost, { headers: mine }), 404],
		[
			"no such course, item",
			request.get(`${ghost}/1/mon`, { headers: mine }),
			404,
		],
		["no such week", request.get(`${url}/9/mon`, { headers: mine }), 404],
		["no such slot", request.get(`${url}/1/missing`, { headers: mine }), 404],
		[
			// Delete is idempotent: a missing key is a no-op 200
			// (`{deleted: false}`), not a 404 — see `CRUDApi.deleteHandler`.
			"no such event, delete",
			request.delete(`${url}/9/mon`, { headers: mine }),
			200,
		],
		[
			"invisible course, existing item",
			request.get(`${url}/1/mon`, { headers: theirs }),
			403,
		],
	];
	for (const [label, response, status] of cases) {
		expect.soft((await response).status(), label).toBe(status);
	}
});

test("a listing of a course the actor cannot read is empty, not refused", async ({
	request,
}) => {
	// The service filters rather than refusing, so a course an actor cannot
	// read is indistinguishable from one with no events. That contract is
	// pinned at the service level in `calendar-event-service.spec.ts`.
	const { course, instructor, url } = await makeCourse();
	await seed(course, instructor);
	const outsider = await makeUser("STUDENT");
	const headers = await tokenFor(request, outsider.username);

	const listed = await request.get(url, { headers });
	expect(listed.status()).toBe(200);
	expect(await listed.json()).toEqual([]);
});
