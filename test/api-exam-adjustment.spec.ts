import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedEditionFactory } from "@/fixtures/edition.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { idempotenceEssay } from "@/mdq/fixtures";
import { type APIRequestContext, expect, test } from "./fixtures";

/// `.../exam/[slug]/adjustment` over HTTP: who reads and writes, what each role sees, the conditional write and the course grades cell.

const PASSWORD = "correct-horse-battery-staple";
const STALE = '"2000-01-01T00:00:00.000Z"';

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

type User = Awaited<ReturnType<typeof makeUser>>;

async function loginHeaders(request: APIRequestContext, username: string) {
	const login = await request.post("/api/auth/login", {
		data: { login: username, password: PASSWORD },
	});
	expect(login.ok()).toBe(true);
	const { token } = await login.json();
	return { Authorization: `Bearer ${token}`, Cookie: "" };
}

async function keyHeaders(owner: User, kind: "BOT" | "CLI", name: string) {
	const key = await db.apiKey.create(
		{ name, kind, createdBy: { username: owner.username, name: owner.name } },
		{ actor: owner },
	);
	return { Authorization: `Bearer ${key.token}`, Cookie: "" };
}

/// A course with an instructor, an ongoing exam and a helper that enrolls a student with an attempt on it.
async function setup() {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		edition: (await persistedEditionFactory.create()).slug,
	});
	const base = `/api/course/${course.discipline.slug}/${course.instructor.username}_${course.edition.slug}`;
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: tag("exam-"),
		type: "EXAM",
		status: "ONGOING",
	});
	const student = async (attempt = true) => {
		const user = await makeUser("STUDENT");
		await db.enrollment.create(
			{ course: course.id, username: user.username },
			FULL_ACCESS,
		);
		if (attempt) {
			await persistedResponseFactory.create({
				course: course.id,
				exam: exam.slug,
				author: user.username,
			});
		}
		return user;
	};
	return {
		instructor,
		course,
		exam,
		student,
		base,
		url: `${base}/exam/${exam.slug}/adjustment`,
	};
}

type Ctx = Awaited<ReturnType<typeof setup>>;

/// Closes the exam and releases its grades.
function release(ctx: Ctx) {
	return prisma.exam.update({
		where: { id: ctx.exam.id },
		data: {
			status: "COMPLETED",
			gradesReleasedAt: new Date(Date.now() - 60_000),
		},
	});
}

/// Adjusts `usernames` through the API, as the holder of `headers`, and answers the created rows.
async function adjust(
	request: APIRequestContext,
	url: string,
	headers: Record<string, string>,
	usernames: string[],
	extra: Record<string, unknown> = {},
) {
	const res = await request.post(url, {
		headers,
		data: { usernames, op: "FACTOR", value: "0", ...extra },
	});
	expect(res.status()).toBe(200);
	return (await res.json()) as Array<{ publicId: string }>;
}

test("POST creates two adjustments with a CLI key, GET lists and reads them with notes and no raw id", async ({
	request,
}) => {
	const ctx = await setup();
	const ana = await ctx.student();
	const bia = await ctx.student();
	const headers = await keyHeaders(ctx.instructor, "CLI", "cli");

	const created = await adjust(
		request,
		ctx.url,
		headers,
		[ana.username, bia.username],
		{ reason: "plagiarism", notes: "same code as a classmate" },
	);
	expect(created).toHaveLength(2);
	expect(
		created.map((row) => (row as { author?: string }).author).sort(),
	).toEqual([ana.username, bia.username].sort());

	const list = await request.get(ctx.url, { headers });
	expect(list.status()).toBe(200);
	const page = await list.json();
	expect(page.items).toHaveLength(2);
	expect(page.next).toBeNull();
	expect(page.prev).toBeNull();
	expect(page.items[0]).toMatchObject({
		exam: ctx.exam.slug,
		question: null,
		op: "FACTOR",
		value: "0",
		reason: "plagiarism",
		notes: "same code as a classmate",
		createdBy: ctx.instructor.username,
		revokedAt: null,
		revokedBy: null,
	});
	expect(JSON.stringify(page)).not.toMatch(/"id"/);

	const one = await request.get(`${ctx.url}/${created[0]?.publicId}`, {
		headers,
	});
	expect(one.status()).toBe(200);
	expect(one.headers().etag).toBeTruthy();
	const body = await one.json();
	expect(body.publicId).toBe(created[0]?.publicId);
	expect(body.notes).toBe("same code as a classmate");
	expect(Object.keys(body)).not.toContain("id");
});

test("a batch with a student without an attempt is a 400 on usernames and the list stays empty", async ({
	request,
}) => {
	const ctx = await setup();
	const withAttempt = await ctx.student();
	const without = await ctx.student(false);
	const headers = await loginHeaders(request, ctx.instructor.username);

	const res = await request.post(ctx.url, {
		headers,
		data: {
			usernames: [withAttempt.username, without.username],
			op: "FACTOR",
			value: "0",
		},
	});

	expect(res.status()).toBe(400);
	const body = await res.json();
	expect(body.code).toBe("invalid-data");
	expect(JSON.stringify(body)).toContain("usernames");
	const list = await (await request.get(ctx.url, { headers })).json();
	expect(list.items).toEqual([]);
});

test("PATCH with a stale If-Match is a 412 and changes nothing; with the current ETag it is a 200 with a new ETag", async ({
	request,
}) => {
	const ctx = await setup();
	const ana = await ctx.student();
	const headers = await loginHeaders(request, ctx.instructor.username);
	const [created] = await adjust(request, ctx.url, headers, [ana.username], {
		reason: "first",
	});
	const item = `${ctx.url}/${created?.publicId}`;
	const etag = (await request.get(item, { headers })).headers().etag as string;

	const stale = await request.patch(item, {
		headers: { ...headers, "If-Match": STALE },
		data: { reason: "second" },
	});
	expect(stale.status()).toBe(412);
	expect((await (await request.get(item, { headers })).json()).reason).toBe(
		"first",
	);

	const fresh = await request.patch(item, {
		headers: { ...headers, "If-Match": etag },
		data: { reason: "second", value: "0.5", notes: "checked" },
	});
	expect(fresh.status()).toBe(200);
	expect(fresh.headers().etag).toBeTruthy();
	expect(fresh.headers().etag).not.toBe(etag);
	expect(await fresh.json()).toMatchObject({
		reason: "second",
		value: "0.5",
		notes: "checked",
	});
});

test("revoke answers the revoked adjustment; revoking again and patching it are 409s; ?revoked=true lists it, the default does not", async ({
	request,
}) => {
	const ctx = await setup();
	const ana = await ctx.student();
	const headers = await loginHeaders(request, ctx.instructor.username);
	const [created] = await adjust(request, ctx.url, headers, [ana.username]);
	const item = `${ctx.url}/${created?.publicId}`;

	const revoked = await request.post(`${item}/revoke`, { headers });
	expect(revoked.status()).toBe(200);
	const body = await revoked.json();
	expect(body.publicId).toBe(created?.publicId);
	expect(body.revokedAt).not.toBeNull();
	expect(body.revokedBy).toBe(ctx.instructor.username);

	expect((await request.post(`${item}/revoke`, { headers })).status()).toBe(
		409,
	);
	expect(
		(await request.patch(item, { headers, data: { reason: "late" } })).status(),
	).toBe(409);

	const active = await (await request.get(ctx.url, { headers })).json();
	expect(active.items).toEqual([]);
	const all = await (
		await request.get(`${ctx.url}?revoked=true`, { headers })
	).json();
	expect(all.items.map((row: { publicId: string }) => row.publicId)).toEqual([
		created?.publicId,
	]);
});

test("a publicId of another exam's adjustment under this exam is a 404", async ({
	request,
}) => {
	const ctx = await setup();
	const ana = await ctx.student();
	const headers = await loginHeaders(request, ctx.instructor.username);
	const otherExam = await persistedExamFactory.create({
		course: ctx.course.id,
		slug: tag("exam-"),
		type: "EXAM",
		status: "ONGOING",
	});
	await persistedResponseFactory.create({
		course: ctx.course.id,
		exam: otherExam.slug,
		author: ana.username,
	});
	const otherUrl = `${ctx.base}/exam/${otherExam.slug}/adjustment`;
	const [foreign] = await adjust(request, otherUrl, headers, [ana.username]);
	const crossed = `${ctx.url}/${foreign?.publicId}`;

	expect((await request.get(crossed, { headers })).status()).toBe(404);
	expect(
		(await request.patch(crossed, { headers, data: { reason: "x" } })).status(),
	).toBe(404);
	expect((await request.post(`${crossed}/revoke`, { headers })).status()).toBe(
		404,
	);
	expect(
		(
			await request.get(`${otherUrl}/${foreign?.publicId}`, { headers })
		).status(),
	).toBe(200);
});

test("a student sees an empty list and a 404 before the release, and after it reads their adjustment without notes, createdBy or revokedBy", async ({
	request,
}) => {
	const ctx = await setup();
	const ana = await ctx.student();
	const bia = await ctx.student();
	const owner = await loginHeaders(request, ctx.instructor.username);
	const [mine, theirs] = await adjust(
		request,
		ctx.url,
		owner,
		[ana.username, bia.username].sort(),
		{ reason: "copied", notes: "private evidence" },
	);
	const own =
		(await (await request.get(ctx.url, { headers: owner })).json()).items.find(
			(row: { author: string }) => row.author === ana.username,
		)?.publicId ?? mine?.publicId;
	const headers = await loginHeaders(request, ana.username);
	const item = `${ctx.url}/${own}`;

	const before = await request.get(ctx.url, { headers });
	expect(before.status()).toBe(200);
	expect((await before.json()).items).toEqual([]);
	expect((await request.get(item, { headers })).status()).toBe(404);

	await release(ctx);

	const after = await (await request.get(ctx.url, { headers })).json();
	expect(after.items).toHaveLength(1);
	expect(after.items[0]).toMatchObject({
		author: ana.username,
		reason: "copied",
		op: "FACTOR",
		value: "0",
	});
	expect(JSON.stringify(after)).not.toContain("private evidence");
	const read = await request.get(item, { headers });
	expect(read.status()).toBe(200);
	const body = await read.json();
	expect(body.reason).toBe("copied");
	for (const key of ["notes", "createdBy", "revokedBy", "id"]) {
		expect(Object.keys(body)).not.toContain(key);
	}

	const classmates = [mine, theirs].filter((row) => row?.publicId !== own);
	expect(
		(
			await request.get(`${ctx.url}/${classmates[0]?.publicId}`, { headers })
		).status(),
	).toBe(404);

	expect(
		(
			await request.post(ctx.url, {
				headers,
				data: { usernames: [ana.username], op: "FACTOR", value: "0" },
			})
		).status(),
	).toBe(403);
	expect(
		(await request.patch(item, { headers, data: { reason: "x" } })).status(),
	).toBe(403);
	expect((await request.post(`${item}/revoke`, { headers })).status()).toBe(
		403,
	);
	const kept = await (await request.get(item, { headers: owner })).json();
	expect(kept.revokedAt).toBeNull();
	expect(kept.reason).toBe("copied");
});

test("the instructor's BOT key and an instructor of another course are refused", async ({
	request,
}) => {
	const ctx = await setup();
	const ana = await ctx.student();
	const owner = await loginHeaders(request, ctx.instructor.username);
	await adjust(request, ctx.url, owner, [ana.username]);

	const bot = await keyHeaders(ctx.instructor, "BOT", "runner");
	const refused = await request.post(ctx.url, {
		headers: bot,
		data: { usernames: [ana.username], op: "FACTOR", value: "0" },
	});
	expect(refused.status()).toBe(403);

	const other = await makeUser("INSTRUCTOR");
	const stranger = await loginHeaders(request, other.username);
	expect((await request.get(ctx.url, { headers: stranger })).status()).toBe(
		403,
	);

	const list = await (await request.get(ctx.url, { headers: owner })).json();
	expect(list.items).toHaveLength(1);
});

test("GET /grades: a student zeroed by an adjustment has a cell with a total of 0; another student's cell keeps the total", async ({
	request,
}) => {
	const ctx = await setup();
	const question = await db.question.create(
		{
			course: ctx.course.id,
			slug: tag("q-"),
			status: "PUBLISHED",
			version: "1",
			question: idempotenceEssay,
		},
		FULL_ACCESS,
	);
	const exam = await persistedExamFactory.create({
		course: ctx.course.id,
		slug: tag("exam-"),
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: question.slug }],
	});
	const answered = async () => {
		const user = await makeUser("STUDENT");
		await db.enrollment.create(
			{ course: ctx.course.id, username: user.username },
			FULL_ACCESS,
		);
		const response = await db.response.submit(
			{
				course: ctx.course.id,
				exam: exam.slug,
				question: question.slug,
				payload: "An answer.",
			},
			{ actor: user },
		);
		await db.feedback.create(
			{
				submission: {
					publicId: response.submissions.at(-1)?.publicId ?? "",
				},
				ref: "pass-1",
				score: "1",
				grader: ctx.instructor.username,
			},
			FULL_ACCESS,
		);
		return user;
	};
	const zeroed = await answered();
	const untouched = await answered();
	await prisma.exam.update({
		where: { id: exam.id },
		data: { status: "COMPLETED" },
	});
	const headers = await loginHeaders(request, ctx.instructor.username);
	await adjust(
		request,
		`${ctx.base}/exam/${exam.slug}/adjustment`,
		headers,
		[zeroed.username],
		{ reason: "copied" },
	);

	const res = await request.get(`${ctx.base}/grades`, { headers });
	expect(res.status()).toBe(200);
	const report = await res.json();
	const cell = (username: string) =>
		report.students.find(
			(row: { username: string }) => row.username === username,
		)?.results[exam.slug];

	expect(cell(zeroed.username)).toMatchObject({ kind: "total", total: 0 });
	expect(cell(untouched.username)).toMatchObject({ kind: "total", total: 1 });
});

test("POST an OFFSET adjustment answers the created row with op and value; the list and the item carry them", async ({
	request,
}) => {
	const ctx = await setup();
	const ana = await ctx.student();
	const headers = await loginHeaders(request, ctx.instructor.username);

	const res = await request.post(ctx.url, {
		headers,
		data: { usernames: [ana.username], op: "OFFSET", value: "0.1" },
	});

	expect(res.status()).toBe(200);
	const [created] = await res.json();
	expect(created).toMatchObject({
		author: ana.username,
		question: null,
		op: "OFFSET",
		value: "0.1",
	});
	const item = await request.get(`${ctx.url}/${created.publicId}`, { headers });
	expect(await item.json()).toMatchObject({ op: "OFFSET", value: "0.1" });
});

test("POST a SET above 1 is a 400 keyed on value and creates nothing", async ({
	request,
}) => {
	const ctx = await setup();
	const ana = await ctx.student();
	const headers = await loginHeaders(request, ctx.instructor.username);

	const res = await request.post(ctx.url, {
		headers,
		data: { usernames: [ana.username], op: "SET", value: "1.5" },
	});

	expect(res.status()).toBe(400);
	const body = await res.json();
	expect(body.code).toBe("invalid-data");
	expect(JSON.stringify(body)).toContain("value");
	const list = await (await request.get(ctx.url, { headers })).json();
	expect(list.items).toEqual([]);
});

test("POST an OFFSET on a question is a 400 keyed on op", async ({
	request,
}) => {
	const ctx = await setup();
	const ana = await ctx.student();
	const headers = await loginHeaders(request, ctx.instructor.username);
	const question = await db.question.create(
		{
			course: ctx.course.id,
			slug: tag("q-"),
			status: "PUBLISHED",
			version: "1",
			question: idempotenceEssay,
		},
		FULL_ACCESS,
	);
	const exam = await persistedExamFactory.create({
		course: ctx.course.id,
		slug: tag("exam-"),
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: question.slug }],
	});
	await persistedResponseFactory.create({
		course: ctx.course.id,
		exam: exam.slug,
		author: ana.username,
	});
	const url = `${ctx.base}/exam/${exam.slug}/adjustment`;

	const res = await request.post(url, {
		headers,
		data: {
			usernames: [ana.username],
			question: question.slug,
			op: "OFFSET",
			value: "0.1",
		},
	});

	expect(res.status()).toBe(400);
	const body = await res.json();
	expect(body.code).toBe("invalid-data");
	expect(JSON.stringify(body)).toContain("op");
	const list = await (await request.get(url, { headers })).json();
	expect(list.items).toEqual([]);
});

test("a second active SET for the same student is a 400 keyed on usernames; after revoking the first, a new SET is accepted", async ({
	request,
}) => {
	const ctx = await setup();
	const ana = await ctx.student();
	const headers = await loginHeaders(request, ctx.instructor.username);
	const set = { usernames: [ana.username], op: "SET", value: "0.8" };
	const first = await request.post(ctx.url, { headers, data: set });
	expect(first.status()).toBe(200);
	const [created] = await first.json();

	const second = await request.post(ctx.url, { headers, data: set });

	expect(second.status()).toBe(400);
	const body = await second.json();
	expect(body.code).toBe("invalid-data");
	expect(JSON.stringify(body)).toContain("usernames");
	const list = await (await request.get(ctx.url, { headers })).json();
	expect(list.items).toHaveLength(1);

	await request.post(`${ctx.url}/${created.publicId}/revoke`, { headers });
	const third = await request.post(ctx.url, { headers, data: set });
	expect(third.status()).toBe(200);
});

test("a student reads an OFFSET adjustment with op and value after the release and nothing before it", async ({
	request,
}) => {
	const ctx = await setup();
	const ana = await ctx.student();
	const owner = await loginHeaders(request, ctx.instructor.username);
	await request.post(ctx.url, {
		headers: owner,
		data: {
			usernames: [ana.username],
			op: "OFFSET",
			value: "-0.1",
			reason: "late",
			notes: "private",
		},
	});
	const headers = await loginHeaders(request, ana.username);

	const before = await (await request.get(ctx.url, { headers })).json();
	expect(before.items).toEqual([]);

	await release(ctx);

	const after = await (await request.get(ctx.url, { headers })).json();
	expect(after.items).toHaveLength(1);
	expect(after.items[0]).toMatchObject({
		op: "OFFSET",
		value: "-0.1",
		reason: "late",
	});
	expect(JSON.stringify(after)).not.toContain("private");
});

test("PATCH changes op and value of an adjustment", async ({ request }) => {
	const ctx = await setup();
	const ana = await ctx.student();
	const headers = await loginHeaders(request, ctx.instructor.username);
	const [created] = await adjust(request, ctx.url, headers, [ana.username]);
	const item = `${ctx.url}/${created?.publicId}`;
	const etag = (await request.get(item, { headers })).headers().etag as string;

	const res = await request.patch(item, {
		headers: { ...headers, "If-Match": etag },
		data: { op: "OFFSET", value: "0.2" },
	});

	expect(res.status()).toBe(200);
	expect(await res.json()).toMatchObject({ op: "OFFSET", value: "0.2" });
});

test("the old /sanction routes are gone: list, create, read, patch and revoke are all 404", async ({
	request,
}) => {
	const ctx = await setup();
	const ana = await ctx.student();
	const headers = await loginHeaders(request, ctx.instructor.username);
	const [created] = await adjust(request, ctx.url, headers, [ana.username]);
	const old = ctx.url.replace(/\/adjustment$/, "/sanction");
	const item = `${old}/${created?.publicId}`;

	expect((await request.get(old, { headers })).status()).toBe(404);
	expect(
		(
			await request.post(old, {
				headers,
				data: { usernames: [ana.username], op: "FACTOR", value: "0" },
			})
		).status(),
	).toBe(404);
	expect((await request.get(item, { headers })).status()).toBe(404);
	expect(
		(await request.patch(item, { headers, data: { reason: "x" } })).status(),
	).toBe(404);
	expect((await request.post(`${item}/revoke`, { headers })).status()).toBe(
		404,
	);
});
