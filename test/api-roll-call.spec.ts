import { type APIRequestContext, expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import type { CourseId } from "@/core/schemas";
import { db } from "@/db";
import { prisma } from "@/db/client";

/// Roll calls and the attendance report over HTTP, under the course's natural key.

const PASSWORD = "correct-horse-battery-staple";
const WEEK = 5;

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
	return { Authorization: `Bearer ${token}` };
}

async function enroll(course: { id: CourseId }) {
	const student = await makeUser("STUDENT");
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	return student;
}

/// Inserts the attendance row directly, so the test does not depend on `checkIn`.
function markPresent(
	rollCall: { id: number },
	username: string,
	source: "CODE" | "MANUAL" = "CODE",
) {
	return prisma.attendance.create({
		data: {
			rollCallId: rollCall.id,
			username,
			source,
			deviceHash: source === "CODE" ? tag("device") : null,
		},
	});
}

/**
 * A course with a `mon` slot, an event in week 5 with a roll call, three
 * enrolled students, and the REST URLs.
 *
 * A is present by code, B is absent and C is present by hand.
 */
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
			// A Monday, so week 0 of a MONDAY slot is the start date.
			startAt: new Date("2026-01-05T12:00:00Z"),
			endAt: new Date("2026-05-01"),
		},
		FULL_ACCESS,
	);
	const slot = await db.timeSlot.create(
		{
			course: course.id,
			slug: "mon",
			day: "MONDAY",
			start: { hour: 14, minute: 0 },
			duration: { hours: 2 },
		},
		FULL_ACCESS,
	);
	const event = await db.calendarEvent.create(
		{
			course: course.id,
			timeSlot: slot.id,
			week: WEEK,
			title: "Class 5",
			rev: tag("rev"),
		},
		FULL_ACCESS,
	);
	const rollCall = await db.rollCall.create(
		{ event: { id: event.id } },
		{ actor: instructor },
	);
	const [a, b, c] = [
		await enroll(course),
		await enroll(course),
		await enroll(course),
	];
	await markPresent(rollCall, a.username);
	await markPresent(rollCall, c.username, "MANUAL");

	const base = `/api/course/${discipline}/${instructor.username}_2026-1`;
	return {
		instructor,
		course,
		event,
		rollCall,
		a,
		b,
		c,
		base,
		url: `${base}/roll-call`,
		itemUrl: `${base}/roll-call/${WEEK}/mon`,
		attendanceUrl: `${base}/attendance`,
		eventUrl: `${base}/calendar-event/${WEEK}/mon`,
	};
}

/// The attendance rows of a roll call, keyed by username.
async function storedAttendances(rollCallId: number) {
	const rows = await prisma.attendance.findMany({ where: { rollCallId } });
	return new Map(rows.map((row) => [row.username, row]));
}

test("T5-01 GET on the collection lists roll calls with week, timeSlot and attendances by username", async ({
	request,
}) => {
	const { instructor, url, itemUrl, a, b, c } = await makeCourse();
	const headers = await tokenFor(request, instructor.username);

	const list = await request.get(url, { headers });
	expect(list.status()).toBe(200);
	const [item, ...rest] = await list.json();
	expect(rest).toHaveLength(0);
	expect(item).toMatchObject({ week: WEEK, timeSlot: "mon" });
	expect(Object.keys(item.attendances).sort()).toEqual(
		[a.username, c.username].sort(),
	);
	expect(item.attendances[a.username]).toMatchObject({ source: "CODE" });
	expect(item.attendances[c.username]).toMatchObject({ source: "MANUAL" });
	expect(item.attendances).not.toHaveProperty(b.username);
	expect(item).not.toHaveProperty("secret");
	expect(JSON.stringify(item)).not.toContain("deviceHash");

	const one = await request.get(itemUrl, { headers });
	expect(one.status()).toBe(200);
	expect(await one.json()).toEqual(item);
});

test("T5-02 PATCH merges attendances: an object marks MANUAL, null removes, an absent key is left alone", async ({
	request,
}) => {
	const { instructor, itemUrl, rollCall, a, b, c } = await makeCourse();
	const headers = await tokenFor(request, instructor.username);
	const before = (await storedAttendances(rollCall.id)).get(c.username);

	const patched = await request.patch(itemUrl, {
		headers,
		data: { attendances: { [b.username]: {}, [a.username]: null } },
	});
	expect(patched.status()).toBe(200);
	const body = await patched.json();
	expect(Object.keys(body.attendances).sort()).toEqual(
		[b.username, c.username].sort(),
	);

	const stored = await storedAttendances(rollCall.id);
	expect(stored.has(a.username)).toBe(false);
	expect(stored.get(b.username)?.source).toBe("MANUAL");
	expect(stored.get(c.username)).toEqual(before);
});

test("T5-03 PATCH with a username that has no enrollment is a 400 invalid-data and writes nothing", async ({
	request,
}) => {
	const { instructor, itemUrl, rollCall, a, b } = await makeCourse();
	const stranger = await makeUser("STUDENT");
	const headers = await tokenFor(request, instructor.username);
	const before = await storedAttendances(rollCall.id);

	const refused = await request.patch(itemUrl, {
		headers,
		data: {
			attendances: {
				[b.username]: {},
				[stranger.username]: {},
				[a.username]: null,
			},
		},
	});
	expect(refused.status()).toBe(400);
	expect((await refused.json()).code).toBe("invalid-data");

	expect(await storedAttendances(rollCall.id)).toEqual(before);
});

test("T5-04 an event with a roll call cannot be deleted until the roll call is", async ({
	request,
}) => {
	const { instructor, itemUrl, eventUrl, rollCall } = await makeCourse();
	const headers = await tokenFor(request, instructor.username);

	const blocked = await request.delete(eventUrl, { headers });
	expect(blocked.status()).toBe(409);
	expect((await request.get(eventUrl, { headers })).status()).toBe(200);
	expect(await prisma.rollCall.count({ where: { id: rollCall.id } })).toBe(1);

	const removed = await request.delete(itemUrl, { headers });
	expect(removed.ok()).toBe(true);
	expect((await request.get(itemUrl, { headers })).status()).toBe(404);
	expect(
		await prisma.attendance.count({ where: { rollCallId: rollCall.id } }),
	).toBe(0);

	const eventRemoved = await request.delete(eventUrl, { headers });
	expect(eventRemoved.ok()).toBe(true);
	expect((await request.get(eventUrl, { headers })).status()).toBe(404);
});

test("T5-05 a student reads only their own entry and cannot PATCH or DELETE", async ({
	request,
}) => {
	const { url, itemUrl, attendanceUrl, rollCall, a, b, c } = await makeCourse();
	const headers = await tokenFor(request, a.username);

	const list = await (await request.get(url, { headers })).json();
	expect(Object.keys(list[0].attendances)).toEqual([a.username]);
	const one = await (await request.get(itemUrl, { headers })).json();
	expect(Object.keys(one.attendances)).toEqual([a.username]);

	const report = await request.get(attendanceUrl, { headers });
	expect(report.status()).toBe(200);
	const { students } = await report.json();
	expect(students.map((s: { username: string }) => s.username)).toEqual([
		a.username,
	]);

	const patch = await request.patch(itemUrl, {
		headers,
		data: { attendances: { [b.username]: {} } },
	});
	expect(patch.status()).toBe(403);
	const del = await request.delete(itemUrl, { headers });
	expect(del.status()).toBe(403);

	const stored = await storedAttendances(rollCall.id);
	expect([...stored.keys()].sort()).toEqual([a.username, c.username].sort());
});

test("T5-06 /attendance is 403 for a user with no relation to the course and 404 for a missing course", async ({
	request,
}) => {
	const { base, attendanceUrl } = await makeCourse();
	const outsider = await makeUser("STUDENT");
	const headers = await tokenFor(request, outsider.username);

	expect((await request.get(attendanceUrl, { headers })).status()).toBe(403);

	const ghost = base.replace(
		/\/api\/course\/[^/]+\//,
		`/api/course/${tag("nope")}/`,
	);
	expect((await request.get(`${ghost}/attendance`, { headers })).status()).toBe(
		404,
	);
});

test("T5-07 the REST surface under roll-call is GET, PATCH and DELETE only", async ({
	request,
}) => {
	const { instructor, url } = await makeCourse();
	const headers = await tokenFor(request, instructor.username);

	const document = await (await request.get("/openapi.json")).json();
	const paths: Record<string, Record<string, unknown>> = document.paths;
	const rollCallPaths = Object.keys(paths).filter((path) =>
		path.includes("roll-call"),
	);
	expect(rollCallPaths.length).toBeGreaterThan(0);

	const methods = new Set(
		rollCallPaths.flatMap((path) => Object.keys(paths[path] ?? {})),
	);
	expect([...methods].sort()).toEqual(["delete", "get", "patch"]);
	for (const path of rollCallPaths) {
		expect(path).not.toMatch(/open|close|code|check-in/);
	}

	const post = await request.post(url, { headers, data: {} });
	expect([404, 405]).toContain(post.status());
});
