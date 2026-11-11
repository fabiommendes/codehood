import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { type APIRequestContext, expect, test } from "./fixtures";

/**
 * A request that breaks a business rule, or names a key that does not exist,
 * is answered with a 4xx carrying the error's code, never a 500.
 */

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
	return { Authorization: `Bearer ${token}`, Cookie: "" };
}

/** A fresh edition, discipline and course, and the course's REST path. */
async function makeCourse() {
	const instructor = await makeUser("INSTRUCTOR");
	const discipline = tag("disc");
	const edition = `20${Math.floor(Math.random() * 70) + 30}`;
	await db.discipline.create(
		{ slug: discipline, name: discipline },
		FULL_ACCESS,
	);
	if (!(await db.edition.findOne({ slug: edition }, FULL_ACCESS))) {
		await db.edition.create(
			{
				slug: edition,
				name: edition,
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
			edition,
			startAt: new Date("2026-01-01"),
			endAt: new Date("2026-05-01"),
		},
		FULL_ACCESS,
	);
	const path = `/api/course/${discipline}/${instructor.username}_${edition}`;
	return { instructor, course, discipline, edition, path };
}

function slot(
	slug: string,
	start: { hour: number; minute: number },
	duration: { hours?: number; minutes?: number },
) {
	return { slug, title: "Lecture", day: "MONDAY", start, duration };
}

type Case = [string, Promise<{ status(): number; json(): Promise<unknown> }>];

async function expectStatus(
	cases: Case[],
	status: number,
	code: string,
): Promise<void> {
	for (const [label, pending] of cases) {
		const response = await pending;
		expect.soft(response.status(), label).toBe(status);
		expect.soft(await response.json(), label).toMatchObject({ code });
	}
}

test("time slot rules answer 400 invalid-data", async ({ request }) => {
	const { instructor, path } = await makeCourse();
	const headers = await tokenFor(request, instructor.username);
	const url = `${path}/time-slot`;
	const first = await request.post(url, {
		headers,
		data: slot("mon", { hour: 14, minute: 0 }, { hours: 2 }),
	});
	expect(first.status()).toBe(200);

	await expectStatus(
		[
			[
				"overlap",
				request.post(url, {
					headers,
					data: slot("clash", { hour: 15, minute: 0 }, { hours: 1 }),
				}),
			],
			[
				"zero duration",
				request.post(url, {
					headers,
					data: slot("zero", { hour: 9, minute: 0 }, { minutes: 0 }),
				}),
			],
			[
				"past midnight",
				request.post(url, {
					headers,
					data: slot("late", { hour: 23, minute: 30 }, { hours: 1 }),
				}),
			],
		],
		400,
		"invalid-data",
	);
});

test("a calendar event on an unknown time slot answers 400 invalid-data", async ({
	request,
}) => {
	const { instructor, path } = await makeCourse();
	const headers = await tokenFor(request, instructor.username);

	await expectStatus(
		[
			[
				"unknown slot",
				request.post(`${path}/calendar-event`, {
					headers,
					data: {
						timeSlot: "nope",
						week: 1,
						kind: "REGULAR",
						title: "Week 1",
						rev: tag("rev"),
					},
				}),
			],
		],
		400,
		"invalid-data",
	);
});

test("deleting what others depend on answers 409 not-allowed", async ({
	request,
}) => {
	const { instructor, course, discipline, edition, path } = await makeCourse();
	const admin = await makeUser("ADMIN");
	const adminHeaders = await tokenFor(request, admin.username);
	const headers = await tokenFor(request, instructor.username);
	await db.timeSlot.create(
		{
			course: course.id,
			slug: "mon",
			title: "Lecture",
			day: "MONDAY",
			start: { hour: 14, minute: 0 },
			duration: { hours: 1 },
		},
		{ actor: instructor },
	);
	const event = await request.post(`${path}/calendar-event`, {
		headers,
		data: {
			timeSlot: "mon",
			week: 1,
			kind: "REGULAR",
			title: "Week 1",
			rev: tag("rev"),
		},
	});
	expect(event.status()).toBe(200);

	await expectStatus(
		[
			[
				"time slot with events",
				request.delete(`${path}/time-slot/mon`, { headers }),
			],
			[
				"edition with courses",
				request.delete(`/api/edition/${edition}`, { headers: adminHeaders }),
			],
			[
				"discipline with courses",
				request.delete(`/api/discipline/${discipline}`, {
					headers: adminHeaders,
				}),
			],
		],
		409,
		"not-allowed",
	);
});

test("updating an unknown course, edition or discipline answers 404 not-found", async ({
	request,
}) => {
	const { instructor, discipline } = await makeCourse();
	const admin = await makeUser("ADMIN");
	const headers = await tokenFor(request, admin.username);

	await expectStatus(
		[
			[
				"course",
				request.patch(`/api/course/${discipline}/${instructor.username}_1999`, {
					headers,
					data: { startAt: "2026-01-02T00:00:00Z" },
				}),
			],
			[
				"edition",
				request.patch("/api/edition/1999", {
					headers,
					data: { name: "x" },
				}),
			],
			[
				"discipline",
				request.patch(`/api/discipline/${discipline}x`, {
					headers,
					data: { name: "x" },
				}),
			],
		],
		404,
		"not-found",
	);
});

test("DELETE under a course that does not exist answers 404, a missing item under an existing one stays 200", async ({
	request,
}) => {
	const { instructor, path } = await makeCourse();
	const headers = await tokenFor(request, instructor.username);
	const ghost = path.replace(
		/\/api\/course\/[^/]+\//,
		`/api/course/${tag("nope")}/`,
	);

	const items = [
		"time-slot/mon",
		"calendar-event/1/mon",
		"exam/midterm",
		"exam/midterm/exception/bob",
		"grade-column/final",
		"roll-call/1/mon",
		"resource/notes",
		"question/q1",
		"response/abc123",
		"submission/abc123",
		"submission/abc123/feedback/v1",
	];
	await expectStatus(
		items.map(
			(item): Case => [item, request.delete(`${ghost}/${item}`, { headers })],
		),
		404,
		"not-found",
	);

	const missing = await request.delete(`${path}/time-slot/mon`, { headers });
	expect(missing.status()).toBe(200);
	expect(await missing.json()).toMatchObject({ deleted: false });
});

test("POST /api/invite takes the course by natural key only", async ({
	request,
}) => {
	const { instructor, course, discipline, edition } = await makeCourse();
	const headers = await tokenFor(request, instructor.username);
	const invite = (ref: unknown) =>
		request.post("/api/invite", {
			headers,
			data: {
				kind: "CLASSROOM",
				invitedRole: "STUDENT",
				email: null,
				maxUses: null,
				course: ref,
			},
		});

	const numeric = await invite(course.id);
	expect(numeric.status()).toBe(400);
	expect(await numeric.json()).toMatchObject({ code: "invalid-data" });

	const natural = await invite({
		discipline,
		instructor: instructor.username,
		edition,
	});
	expect(natural.status()).toBe(200);
});
