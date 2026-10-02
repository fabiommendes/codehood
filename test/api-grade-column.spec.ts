import { type APIRequestContext, expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedExamFactory } from "@/fixtures/exam.factory";

/// Grade columns and the grades report over HTTP, under the course's natural key.

function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

const PASSWORD = "correct-horse-battery-staple";

async function makeUser(role: "INSTRUCTOR" | "STUDENT", name?: string) {
	const username = tag(role.toLowerCase());
	return db.user.create(
		{
			email: `${username}@codehood.test`,
			username,
			name: name ?? username,
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

/** A fresh course with `n` enrolled students, and its REST URLs. */
async function makeCourse(n = 2) {
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
	const students = [];
	for (let i = 0; i < n; i++) {
		const student = await makeUser("STUDENT");
		await db.enrollment.create(
			{ course: course.id, username: student.username },
			FULL_ACCESS,
		);
		students.push(student);
	}
	const base = `/api/course/${discipline}/${instructor.username}_2026-1`;
	return {
		instructor,
		course,
		students: students as [
			(typeof students)[number],
			(typeof students)[number],
			(typeof students)[number],
		],
		url: `${base}/grade-column`,
		gradesUrl: `${base}/grades`,
		discipline,
		opts: { actor: instructor },
	};
}

function body(
	values: { username: string; value: number | string }[],
	extra: Record<string, unknown> = {},
) {
	return {
		slug: "final",
		title: "Final grade",
		kind: "NUMBER",
		position: 1,
		rev: "r1",
		values,
		...extra,
	};
}

test("PUT creates a column and GET returns it hidden, values ordered by username, with no id or courseId", async ({
	request,
}) => {
	const { instructor, students, url } = await makeCourse(2);
	const headers = await tokenFor(request, instructor.username);
	const [a, b] = students.map((s) => s.username).sort();

	const put = await request.put(url, {
		headers,
		data: body([
			{ username: b as string, value: 2 },
			{ username: a as string, value: 1 },
		]),
	});
	expect(put.status()).toBe(200);

	const got = await request.get(`${url}/final`, { headers });
	expect(got.status()).toBe(200);
	const column = await got.json();
	expect(column).toMatchObject({
		slug: "final",
		title: "Final grade",
		kind: "NUMBER",
		position: 1,
		rev: "r1",
		releasedAt: null,
	});
	expect(column.values).toEqual([
		{ username: a, value: 1 },
		{ username: b, value: 2 },
	]);
	expect(JSON.stringify(column)).not.toMatch(/"(id|courseId)"/);
});

test("a second PUT with the same slug replaces title, position, rev and the values whole", async ({
	request,
}) => {
	const { instructor, students, url } = await makeCourse(2);
	const headers = await tokenFor(request, instructor.username);
	const [a, b] = students;
	await request.put(url, {
		headers,
		data: body([
			{ username: a.username, value: 1 },
			{ username: b.username, value: 2 },
		]),
	});

	const again = await request.put(url, {
		headers,
		data: body([{ username: a.username, value: 9 }], {
			title: "Renamed",
			position: 4,
			rev: "r2",
		}),
	});
	expect(again.status()).toBe(200);

	const column = await (await request.get(`${url}/final`, { headers })).json();
	expect(column).toMatchObject({ title: "Renamed", position: 4, rev: "r2" });
	expect(column.values).toEqual([{ username: a.username, value: 9 }]);
	expect(await (await request.get(url, { headers })).json()).toHaveLength(1);
});

test("PATCH with only a title keeps the values, and DELETE removes the column", async ({
	request,
}) => {
	const { instructor, students, url } = await makeCourse(1);
	const headers = await tokenFor(request, instructor.username);
	const [a] = students;
	await request.put(url, {
		headers,
		data: body([{ username: a.username, value: 5 }]),
	});

	const patched = await request.patch(`${url}/final`, {
		headers,
		data: { title: "Only the title" },
	});
	expect(patched.status()).toBe(200);
	const column = await (await request.get(`${url}/final`, { headers })).json();
	expect(column.title).toBe("Only the title");
	expect(column.values).toEqual([{ username: a.username, value: 5 }]);

	const deleted = await request.delete(`${url}/final`, { headers });
	expect(deleted.status()).toBe(200);
	expect((await request.get(`${url}/final`, { headers })).status()).toBe(404);
});

test("a PUT with a value that does not fit the kind, or an unenrolled username, is a 400 invalid-data and writes nothing", async ({
	request,
}) => {
	const { instructor, students, url, course, opts } = await makeCourse(1);
	const headers = await tokenFor(request, instructor.username);
	const [a] = students;
	const outsider = await makeUser("STUDENT");
	// A valid write first, so a server that refuses everything cannot pass.
	await request.put(url, {
		headers,
		data: body([{ username: a.username, value: 1 }], { slug: "kept" }),
	});

	const wrongKind = await request.put(url, {
		headers,
		data: body([{ username: a.username, value: "ten" }]),
	});
	expect(wrongKind.status()).toBe(400);
	expect((await wrongKind.json()).code).toBe("invalid-data");

	const unenrolled = await request.put(url, {
		headers,
		data: body([{ username: outsider.username, value: 3 }]),
	});
	expect(unenrolled.status()).toBe(400);
	expect((await unenrolled.json()).code).toBe("invalid-data");

	const listed = await db.gradeColumn.findMany({ course: course.id }, opts);
	expect(listed.map((c) => c.slug)).toEqual(["kept"]);
});

test("a PUT or PATCH body carrying releasedAt leaves releasedAt null", async ({
	request,
}) => {
	const { instructor, students, url } = await makeCourse(1);
	const headers = await tokenFor(request, instructor.username);
	const values = [{ username: students[0].username, value: 1 }];
	const releasedAt = "2026-02-01T00:00:00.000Z";

	const put = await request.put(url, {
		headers,
		data: body(values, { releasedAt }),
	});
	expect(put.status()).toBe(200);
	expect((await put.json()).releasedAt).toBeNull();

	const patch = await request.patch(`${url}/final`, {
		headers,
		data: { title: "Again", releasedAt },
	});
	expect(patch.status()).toBe(200);
	const column = await (await request.get(`${url}/final`, { headers })).json();
	expect(column.releasedAt).toBeNull();
});

test("an enrolled student lists released columns with their own value, gets 404 on a hidden one, is refused writes, and cannot release over the API", async ({
	request,
}) => {
	const { instructor, students, url, course, opts } = await makeCourse(2);
	const [a, b] = students;
	const values = [
		{ username: a.username, value: 10 },
		{ username: b.username, value: 20 },
	];
	await db.gradeColumn.create(
		{ course: course.id, ...body(values, { slug: "hidden" }) } as never,
		opts,
	);
	await db.gradeColumn.create(
		{ course: course.id, ...body(values, { slug: "shown" }) } as never,
		opts,
	);
	await db.gradeColumn.release({ course: course.id, slug: "shown" }, opts);
	const headers = await tokenFor(request, a.username);
	expect(instructor.username).toBeTruthy();

	const list = await request.get(url, { headers });
	expect(list.status()).toBe(200);
	const listed = await list.json();
	expect(listed.map((c: { slug: string }) => c.slug)).toEqual(["shown"]);
	expect(listed[0].values).toEqual([{ username: a.username, value: 10 }]);

	expect((await request.get(`${url}/hidden`, { headers })).status()).toBe(404);
	expect((await request.get(`${url}/shown`, { headers })).status()).toBe(200);

	expect(
		(await request.put(url, { headers, data: body(values) })).status(),
	).toBe(403);
	expect(
		(
			await request.patch(`${url}/hidden`, {
				headers,
				data: { title: "Hacked" },
			})
		).status(),
	).toBe(403);
	expect((await request.delete(`${url}/hidden`, { headers })).status()).toBe(
		403,
	);

	for (const method of ["post", "put"] as const) {
		const res = await request[method](`${url}/hidden/release`, { headers });
		expect([404, 405]).toContain(res.status());
		const asTeacher = await request[method](`${url}/hidden/release`, {
			headers: await tokenFor(request, instructor.username),
		});
		expect([404, 405]).toContain(asTeacher.status());
	}
	const still = await db.gradeColumn.findOne(
		{ course: course.id, slug: "hidden" },
		opts,
	);
	expect(still?.releasedAt).toBeNull();
});

test("a user with no relation to the course is refused on the collection GET", async ({
	request,
}) => {
	const { students, url, course, opts } = await makeCourse(1);
	await db.gradeColumn.create(
		{
			course: course.id,
			...body([{ username: students[0].username, value: 1 }]),
		} as never,
		opts,
	);
	const outsider = await makeUser("STUDENT");
	const headers = await tokenFor(request, outsider.username);

	expect((await request.get(url, { headers })).status()).toBe(403);
});

//
// GET .../grades
//

test("GET grades as the instructor lists the shown exams and every enrollment, the dropped one included, with a result per exam", async ({
	request,
}) => {
	const { instructor, students, course, gradesUrl } = await makeCourse(2);
	const [a, dropped] = students;
	await db.enrollment.delete(
		{ course: course.id, username: dropped.username },
		FULL_ACCESS,
	);
	await persistedExamFactory.create({
		course: course.id,
		slug: "closed-exam",
		title: "Closed exam",
		type: "EXAM",
		status: "COMPLETED",
		scheduledAt: new Date(Date.now() - 10 * 24 * 60 * 60_000),
	});
	await persistedExamFactory.create({
		course: course.id,
		slug: "later-exam",
		title: "Later exam",
		type: "EXAM",
		status: "SCHEDULED",
		scheduledAt: new Date(Date.now() + 10 * 24 * 60 * 60_000),
	});
	await persistedExamFactory.create({
		course: course.id,
		slug: "draft-exam",
		title: "Draft exam",
		type: "EXAM",
		status: "DRAFT",
	});
	const headers = await tokenFor(request, instructor.username);

	const res = await request.get(gradesUrl, { headers });

	expect(res.status()).toBe(200);
	const report = await res.json();
	expect(report.exams.map((e: { slug: string }) => e.slug).sort()).toEqual([
		"closed-exam",
		"later-exam",
	]);
	expect(
		report.students.map((s: { username: string }) => s.username).sort(),
	).toEqual([a.username, dropped.username].sort());
	const droppedRow = report.students.find(
		(s: { username: string }) => s.username === dropped.username,
	);
	expect(droppedRow).toMatchObject({
		status: "DROPPED",
		name: dropped.name,
		email: dropped.email,
		schoolId: dropped.schoolId,
		githubId: dropped.githubId,
	});
	for (const student of report.students) {
		expect(student.status).toBeDefined();
		expect(Object.keys(student.results).sort()).toEqual([
			"closed-exam",
			"later-exam",
		]);
		expect(student.results["closed-exam"]).toEqual({ kind: "missed" });
		expect(student.results["later-exam"]).toEqual({ kind: "empty" });
	}
});

test("GET grades is 403 for an enrolled student and an unrelated user, and 404 for a course that does not exist", async ({
	request,
}) => {
	const { instructor, students, gradesUrl } = await makeCourse(1);
	const outsider = await makeUser("STUDENT");
	const mine = await tokenFor(request, instructor.username);
	const ghost = gradesUrl.replace(
		/\/api\/course\/[^/]+\//,
		`/api/course/${tag("nope")}/`,
	);

	// The instructor reads it, so a server that refuses everything cannot pass.
	expect((await request.get(gradesUrl, { headers: mine })).status()).toBe(200);
	expect(
		(
			await request.get(gradesUrl, {
				headers: await tokenFor(request, students[0].username),
			})
		).status(),
	).toBe(403);
	expect(
		(
			await request.get(gradesUrl, {
				headers: await tokenFor(request, outsider.username),
			})
		).status(),
	).toBe(403);
	expect((await request.get(ghost, { headers: mine })).status()).toBe(404);
});

test("openapi.json documents the grade-column collection and item and the grades endpoint", async ({
	request,
}) => {
	const res = await request.get("/openapi.json");
	expect(res.ok()).toBe(true);
	const paths = Object.keys((await res.json()).paths);

	expect(paths.some((p) => p.endsWith("/grade-column"))).toBe(true);
	expect(paths.some((p) => p.endsWith("/grade-column/{slug}"))).toBe(true);
	expect(paths.some((p) => p.endsWith("/grades"))).toBe(true);
	expect(paths.some((p) => p.includes("/grade-column/{slug}/release"))).toBe(
		false,
	);
});
