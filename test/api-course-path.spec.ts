import { type APIRequestContext, expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedEditionFactory } from "@/fixtures/edition.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedFeedbackFactory } from "@/fixtures/feedback.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { persistedSubmissionFactory } from "@/fixtures/submission.factory";

/**
 * Responses, submissions and feedback are addressed by a `publicId` nested
 * under a course path. The item must belong to that course: the same
 * instructor teaching two courses must not reach one course's rows through
 * the other's URL.
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

async function tokenFor(request: APIRequestContext, username: string) {
	const login = await request.post("/api/auth/login", {
		data: { login: username, password: PASSWORD },
	});
	expect(login.ok()).toBe(true);
	const { token } = await login.json();
	return { Authorization: `Bearer ${token}` };
}

/// Two courses taught by one instructor; the graded work lives in `home`.
async function makeTwoCourses(request: APIRequestContext) {
	const instructor = await makeUser("INSTRUCTOR");
	const edition = await persistedEditionFactory.create({
		slug: `2100-${Math.floor(Math.random() * 900) + 100}`,
	});
	const [home, other] = await Promise.all([
		persistedCourseFactory.create({
			instructor: instructor.username,
			edition: edition.slug,
		}),
		persistedCourseFactory.create({
			instructor: instructor.username,
			edition: edition.slug,
		}),
	]);

	const question = await persistedQuestionFactory.create({ course: home.id });
	const exam = await persistedExamFactory.create({
		course: home.id,
		status: "ONGOING",
		type: "EXAM",
		questions: [{ slug: question.slug }],
	});
	const student = await makeUser("STUDENT");
	await db.enrollment.create(
		{ course: home.id, username: student.username },
		FULL_ACCESS,
	);
	const response = await persistedResponseFactory.create({
		course: home.id,
		exam: exam.slug,
		author: student.username,
	});
	const submission = await persistedSubmissionFactory.create({
		response: { publicId: response.publicId },
		question: question.slug,
	});
	const feedback = await persistedFeedbackFactory.create({
		submission: { id: submission.id },
		ref: tag("pass-"),
		grader: instructor.username,
	});

	const url = (course: typeof home) =>
		`/api/course/${course.discipline.slug}/${course.instructor.username}_${course.edition.slug}`;

	return {
		headers: await tokenFor(request, instructor.username),
		homeUrl: url(home),
		otherUrl: url(other),
		question,
		response,
		submission,
		feedback,
	};
}

test("GET of a response, submission or feedback under another course's path is 404; under its own course it is 200", async ({
	request,
}) => {
	const c = await makeTwoCourses(request);
	const paths = (base: string) => [
		`${base}/response/${c.response.publicId}`,
		`${base}/submission/${c.submission.publicId}`,
		`${base}/submission/${c.submission.publicId}/feedback/${c.feedback.ref}`,
	];

	for (const path of paths(c.homeUrl)) {
		const res = await request.get(path, { headers: c.headers });
		expect(res.status(), path).toBe(200);
	}
	for (const path of paths(c.otherUrl)) {
		const res = await request.get(path, { headers: c.headers });
		expect(res.status(), path).toBe(404);
	}
});

test("a malformed course segment is 400 on response and submission item routes", async ({
	request,
}) => {
	const c = await makeTwoCourses(request);
	const base = c.homeUrl.replace(/\/[^/]+$/, "/garbage");

	for (const path of [
		`${base}/response/${c.response.publicId}`,
		`${base}/submission/${c.submission.publicId}`,
	]) {
		const res = await request.get(path, { headers: c.headers });
		expect(res.status(), path).toBe(400);
	}
});

test("writes under another course's path are 404: a submission to its response, feedback on its submission, and deleting its feedback", async ({
	request,
}) => {
	const c = await makeTwoCourses(request);

	const submit = await request.post(`${c.otherUrl}/submission`, {
		headers: c.headers,
		data: {
			response: { publicId: c.response.publicId },
			question: c.question.slug,
			payload: {},
		},
	});
	expect(submit.status()).toBe(404);

	const grade = await request.post(
		`${c.otherUrl}/submission/${c.submission.publicId}/feedback`,
		{ headers: c.headers, data: { ref: tag("pass-"), score: "1" } },
	);
	expect(grade.status()).toBe(404);

	const del = await request.delete(
		`${c.otherUrl}/submission/${c.submission.publicId}/feedback/${c.feedback.ref}`,
		{ headers: c.headers },
	);
	expect([200, 404]).toContain(del.status());
	const stillThere = await request.get(
		`${c.homeUrl}/submission/${c.submission.publicId}/feedback/${c.feedback.ref}`,
		{ headers: c.headers },
	);
	expect(stillThere.status()).toBe(200);
});
