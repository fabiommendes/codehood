import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedEditionFactory } from "@/fixtures/edition.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { persistedSubmissionFactory } from "@/fixtures/submission.factory";
import { type APIRequestContext, expect, test } from "./fixtures";

/**
 * Feedback written over HTTP: who it is attributed to when the caller holds a
 * BOT key, a CLI key or a login token, and the instructor-only `notes`.
 */

const PASSWORD = "correct-horse-battery-staple";

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

/// A course with one student's pending submission, and the feedback URL for it.
async function makeSubmission() {
	const instructor = await makeUser("INSTRUCTOR");
	const edition = await persistedEditionFactory.create();
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		edition: edition.slug,
	});
	const question = await persistedQuestionFactory.create({ course: course.id });
	const exam = await persistedExamFactory.create({
		course: course.id,
		status: "ONGOING",
		type: "EXAM",
		questions: [{ slug: question.slug }],
	});
	const student = await makeUser("STUDENT");
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	const response = await persistedResponseFactory.create({
		course: course.id,
		exam: exam.slug,
		author: student.username,
	});
	const submission = await persistedSubmissionFactory.create({
		response: { publicId: response.publicId },
		question: question.slug,
	});
	const base = `/api/course/${course.discipline.slug}/${course.instructor.username}_${course.edition.slug}`;
	return {
		instructor,
		student,
		course,
		exam,
		submission,
		url: `${base}/submission/${submission.publicId}/feedback`,
	};
}

async function statusOf(publicId: string) {
	const row = await prisma.submission.findUnique({ where: { publicId } });
	return row?.status;
}

test("a BOT key writes feedback as the bot named by the key, with no grader, and the submission becomes GRADED_AUTOMATICALLY", async ({
	request,
}) => {
	const { instructor, submission, url } = await makeSubmission();
	const headers = await keyHeaders(instructor, "BOT", "runner");

	const res = await request.post(url, {
		headers,
		data: { ref: "auto-1", score: "1/2", feedback: "half" },
	});

	expect(res.status()).toBe(200);
	const pass = await res.json();
	expect(pass.bot).toBe("runner");
	expect(pass.grader).toBeNull();
	expect(await statusOf(submission.publicId)).toBe("GRADED_AUTOMATICALLY");
});

test("a BOT key refuses an explicit grader in the body with 403, naming another user or its own owner, and writes nothing", async ({
	request,
}) => {
	const { instructor, student, submission, url } = await makeSubmission();
	const headers = await keyHeaders(instructor, "BOT", "runner");

	for (const grader of [student.username, instructor.username]) {
		const res = await request.post(url, {
			headers,
			data: { ref: "as-human", score: "1", grader },
		});
		expect(res.status(), grader).toBe(403);
	}

	expect(
		await prisma.feedback.count({
			where: { submission: { publicId: submission.publicId } },
		}),
	).toBe(0);
	expect(await statusOf(submission.publicId)).not.toBe("GRADED_AUTOMATICALLY");
});

test("a PUT by the BOT key over its own pass updates the score and keeps the bot attribution", async ({
	request,
}) => {
	const { instructor, url } = await makeSubmission();
	const headers = await keyHeaders(instructor, "BOT", "runner");
	const first = await request.post(url, {
		headers,
		data: { ref: "auto-1", score: "0", feedback: "fail" },
	});
	expect(first.status()).toBe(200);

	const res = await request.put(url, {
		headers,
		data: { ref: "auto-1", score: "1", feedback: "pass" },
	});

	expect(res.ok()).toBe(true);
	const pass = await (await request.get(`${url}/auto-1`, { headers })).json();
	expect(pass).toMatchObject({
		score: "1",
		feedback: "pass",
		bot: "runner",
		grader: null,
	});
});

test("a PUT by the BOT key that creates a pass attributes it to the bot", async ({
	request,
}) => {
	const { instructor, submission, url } = await makeSubmission();
	const headers = await keyHeaders(instructor, "BOT", "runner");

	const res = await request.put(url, {
		headers,
		data: { ref: "auto-1", score: "1" },
	});

	expect(res.ok()).toBe(true);
	const pass = await (await request.get(`${url}/auto-1`, { headers })).json();
	expect(pass).toMatchObject({ bot: "runner", grader: null });
	expect(await statusOf(submission.publicId)).toBe("GRADED_AUTOMATICALLY");
});

test("a CLI key and a login token keep grading as the owner, and a bot in the body is refused with 403", async ({
	request,
}) => {
	const { instructor, submission, url } = await makeSubmission();
	const sources = {
		cli: await keyHeaders(instructor, "CLI", "my laptop"),
		login: await loginHeaders(request, instructor.username),
	};

	for (const [label, headers] of Object.entries(sources)) {
		const ok = await request.post(url, {
			headers,
			data: { ref: `human-${label}`, score: "1" },
		});
		expect(ok.status(), label).toBe(200);
		const pass = await ok.json();
		expect(pass.grader, label).toBe(instructor.username);
		expect(pass.bot, label).toBeNull();

		const refused = await request.post(url, {
			headers,
			data: { ref: `bot-${label}`, score: "1", bot: "runner" },
		});
		expect(refused.status(), label).toBe(403);
	}
	expect(await statusOf(submission.publicId)).toBe("GRADED_MANUALLY");
});

test("notes written by the instructor and by their BOT key come back to them, and a student of a released exam never receives the field", async ({
	request,
}) => {
	const { instructor, student, exam, course, submission, url } =
		await makeSubmission();
	const human = await loginHeaders(request, instructor.username);
	const bot = await keyHeaders(instructor, "BOT", "runner");
	const secret = "suspicious: copied from the web";

	const byBot = await request.post(url, {
		headers: bot,
		data: { ref: "auto-1", score: "1", notes: secret },
	});
	expect(byBot.status()).toBe(200);
	expect((await byBot.json()).notes).toBe(secret);

	const byHuman = await request.post(url, {
		headers: human,
		data: { ref: "manual-1", score: "1", notes: "own note" },
	});
	expect(byHuman.status()).toBe(200);
	const asInstructor = await request.get(`${url}/manual-1`, { headers: human });
	expect((await asInstructor.json()).notes).toBe("own note");
	const listed = await (await request.get(url, { headers: bot })).json();
	expect(listed.map((p: { notes: string }) => p.notes).sort()).toEqual(
		[secret, "own note"].sort(),
	);

	await prisma.exam.update({
		where: { id: exam.id },
		data: { status: "COMPLETED" },
	});
	await db.exam.releaseGrades(
		{ course: course.id, slug: exam.slug },
		{ actor: instructor },
	);

	const studentHeaders = await loginHeaders(request, student.username);
	for (const path of [url, `${url}/auto-1`, `${url}/manual-1`]) {
		const res = await request.get(path, { headers: studentHeaders });
		expect(res.status(), path).toBe(200);
		const text = await res.text();
		expect(text, path).not.toContain('"notes"');
		expect(text, path).not.toContain(secret);
		expect(text, path).not.toContain("own note");
	}
	expect(submission.publicId).toBeTruthy();
});

test("notes can be changed through PUT on an existing pass", async ({
	request,
}) => {
	const { instructor, url } = await makeSubmission();
	const headers = await keyHeaders(instructor, "BOT", "runner");
	await request.post(url, {
		headers,
		data: { ref: "auto-1", score: "0", notes: "first" },
	});

	const res = await request.put(url, {
		headers,
		data: { ref: "auto-1", score: "0", notes: "second" },
	});

	expect(res.ok()).toBe(true);
	const pass = await (await request.get(`${url}/auto-1`, { headers })).json();
	expect(pass.notes).toBe("second");
});

test("listing the feedback of a submission returns only the passes of that submission", async ({
	request,
}) => {
	const { instructor, submission, url } = await makeSubmission();
	const headers = await loginHeaders(request, instructor.username);
	// A second submission of the same answer, with no feedback of its own.
	const row = await prisma.submission.findUniqueOrThrow({
		where: { publicId: submission.publicId },
	});
	const other = await prisma.submission.create({
		data: {
			publicId: tag("sub"),
			responseId: row.responseId,
			questionId: row.questionId,
			payload: row.payload ?? "x",
		},
	});
	const otherUrl = url.replace(submission.publicId, other.publicId);

	const written = await request.post(url, {
		headers,
		data: { ref: "chalk", score: "1/1" },
	});
	expect(written.status()).toBe(200);

	const own = await request.get(url, { headers });
	expect(own.status()).toBe(200);
	expect((await own.json()).map((p: { ref: string }) => p.ref)).toEqual([
		"chalk",
	]);

	const empty = await request.get(otherUrl, { headers });
	expect(empty.status()).toBe(200);
	expect(await empty.json()).toEqual([]);

	await request.post(otherUrl, {
		headers,
		data: { ref: "other", score: "0/1" },
	});
	const second = await request.get(otherUrl, { headers });
	expect(
		(await second.json()).map((p: { submission: string }) => p.submission),
	).toEqual([other.publicId]);
});
