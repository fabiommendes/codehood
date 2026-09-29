import { type APIRequestContext, expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db, type schema } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";

/**
 * `gradesReleasedAt` is set by the release feature, never through the exam's
 * own create or update inputs: it must be readable everywhere an exam is
 * returned, and unwritable through every input.
 */

const RELEASED = new Date("2026-05-01T12:00:00.000Z");
const ATTEMPT = new Date("2027-01-01T00:00:00.000Z");
const PASSWORD = "correct-horse-battery-staple";

function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

async function makeExam(
	courseId: schema.CourseId,
	gradesReleasedAt: Date | null = null,
) {
	const exam = await db.exam.create(
		{ course: courseId, slug: tag("exam-"), title: "Exam", status: "ONGOING" },
		FULL_ACCESS,
	);
	if (gradesReleasedAt) {
		await prisma.exam.update({
			where: { id: exam.id },
			data: { gradesReleasedAt },
		});
	}
	return exam;
}

async function storedRelease(examId: schema.ExamId): Promise<Date | null> {
	const row = await prisma.exam.findUniqueOrThrow({ where: { id: examId } });
	return row.gradesReleasedAt;
}

/// Runs `call`, treating a refusal as fine: the spec accepts an error or a no-op.
async function attempt(call: () => Promise<unknown>): Promise<void> {
	await call().catch(() => undefined);
}

//
// Reading
//

test("service: findOne returns gradesReleasedAt null by default", async () => {
	const course = await persistedCourseFactory.create();
	const exam = await makeExam(course.id);

	const found = await db.exam.findOne(
		{ course: course.id, slug: exam.slug },
		FULL_ACCESS,
	);

	expect(found).toHaveProperty("gradesReleasedAt", null);
});

test("service: findOne returns the gradesReleasedAt set through Prisma", async () => {
	const course = await persistedCourseFactory.create();
	const exam = await makeExam(course.id, RELEASED);

	const found = await db.exam.findOne(
		{ course: course.id, slug: exam.slug },
		FULL_ACCESS,
	);

	expect(found?.gradesReleasedAt).toEqual(RELEASED);
});

test("service: findMany returns gradesReleasedAt for released and unreleased exams", async () => {
	const course = await persistedCourseFactory.create();
	const plain = await makeExam(course.id);
	const released = await makeExam(course.id, RELEASED);

	const exams = await db.exam.findMany({ course: course.id }, FULL_ACCESS);

	const bySlug = new Map(exams.map((e) => [e.slug, e]));
	expect(bySlug.get(plain.slug)).toHaveProperty("gradesReleasedAt", null);
	expect(bySlug.get(released.slug)?.gradesReleasedAt).toEqual(RELEASED);
});

//
// Writing through the service
//

test("service: create ignores or refuses gradesReleasedAt", async () => {
	const course = await persistedCourseFactory.create();
	const slug = tag("exam-");

	await attempt(() =>
		db.exam.create(
			{
				course: course.id,
				slug,
				title: "Sneaky",
				gradesReleasedAt: ATTEMPT,
				// biome-ignore lint/suspicious/noExplicitAny: a field the create schema must not accept
			} as any,
			FULL_ACCESS,
		),
	);

	const row = await prisma.exam.findFirst({
		where: { slug, courseId: course.id },
	});
	expect(row?.gradesReleasedAt ?? null).toBeNull();
});

test("service: update cannot set gradesReleasedAt on an unreleased exam", async () => {
	const course = await persistedCourseFactory.create();
	const exam = await makeExam(course.id);

	await attempt(() =>
		db.exam.update(
			{ course: course.id, slug: exam.slug },
			// biome-ignore lint/suspicious/noExplicitAny: a field the update schema must not accept
			{ title: "Renamed", gradesReleasedAt: ATTEMPT } as any,
			FULL_ACCESS,
		),
	);

	expect(await storedRelease(exam.id)).toBeNull();
});

test("service: update cannot change or clear an existing gradesReleasedAt", async () => {
	const course = await persistedCourseFactory.create();
	const exam = await makeExam(course.id, RELEASED);

	await attempt(() =>
		db.exam.update(
			{ course: course.id, slug: exam.slug },
			// biome-ignore lint/suspicious/noExplicitAny: a field the update schema must not accept
			{ gradesReleasedAt: ATTEMPT } as any,
			FULL_ACCESS,
		),
	);
	expect(await storedRelease(exam.id)).toEqual(RELEASED);

	await attempt(() =>
		db.exam.update(
			{ course: course.id, slug: exam.slug },
			// biome-ignore lint/suspicious/noExplicitAny: a field the update schema must not accept
			{ gradesReleasedAt: null } as any,
			FULL_ACCESS,
		),
	);
	expect(await storedRelease(exam.id)).toEqual(RELEASED);
});

test("service: an ordinary update leaves gradesReleasedAt untouched", async () => {
	const course = await persistedCourseFactory.create();
	const exam = await makeExam(course.id, RELEASED);

	await db.exam.update(
		{ course: course.id, slug: exam.slug },
		{ title: "Renamed" },
		FULL_ACCESS,
	);

	expect(await storedRelease(exam.id)).toEqual(RELEASED);
});

test("service: upsert cannot set gradesReleasedAt when it creates", async () => {
	const course = await persistedCourseFactory.create();
	const slug = tag("exam-");

	await attempt(() =>
		db.exam.upsert(
			{
				course: course.id,
				slug,
				title: "Sneaky",
				gradesReleasedAt: ATTEMPT,
				// biome-ignore lint/suspicious/noExplicitAny: a field the create schema must not accept
			} as any,
			FULL_ACCESS,
		),
	);

	const row = await prisma.exam.findFirst({
		where: { slug, courseId: course.id },
	});
	expect(row?.gradesReleasedAt ?? null).toBeNull();
});

test("service: upsert cannot change gradesReleasedAt when it updates", async () => {
	const course = await persistedCourseFactory.create();
	const exam = await makeExam(course.id, RELEASED);

	await attempt(() =>
		db.exam.upsert(
			{
				course: course.id,
				slug: exam.slug,
				title: "Renamed",
				gradesReleasedAt: ATTEMPT,
				// biome-ignore lint/suspicious/noExplicitAny: a field the create schema must not accept
			} as any,
			FULL_ACCESS,
		),
	);

	expect(await storedRelease(exam.id)).toEqual(RELEASED);
});

//
// REST
//

async function restCourse(request: APIRequestContext) {
	const instructor = await db.user.create(
		{
			email: `${tag("inst")}@codehood.test`,
			username: tag("instructor"),
			name: "Instructor",
			role: "INSTRUCTOR",
			password: PASSWORD,
			githubId: tag("gh"),
			schoolId: tag("sch"),
		},
		FULL_ACCESS,
	);
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
	});
	const login = await request.post("/api/auth/login", {
		data: { login: instructor.username, password: PASSWORD },
	});
	expect(login.ok()).toBe(true);
	const { token } = await login.json();
	const url = `/api/course/${course.discipline.slug}/${instructor.username}_${course.edition.slug}/exam`;
	return { course, url, headers: { Authorization: `Bearer ${token}` } };
}

test("REST: an exam carries gradesReleasedAt, null by default", async ({
	request,
}) => {
	const { url, headers } = await restCourse(request);

	const created = await request.post(url, {
		headers,
		data: { slug: "plain", title: "Plain" },
	});
	expect(created.status()).toBe(200);
	expect(await created.json()).toHaveProperty("gradesReleasedAt", null);

	const read = await request.get(`${url}/plain`, { headers });
	expect(await read.json()).toHaveProperty("gradesReleasedAt", null);

	const list = await request.get(url, { headers });
	const [only] = await list.json();
	expect(only).toHaveProperty("gradesReleasedAt", null);
});

test("REST: an exam reads back the gradesReleasedAt set through Prisma", async ({
	request,
}) => {
	const { url, headers, course } = await restCourse(request);
	await request.post(url, {
		headers,
		data: { slug: "released", title: "Released" },
	});
	await prisma.exam.updateMany({
		where: { courseId: course.id, slug: "released" },
		data: { gradesReleasedAt: RELEASED },
	});

	const read = await request.get(`${url}/released`, { headers });
	expect((await read.json()).gradesReleasedAt).toBe(RELEASED.toISOString());

	const list = await request.get(url, { headers });
	const [only] = await list.json();
	expect(only.gradesReleasedAt).toBe(RELEASED.toISOString());
});

test("REST: POST cannot set gradesReleasedAt", async ({ request }) => {
	const { url, headers, course } = await restCourse(request);

	await request.post(url, {
		headers,
		data: { slug: "sneaky", title: "Sneaky", gradesReleasedAt: ATTEMPT },
	});

	const row = await prisma.exam.findFirst({
		where: { courseId: course.id, slug: "sneaky" },
	});
	expect(row?.gradesReleasedAt ?? null).toBeNull();
});

test("REST: PATCH cannot set or change gradesReleasedAt", async ({
	request,
}) => {
	const { url, headers, course } = await restCourse(request);
	await request.post(url, { headers, data: { slug: "one", title: "One" } });
	await request.post(url, { headers, data: { slug: "two", title: "Two" } });
	await prisma.exam.updateMany({
		where: { courseId: course.id, slug: "two" },
		data: { gradesReleasedAt: RELEASED },
	});

	await request.patch(`${url}/one`, {
		headers,
		data: { title: "One!", gradesReleasedAt: ATTEMPT },
	});
	await request.patch(`${url}/two`, {
		headers,
		data: { title: "Two!", gradesReleasedAt: ATTEMPT },
	});

	const one = await prisma.exam.findFirstOrThrow({
		where: { courseId: course.id, slug: "one" },
	});
	const two = await prisma.exam.findFirstOrThrow({
		where: { courseId: course.id, slug: "two" },
	});
	expect(one.gradesReleasedAt).toBeNull();
	expect(two.gradesReleasedAt).toEqual(RELEASED);
});
