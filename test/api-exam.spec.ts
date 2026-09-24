import { type APIRequestContext, expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";

/**
 * Exams are addressed under their course's natural key,
 * `/api/course/<discipline>/<instructor>_<edition>/exam[/<slug>]`. Lengths of
 * time travel as `{ hours, minutes }` rather than milliseconds.
 */

function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

const PASSWORD = "correct-horse-battery-staple";

async function makeInstructor() {
	const username = tag("instructor");
	return db.user.create(
		{
			email: `${username}@codehood.test`,
			username,
			name: username,
			role: "INSTRUCTOR",
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

/** A fresh course taught by a fresh instructor, its exam URL and auth headers. */
async function makeCourse(request: APIRequestContext) {
	const instructor = await makeInstructor();
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
	const url = `/api/course/${discipline}/${instructor.username}_2026-1/exam`;
	const headers = await tokenFor(request, instructor.username);
	return { instructor, course, url, headers };
}

test("POST defaults format to MARKDOWN and leaves an exam untimed with no extra time", async ({
	request,
}) => {
	const { url, headers } = await makeCourse(request);

	const res = await request.post(url, {
		headers,
		data: { slug: "quiz-1", title: "Quiz 1" },
	});
	expect(res.status()).toBe(200);
	const exam = await res.json();
	expect(exam.format).toBe("MARKDOWN");
	expect(exam.duration).toBeNull();
	expect(exam.extraTime).toBeNull();
	expect(exam).not.toHaveProperty("durationMs");
	expect(exam).not.toHaveProperty("extraTimeMs");
});

test("POST takes a duration as hours and minutes and reads it back normalized", async ({
	request,
}) => {
	const { url, headers } = await makeCourse(request);

	const created = await request.post(url, {
		headers,
		data: { slug: "final", title: "Final", duration: { minutes: 150 } },
	});
	expect(created.status()).toBe(200);
	expect((await created.json()).duration).toEqual({ hours: 2, minutes: 30 });

	const read = await request.get(`${url}/final`, { headers });
	expect((await read.json()).duration).toEqual({ hours: 2, minutes: 30 });
});

test("POST refuses a zero-length duration", async ({ request }) => {
	const { url, headers } = await makeCourse(request);

	const res = await request.post(url, {
		headers,
		data: { slug: "empty", title: "Empty", duration: { hours: 0 } },
	});
	expect(res.status()).toBe(400);
});

test("POST ignores extraTime: it is only granted on update", async ({
	request,
}) => {
	const { url, headers } = await makeCourse(request);

	const res = await request.post(url, {
		headers,
		data: { slug: "quiz-2", title: "Quiz 2", extraTime: { minutes: 10 } },
	});
	expect(res.status()).toBe(200);
	expect((await res.json()).extraTime).toBeNull();
});

test("PATCH sets and clears duration and extraTime", async ({ request }) => {
	const { url, headers } = await makeCourse(request);
	await request.post(url, {
		headers,
		data: { slug: "midterm", title: "Midterm", duration: { hours: 1 } },
	});

	const granted = await request.patch(`${url}/midterm`, {
		headers,
		data: { duration: { hours: 1, minutes: 30 }, extraTime: { minutes: 15 } },
	});
	expect(granted.status()).toBe(200);
	const withExtra = await granted.json();
	expect(withExtra.duration).toEqual({ hours: 1, minutes: 30 });
	expect(withExtra.extraTime).toEqual({ hours: 0, minutes: 15 });

	const cleared = await request.patch(`${url}/midterm`, {
		headers,
		data: { duration: null, extraTime: null },
	});
	expect(cleared.status()).toBe(200);
	const untimed = await cleared.json();
	expect(untimed.duration).toBeNull();
	expect(untimed.extraTime).toBeNull();
});

test("GET narrows the list with ?exams=", async ({ request }) => {
	const { url, headers } = await makeCourse(request);
	for (const slug of ["alpha", "beta", "gamma"]) {
		await request.post(url, { headers, data: { slug, title: slug } });
	}

	const res = await request.get(`${url}?exams=alpha&exams=gamma`, {
		headers,
	});
	expect(res.status()).toBe(200);
	expect((await res.json()).map((e: { slug: string }) => e.slug)).toEqual([
		"alpha",
		"gamma",
	]);
});

test("GET list query cannot redirect to another course", async ({
	request,
}) => {
	const mine = await makeCourse(request);
	const other = await makeCourse(request);
	await db.exam.create(
		{ course: other.course.id, slug: "theirs", title: "Theirs" },
		FULL_ACCESS,
	);

	const qs = new URLSearchParams({
		discipline: other.course.discipline.slug,
		instructor: other.instructor.username,
		edition: "2026-1",
		courseId: String(other.course.id),
	}).toString();
	const res = await request.get(`${mine.url}?${qs}`, { headers: mine.headers });
	expect(res.status()).toBe(200);
	expect(await res.json()).toEqual([]);
});

test("service findMany narrows by exams within a course given by id", async () => {
	const instructor = await makeInstructor();
	const course = await db.course.create(
		{
			discipline: (
				await db.discipline.create(
					{ slug: tag("disc"), name: "d" },
					FULL_ACCESS,
				)
			).slug,
			instructor: instructor.username,
			edition: "2026-1",
			startAt: new Date("2026-01-01"),
			endAt: new Date("2030-05-01"),
		},
		FULL_ACCESS,
	);
	for (const slug of ["one", "two"]) {
		await db.exam.create({ course: course.id, slug, title: slug }, FULL_ACCESS);
	}

	const found = await db.exam.findMany(
		{ course: course.id, exams: ["two"] },
		FULL_ACCESS,
	);
	expect(found.map((e) => e.slug)).toEqual(["two"]);
});

test("OpenAPI list operation documents exams but no course keys", async ({
	request,
}) => {
	const doc = await (await request.get("/openapi.json")).json();
	const params: { name: string }[] =
		doc.paths["/api/course/{discipline}/{course}/exam"].get.parameters;
	const query = params
		.filter((p) => (p as { in?: string }).in === "query")
		.map((p) => p.name);
	expect(query).toContain("exams");
	expect(query).not.toContain("slugs");
	for (const key of ["courseId", "discipline", "instructor", "edition"]) {
		expect(query).not.toContain(key);
	}
});
