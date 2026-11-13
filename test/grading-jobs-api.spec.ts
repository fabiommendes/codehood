import { FULL_ACCESS, type Role } from "@/auth/actor";
import type { CourseId } from "@/core/schemas";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedEditionFactory } from "@/fixtures/edition.factory";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { code } from "@/mdq/fixtures";
import { makeCourse, makeExam, tag } from "./conditional-write-exam-support";
import { type APIRequestContext, expect, test } from "./fixtures";

/**
 * The grading job queue over HTTP: who may call it, the lease rules and the
 * action layer around the same service.
 */

const PASSWORD = "correct-horse-battery-staple";

const SOURCE = [
	"import pytest", // 1
	"", // 2
	"# mdq: [0] {public} Runs the example", // 3
	"def test_example(): ...", // 4
	"", // 5
	"# mdq: [+3] Handles the empty list", // 6
	"def test_empty(): ...", // 7
].join("\n");

const GRADED = {
	status: "completed",
	cases: [
		{ source: 0, line: 4, verdict: "pass", id: "test_example" },
		{ source: 0, line: 7, verdict: "pass", id: "test_empty" },
	],
};

type KeyKind = "BOT" | "CLI";

async function keyHeaders(
	owner: { username: string; name: string; role: Role },
	kind: KeyKind,
	name = "runner",
) {
	const key = await db.apiKey.create(
		{ name, kind, createdBy: { username: owner.username, name: owner.name } },
		{ actor: owner },
	);
	return { Authorization: `Bearer ${key.token}`, Cookie: "" };
}

async function loginHeaders(request: APIRequestContext, username: string) {
	const login = await request.post("/api/auth/login", {
		data: { login: username, password: PASSWORD },
	});
	expect(login.ok(), await login.text()).toBe(true);
	const { token } = await login.json();
	return { Authorization: `Bearer ${token}`, Cookie: "" };
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

/// A course with a known-password instructor.
async function makeOwnCourse() {
	const instructor = await makeUser("INSTRUCTOR");
	const edition = await persistedEditionFactory.create();
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		edition: edition.slug,
	});
	return { course, instructor };
}

/// A course whose student has one queued `SUBMIT` job for a `code` question.
async function world() {
	const { course, instructor } = await makeOwnCourse();
	const student = await makeUser("STUDENT");
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);

	const slug = tag("code-");
	await db.question.create(
		{
			course: course.id as CourseId,
			slug,
			status: "PUBLISHED",
			version: "v1",
			rev: null,
			question: code({
				id: slug,
				title: "Sum",
				stem: "Write it.",
				language: "python",
				meta: { worker: "py-test" },
				tests: [{ format: "pytest", text: SOURCE }],
				answerKey: "def add(a, b): return a + b",
			}),
		},
		FULL_ACCESS,
	);
	const exam = await makeExam(course.id, { questions: [{ slug }] });
	const response = await persistedResponseFactory.create({
		course: course.id,
		exam: exam.slug,
		author: student.username,
	});
	const [responseRow, questionRow] = await Promise.all([
		prisma.response.findUniqueOrThrow({
			where: { publicId: response.publicId },
		}),
		prisma.questionRef.findFirstOrThrow({
			where: { courseId: course.id, slug },
		}),
	]);
	const submission = tag("sub");
	const row = await prisma.submission.create({
		data: {
			publicId: submission,
			responseId: responseRow.id,
			questionId: questionRow.id,
			payload: "def add(a, b): return a + b",
			kind: "SUBMIT",
			status: "PENDING_GRADE",
		},
	});
	await prisma.gradingJob.create({
		data: { submissionId: row.id, worker: "py-test", state: "QUEUED" },
	});
	return {
		course,
		instructor,
		student,
		exam,
		question: slug,
		response: response.publicId,
		submission,
		discipline: course.discipline.slug,
		courseSegment: `${course.instructor.username}_${course.edition.slug}`,
	};
}

const CLAIM = { workers: ["py-test"] };

async function claim(
	request: APIRequestContext,
	headers: Record<string, string>,
	data: object = CLAIM,
) {
	return request.post("/api/grading-jobs/claim", { headers, data });
}

test("a BOT key claims, renews and reports a job, which ends DONE with a score", async ({
	request,
}) => {
	const w = await world();
	const headers = await keyHeaders(w.instructor, "BOT");

	const claimed = await claim(request, headers, { ...CLAIM, lease: 60 });
	expect(claimed.status(), await claimed.text()).toBe(200);
	const { jobs } = await claimed.json();
	expect(jobs).toHaveLength(1);
	expect(jobs[0]).toMatchObject({
		submission: w.submission,
		kind: "SUBMIT",
		worker: "py-test",
		exam: w.exam.slug,
		student: w.student.username,
		answer: "def add(a, b): return a + b",
	});
	expect(jobs[0].question.type).toBe("code");

	const renewed = await request.post(
		`/api/grading-jobs/${w.submission}/renew`,
		{ headers, data: { lease: 300 } },
	);
	expect(renewed.status(), await renewed.text()).toBe(200);
	const { leaseUntil } = await renewed.json();
	expect(new Date(leaseUntil).getTime() - Date.now()).toBeGreaterThan(200_000);

	const result = await request.post(
		`/api/grading-jobs/${w.submission}/result`,
		{ headers, data: GRADED },
	);
	expect(result.status(), await result.text()).toBe(200);
	const body = await result.json();
	expect(body.state).toBe("DONE");
	expect(body.score).toBeGreaterThan(0);

	const job = await prisma.gradingJob.findFirstOrThrow({
		where: { submission: { publicId: w.submission } },
	});
	expect(job.state).toBe("DONE");
});

test("fail with retry counts the attempt, without it the job returns untouched", async ({
	request,
}) => {
	const w = await world();
	const headers = await keyHeaders(w.instructor, "BOT");
	const jobOf = () =>
		prisma.gradingJob.findFirstOrThrow({
			where: { submission: { publicId: w.submission } },
		});

	await claim(request, headers);
	const retried = await request.post(`/api/grading-jobs/${w.submission}/fail`, {
		headers,
		data: { error: "docker down", retry: true },
	});
	expect(retried.status(), await retried.text()).toBe(200);
	expect(await retried.json()).toEqual({ state: "QUEUED" });
	expect(await jobOf()).toMatchObject({
		attempts: 1,
		lastError: "docker down",
	});

	await claim(request, headers);
	const released = await request.post(
		`/api/grading-jobs/${w.submission}/fail`,
		{ headers, data: { error: "shutting down", retry: false } },
	);
	expect(await released.json()).toEqual({ state: "QUEUED" });
	expect((await jobOf()).attempts).toBe(1);
});

test("a key that does not hold the lease gets 409", async ({ request }) => {
	const w = await world();
	const holder = await keyHeaders(w.instructor, "BOT", "holder");
	const intruder = await keyHeaders(w.instructor, "BOT", "intruder");
	await claim(request, holder);

	const url = `/api/grading-jobs/${w.submission}`;
	const renew = await request.post(`${url}/renew`, {
		headers: intruder,
		data: {},
	});
	const fail = await request.post(`${url}/fail`, {
		headers: intruder,
		data: { error: "x", retry: true },
	});
	const result = await request.post(`${url}/result`, {
		headers: intruder,
		data: GRADED,
	});
	expect([renew.status(), fail.status(), result.status()]).toEqual([
		409, 409, 409,
	]);
});

test("an invalid report is a 400 and leaves the job claimed", async ({
	request,
}) => {
	const w = await world();
	const headers = await keyHeaders(w.instructor, "BOT");
	await claim(request, headers);

	const res = await request.post(`/api/grading-jobs/${w.submission}/result`, {
		headers,
		data: { status: "completed", cases: "nope" },
	});
	expect(res.status(), await res.text()).toBe(400);
	const job = await prisma.gradingJob.findFirstOrThrow({
		where: { submission: { publicId: w.submission } },
	});
	expect(job.state).toBe("CLAIMED");
});

test("a CLI key is refused with 403 on every route", async ({ request }) => {
	const w = await world();
	const headers = await keyHeaders(w.instructor, "CLI");
	const url = `/api/grading-jobs/${w.submission}`;

	const responses = [
		await claim(request, headers),
		await request.post(`${url}/renew`, { headers, data: {} }),
		await request.post(`${url}/fail`, {
			headers,
			data: { error: "x", retry: true },
		}),
		await request.post(`${url}/result`, { headers, data: GRADED }),
	];
	expect(responses.map((r) => r.status())).toEqual([403, 403, 403, 403]);
});

test("a BOT key of another instructor claims nothing and cannot touch the job", async ({
	request,
}) => {
	const w = await world();
	const holder = await keyHeaders(w.instructor, "BOT");
	await claim(request, holder);
	const stranger = (await makeCourse()).instructor;
	const headers = await keyHeaders(stranger, "BOT");

	const claimed = await claim(request, headers);
	expect(claimed.status()).toBe(200);
	expect((await claimed.json()).jobs).toEqual([]);

	const url = `/api/grading-jobs/${w.submission}`;
	const renew = await request.post(`${url}/renew`, { headers, data: {} });
	const result = await request.post(`${url}/result`, { headers, data: GRADED });
	expect(renew.status()).toBeGreaterThanOrEqual(403);
	expect(result.status()).toBeGreaterThanOrEqual(403);
	const job = await prisma.gradingJob.findFirstOrThrow({
		where: { submission: { publicId: w.submission } },
	});
	expect(job).toMatchObject({ state: "CLAIMED", claimedBy: "runner" });
});

test("without credentials every route answers 401", async ({ request }) => {
	const headers = { Cookie: "" };
	const url = "/api/grading-jobs/abc";
	const responses = [
		await claim(request, headers),
		await request.post(`${url}/renew`, { headers, data: {} }),
		await request.post(`${url}/fail`, {
			headers,
			data: { error: "x", retry: true },
		}),
		await request.post(`${url}/result`, { headers, data: GRADED }),
	];
	expect(responses.map((r) => r.status())).toEqual([401, 401, 401, 401]);
});

test("gradingJob actions: the instructor reads the queue and requeues failures, the student reads own submissions", async ({
	request,
}) => {
	const w = await world();
	await prisma.gradingJob.updateMany({
		where: { submission: { publicId: w.submission } },
		data: { state: "FAILED", attempts: 3, lastError: "boom" },
	});
	const queue = {
		discipline: w.discipline,
		course: w.courseSegment,
		exam: w.exam.slug,
		question: w.question,
	};

	const teacher = await loginHeaders(request, w.instructor.username);
	const summary = await request.post("/_actions/gradingJob.summary", {
		headers: teacher,
		data: queue,
	});
	expect(summary.ok(), await summary.text()).toBe(true);
	expect(await summary.text()).toContain("boom");

	const requeued = await request.post("/_actions/gradingJob.requeueFailed", {
		headers: teacher,
		data: queue,
	});
	expect(requeued.ok(), await requeued.text()).toBe(true);
	const job = await prisma.gradingJob.findFirstOrThrow({
		where: { submission: { publicId: w.submission } },
	});
	expect(job.state).toBe("QUEUED");

	const student = await loginHeaders(request, w.student.username);
	const own = await request.post("/_actions/gradingJob.forStudent", {
		headers: student,
		data: { response: w.response, question: w.question },
	});
	expect(own.ok(), await own.text()).toBe(true);
	expect(await own.text()).toContain(w.submission);

	const forbidden = await request.post("/_actions/gradingJob.summary", {
		headers: student,
		data: queue,
	});
	expect(forbidden.status()).toBe(403);
});
