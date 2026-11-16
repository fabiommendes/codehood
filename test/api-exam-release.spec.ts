import { FULL_ACCESS } from "@/auth/actor";
import { db, type schema } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedEditionFactory } from "@/fixtures/edition.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { idempotenceEssay } from "@/mdq/fixtures";
import { type APIRequestContext, expect, test } from "./fixtures";

/// `POST .../exam/[slug]/release` over HTTP: who may call it, what it answers and when it refuses.

const PASSWORD = "correct-horse-battery-staple";
const HOUR = 3_600_000;

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

async function loginHeaders(request: APIRequestContext, username: string) {
	const login = await request.post("/api/auth/login", {
		data: { login: username, password: PASSWORD },
	});
	expect(login.ok()).toBe(true);
	const { token } = await login.json();
	return { Authorization: `Bearer ${token}`, Cookie: "" };
}

async function keyHeaders(
	owner: Awaited<ReturnType<typeof makeUser>>,
	kind: "BOT" | "CLI",
	name: string,
) {
	const key = await db.apiKey.create(
		{ name, kind, createdBy: { username: owner.username, name: owner.name } },
		{ actor: owner },
	);
	return { Authorization: `Bearer ${key.token}`, Cookie: "" };
}

interface Shape {
	type?: "EXAM" | "QUIZ";
	status?: "ONGOING" | "COMPLETED";
	/// Leaves the student's essay answer without a grade.
	pendingAnswer?: boolean;
	/// Grants the student a makeup that has not started.
	openException?: boolean;
}

/// A course with one enrolled student and an exam in `shape`, plus the exam's REST URLs.
async function setup(shape: Shape = {}) {
	const instructor = await makeUser("INSTRUCTOR");
	const student = await makeUser("STUDENT");
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		edition: (await persistedEditionFactory.create()).slug,
	});
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	const question = shape.pendingAnswer
		? await db.question.create(
				{
					course: course.id,
					slug: tag("q-"),
					status: "PUBLISHED",
					version: "1",
					question: idempotenceEssay,
				},
				FULL_ACCESS,
			)
		: await persistedQuestionFactory.create({ course: course.id });
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: tag("exam-"),
		type: shape.type ?? "EXAM",
		status: "ONGOING",
		questions: [{ slug: question.slug }],
	});
	if (shape.pendingAnswer) {
		await db.response.submit(
			{
				course: course.id,
				exam: exam.slug,
				question: question.slug,
				payload: "Doing it twice changes nothing.",
			},
			{ actor: student },
		);
	}
	await prisma.exam.update({
		where: { id: exam.id },
		data: {
			status: shape.status ?? "COMPLETED",
			...(shape.openException ? { durationMs: HOUR } : {}),
		},
	});
	if (shape.openException) {
		await db.examException.create(
			{
				course: course.id,
				exam: exam.slug,
				username: student.username,
				scheduledAt: new Date(Date.now() + 2 * HOUR),
				extraTime: { minutes: 30 },
			},
			FULL_ACCESS,
		);
	}
	const base = `/api/course/${course.discipline.slug}/${course.instructor.username}_${course.edition.slug}`;
	return {
		instructor,
		student,
		exam,
		examUrl: `${base}/exam/${exam.slug}`,
		url: `${base}/exam/${exam.slug}/release`,
		missingUrl: `${base}/exam/${tag("nope-")}/release`,
	};
}

async function storedRelease(examId: schema.ExamId) {
	const row = await prisma.exam.findUniqueOrThrow({ where: { id: examId } });
	return row.gradesReleasedAt;
}

test("the instructor releases a closed exam and gets it back as the REST reads it, stamped", async ({
	request,
}) => {
	const { instructor, exam, url, examUrl } = await setup();
	const headers = await loginHeaders(request, instructor.username);

	const res = await request.post(url, { headers });

	expect(res.status()).toBe(200);
	const body = await res.json();
	expect(body.slug).toBe(exam.slug);
	expect(typeof body.gradesReleasedAt).toBe("string");
	const read = await (await request.get(examUrl, { headers })).json();
	expect(body).toEqual(read);
	expect((await storedRelease(exam.id))?.toISOString()).toBe(
		body.gradesReleasedAt,
	);
});

test("a CLI key of the instructor releases the grades", async ({ request }) => {
	const { instructor, url } = await setup();
	const headers = await keyHeaders(instructor, "CLI", "cli");

	const res = await request.post(url, { headers });

	expect(res.status()).toBe(200);
	expect((await res.json()).gradesReleasedAt).not.toBeNull();
});

test("releasing again answers 200 and keeps the date of the first release", async ({
	request,
}) => {
	const { instructor, exam, url } = await setup();
	const headers = await loginHeaders(request, instructor.username);

	const first = await (await request.post(url, { headers })).json();
	const again = await request.post(url, { headers });

	expect(again.status()).toBe(200);
	expect((await again.json()).gradesReleasedAt).toBe(first.gradesReleasedAt);
	expect((await storedRelease(exam.id))?.toISOString()).toBe(
		first.gradesReleasedAt,
	);
});

const refusals: {
	reason: string;
	shape: Shape;
	pendingAnswers: number;
	openExceptions: number;
}[] = [
	{
		reason: "not-closed",
		shape: { status: "ONGOING" },
		pendingAnswers: 0,
		openExceptions: 0,
	},
	{
		reason: "pending",
		shape: { pendingAnswer: true },
		pendingAnswers: 1,
		openExceptions: 0,
	},
	{
		reason: "exception-open",
		shape: { openException: true },
		pendingAnswers: 0,
		openExceptions: 1,
	},
	{
		reason: "not-an-exam",
		shape: { type: "QUIZ" },
		pendingAnswers: 0,
		openExceptions: 0,
	},
];

for (const { reason, shape, pendingAnswers, openExceptions } of refusals) {
	test(`a release that is ${reason} answers 409 with the reason and the counts, and changes nothing`, async ({
		request,
	}) => {
		const { instructor, exam, url } = await setup(shape);
		const headers = await loginHeaders(request, instructor.username);

		const res = await request.post(url, { headers });

		expect(res.status()).toBe(409);
		const body = await res.json();
		expect(body).toMatchObject({
			type: "error",
			code: "invalid-data",
			status: 409,
			reason,
			pendingAnswers,
			openExceptions,
		});
		expect(typeof body.message).toBe("string");
		expect(await storedRelease(exam.id)).toBeNull();
	});
}

test("a student of the course is refused with 403 and nothing changes", async ({
	request,
}) => {
	const { student, exam, url } = await setup();
	const headers = await loginHeaders(request, student.username);

	const res = await request.post(url, { headers });

	expect(res.status()).toBe(403);
	expect(await storedRelease(exam.id)).toBeNull();
});

test("a BOT key, even the instructor's, is refused with 403 and nothing changes", async ({
	request,
}) => {
	const { instructor, exam, url } = await setup();
	const headers = await keyHeaders(instructor, "BOT", "runner");

	const res = await request.post(url, { headers });

	expect(res.status()).toBe(403);
	expect((await res.json()).code).toBe("not-allowed");
	expect(await storedRelease(exam.id)).toBeNull();
});

test("an exam that does not exist is a 404", async ({ request }) => {
	const { instructor, missingUrl } = await setup();
	const headers = await loginHeaders(request, instructor.username);

	const res = await request.post(missingUrl, { headers });

	expect(res.status()).toBe(404);
	expect((await res.json()).code).toBe("not-found");
});

test("the OpenAPI document types the 409 body", async ({ request }) => {
	const { instructor } = await setup();
	const headers = await loginHeaders(request, instructor.username);

	const doc = await (await request.get("/openapi.json", { headers })).json();
	const operation =
		doc.paths["/api/course/{discipline}/{course}/exam/{slug}/release"].post;

	expect(operation.operationId).toBe("examRelease");
	const schema = operation.responses["409"].content["application/json"].schema;
	const resolved = schema.$ref
		? doc.components.schemas[schema.$ref.split("/").pop()]
		: schema;
	expect(Object.keys(resolved.properties)).toEqual(
		expect.arrayContaining(["reason", "pendingAnswers", "openExceptions"]),
	);
});
