import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { capitalChoice, sumCode } from "@/mdq/fixtures";
import {
	actorOf,
	enroll,
	makeCourse,
	makeExam,
	tag,
} from "./conditional-write-exam-support";

// A submission the instructor created holds a grade and nothing else: closing or grading an attempt never
// turns it into something the student sent.

/// A course with an ongoing exam on one question of `document`, and an enrolled student.
async function setup(document: typeof capitalChoice | typeof sumCode) {
	const { course, instructor } = await makeCourse();
	const slug = tag("q-");
	await db.question.create(
		{
			course: course.id,
			slug,
			status: "PUBLISHED",
			version: "1",
			question: document,
		},
		FULL_ACCESS,
	);
	const ref = await prisma.questionRef.findFirstOrThrow({
		where: { courseId: course.id, slug },
	});
	const exam = await makeExam(course.id, { questions: [{ slug }] });
	const student = await enroll(course.id);
	return { course, instructor, slug, ref, exam, student };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

/// The submissions of the exam, oldest first.
function stored(ctx: Ctx) {
	return prisma.submission.findMany({
		where: { response: { examId: ctx.exam.id } },
		include: { feedbacks: true },
		orderBy: { id: "asc" },
	});
}

//
// Closing an attempt (the last autosave of a `code` question is promoted to `FINAL`)
//

test("closing: an autosave the instructor created on a code question is not promoted to FINAL", async () => {
	const ctx = await setup(sumCode);
	await prisma.questionRef.update({
		where: { id: ctx.ref.id },
		data: { worker: "pytest" },
	});
	const response = await persistedResponseFactory.create({
		course: ctx.course.id,
		exam: ctx.exam.slug,
		author: ctx.student.username,
	});
	await prisma.submission.create({
		data: {
			publicId: tag("sub-"),
			responseId: response.id,
			questionId: ctx.ref.id,
			kind: "AUTOSAVE",
			status: "GRADED_MANUALLY",
			payload: "def add(a, b): return a + b",
			createdById: ctx.instructor.username,
		},
	});

	await db.response.finish(
		{ course: ctx.course.id, exam: ctx.exam.slug },
		{ actor: ctx.student },
	);

	const rows = await stored(ctx);
	expect(rows.map((row) => row.kind)).toEqual(["AUTOSAVE"]);
	expect(await prisma.gradingJob.count()).toBe(0);
});

test("closing: a grade given to an unanswered code question stays an AUTOSAVE after the attempt is reopened and closed again", async () => {
	const ctx = await setup(sumCode);
	await prisma.questionRef.update({
		where: { id: ctx.ref.id },
		data: { worker: "pytest" },
	});
	await prisma.exam.update({
		where: { id: ctx.exam.id },
		data: { status: "COMPLETED" },
	});

	const held = await db.manualGrade.gradeUnanswered(
		{
			course: ctx.course.id,
			exam: ctx.exam.slug,
			author: ctx.student.username,
			question: ctx.slug,
			score: "0.5",
		},
		actorOf(ctx.instructor),
	);
	// The exam is reopened for a makeup sitting and the attempt with it.
	await prisma.exam.update({
		where: { id: ctx.exam.id },
		data: { status: "ONGOING" },
	});
	await prisma.response.updateMany({
		where: { examId: ctx.exam.id },
		data: { acceptingSubmissions: true, closedAt: null },
	});
	await db.response.finish(
		{ course: ctx.course.id, exam: ctx.exam.slug },
		{ actor: ctx.student },
	);

	const rows = await stored(ctx);
	expect(rows).toHaveLength(1);
	expect(rows[0]).toMatchObject({
		publicId: held.publicId,
		kind: "AUTOSAVE",
		createdById: ctx.instructor.username,
	});
	expect(await prisma.gradingJob.count()).toBe(0);
});

//
// gradeObjectives
//

test("gradeObjectives: a submission the instructor created is not graded by the server", async () => {
	const ctx = await setup(capitalChoice);
	const response = await persistedResponseFactory.create({
		course: ctx.course.id,
		exam: ctx.exam.slug,
		author: ctx.student.username,
	});
	await prisma.submission.create({
		data: {
			publicId: tag("sub-"),
			responseId: response.id,
			questionId: ctx.ref.id,
			kind: "AUTOSAVE",
			status: "PENDING_GRADE",
			payload: "brasilia",
			createdById: ctx.instructor.username,
		},
	});
	await prisma.response.update({
		where: { id: response.id },
		data: { acceptingSubmissions: false, closedAt: new Date() },
	});

	const report = await db.response.gradeObjectives(
		{ course: ctx.course.id },
		FULL_ACCESS,
	);

	expect(report.map((entry) => entry.graded)).toEqual([0]);
	const [row] = await stored(ctx);
	expect(row?.feedbacks).toHaveLength(0);
	expect(row?.status).toBe("PENDING_GRADE");
});
