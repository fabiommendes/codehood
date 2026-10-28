import { type APIRequestContext, expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { REGRADE_MESSAGE, releasedExam } from "./stories/regrade-setup";

/**
 * The regrade actions are called the way a browser form does, `POST
 * /_actions/<name>`. The URL's `exam` must be the exam of the submission or
 * request, so a person cannot reach another exam's data through this one.
 */

/// The world of `releasedExam` plus a second released exam of the same course answered by the same student.
async function twoExams(prefix: string) {
	const world = await releasedExam(prefix, 1);
	const [student] = world.students;
	if (!student) throw new Error("no student");
	const other = await persistedExamFactory.create({
		course: world.course.id,
		slug: "other-exam",
		title: "Other exam",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "q-short" }],
	});
	const response = await db.response.submit(
		{
			course: world.course.id,
			exam: other.slug,
			question: "q-short",
			payload: "Another reply",
		},
		{ actor: student },
	);
	const submission = response.submissions.at(-1)?.publicId ?? "";
	await db.response.finish(
		{ course: world.course.id, exam: other.slug },
		{ actor: student },
	);
	await db.feedback.create(
		{
			submission: { publicId: submission },
			ref: "pass-1",
			score: "0",
			grader: world.teacher.username,
		},
		FULL_ACCESS,
	);
	await prisma.exam.update({
		where: { id: other.id },
		data: {
			status: "COMPLETED",
			gradesReleasedAt: new Date(Date.now() - 60_000),
		},
	});
	const segment = `${world.course.instructor.username}_${world.course.edition.slug}`;
	return {
		world,
		student,
		otherSubmission: submission,
		otherExam: other,
		segment,
	};
}

async function tokenOf(
	request: APIRequestContext,
	user: { username: string; password: string },
) {
	const login = await request.post("/api/auth/login", {
		data: { login: user.username, password: user.password },
	});
	expect(login.ok(), await login.text()).toBe(true);
	const { token } = await login.json();
	return { Authorization: `Bearer ${token}` };
}

function post(
	request: APIRequestContext,
	name: string,
	headers: Record<string, string>,
	body: Record<string, string>,
) {
	return request.post(`/_actions/${name}`, { headers, data: body });
}

test("regrade.request with a submission of another exam than the URL's is not found, and with its own exam it opens the request", async ({
	request,
}) => {
	const { world, student, otherSubmission, otherExam, segment } =
		await twoExams("rga-request");
	const headers = await tokenOf(request, student);
	const form = {
		discipline: world.course.discipline.slug,
		course: segment,
		submission: otherSubmission,
		message: REGRADE_MESSAGE,
	};

	const wrong = await post(request, "regrade.request", headers, {
		...form,
		exam: world.exam.slug,
	});
	expect(wrong.status()).toBe(404);
	expect(
		await db.regradeRequest.findMany({ course: world.course.id }, FULL_ACCESS),
	).toHaveLength(0);

	const right = await post(request, "regrade.request", headers, {
		...form,
		exam: otherExam.slug,
	});
	expect(right.ok(), await right.text()).toBe(true);
	expect(
		await db.regradeRequest.findMany({ course: world.course.id }, FULL_ACCESS),
	).toHaveLength(1);
});

test("regrade.withdraw, accept and reject with a request of another exam than the URL's are not found and change nothing", async ({
	request,
}) => {
	const { world, student, otherSubmission, segment } =
		await twoExams("rga-resolve");
	const created = await db.regradeRequest.create(
		{
			course: world.course.id,
			submission: otherSubmission,
			message: REGRADE_MESSAGE,
		},
		{ actor: student },
	);
	const studentHeaders = await tokenOf(request, student);
	const teacherHeaders = await tokenOf(request, world.teacher);
	const url = {
		discipline: world.course.discipline.slug,
		course: segment,
		exam: world.exam.slug,
		request: created.publicId,
	};

	const withdraw = await post(request, "regrade.withdraw", studentHeaders, url);
	const accept = await post(request, "regrade.accept", teacherHeaders, {
		...url,
		score: "90",
		reply: "Revised.",
	});
	const reject = await post(request, "regrade.reject", teacherHeaders, {
		...url,
		reply: "No.",
	});

	expect([withdraw.status(), accept.status(), reject.status()]).toEqual([
		404, 404, 404,
	]);
	const after = await db.regradeRequest.findOne(
		{ publicId: created.publicId },
		FULL_ACCESS,
	);
	expect(after).toMatchObject({ status: "OPEN", reply: null });
});
