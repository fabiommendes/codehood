import { expect, test } from "@playwright/test";
import { FULL_ACCESS, SYSTEM } from "@/auth/actor";
import { NotAllowed } from "@/core/error";
import { db, type schema, type User } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { persistedSubmissionFactory } from "@/fixtures/submission.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";

// Random suffix, not an incrementing counter: slugs must not collide with the
// ones sibling spec files draw, since they share one test database.
function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureEdition(slug = "2092-2"): Promise<string> {
	if (!(await db.edition.findOne({ slug }, FULL_ACCESS))) {
		await db.edition.create(
			{
				slug,
				name: slug,
				startAt: new Date("2026-01-01"),
				endAt: new Date("2030-12-31"),
			},
			FULL_ACCESS,
		);
	}
	return slug;
}

async function makeCourse() {
	const instructor: User = await persistedUserFactory.create({
		role: "INSTRUCTOR",
	});
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		edition: await ensureEdition(),
	});
	return { course, instructor };
}

async function enrollStudent(courseId: schema.CourseId) {
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ course: courseId, username: student.username },
		FULL_ACCESS,
	);
	return student;
}

/// A course with one student's answer waiting for a grade.
async function makePendingSubmission() {
	const { course, instructor } = await makeCourse();
	const author = await enrollStudent(course.id);
	const question = await persistedQuestionFactory.create({
		course: course.id,
		slug: tag("q-"),
	});
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: tag("exam-"),
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: question.slug }],
	});
	const response = await persistedResponseFactory.create({
		course: course.id,
		exam: exam.slug,
		author: author.username,
	});
	const submission = await persistedSubmissionFactory.create({
		response: { publicId: response.publicId },
		question: question.slug,
	});
	return { course, instructor, author, submission };
}

async function statusOf(submissionId: schema.SubmissionId) {
	const row = await prisma.submission.findUniqueOrThrow({
		where: { id: submissionId },
	});
	return row.status;
}

//
// db.feedback.create
//

test("create(): the instructor's pass moves a PENDING_GRADE submission to GRADED_MANUALLY", async () => {
	const { instructor, submission } = await makePendingSubmission();
	expect(await statusOf(submission.id)).toBe("PENDING_GRADE");

	await db.feedback.create(
		{ submission: { id: submission.id }, ref: "pass", score: "0.75" },
		{ actor: instructor },
	);

	expect(await statusOf(submission.id)).toBe("GRADED_MANUALLY");
});

test("create(): a bot's pass moves the submission to GRADED_AUTOMATICALLY", async () => {
	const { submission } = await makePendingSubmission();

	await db.feedback.create(
		{
			submission: { id: submission.id },
			ref: "bot-pass",
			score: "1",
			bot: "some-bot",
		},
		{ actor: SYSTEM },
	);

	expect(await statusOf(submission.id)).toBe("GRADED_AUTOMATICALLY");
});

test("create(): an instructor's pass after a bot's moves the submission to GRADED_MANUALLY and keeps both passes", async () => {
	const { instructor, submission } = await makePendingSubmission();
	await db.feedback.create(
		{
			submission: { id: submission.id },
			ref: "bot-pass",
			score: "1",
			bot: "some-bot",
		},
		{ actor: SYSTEM },
	);
	expect(await statusOf(submission.id)).toBe("GRADED_AUTOMATICALLY");

	await db.feedback.create(
		{ submission: { id: submission.id }, ref: "human-pass", score: "0.5" },
		{ actor: instructor },
	);

	expect(await statusOf(submission.id)).toBe("GRADED_MANUALLY");
	const refs = (
		await prisma.feedback.findMany({ where: { submissionId: submission.id } })
	)
		.map((f) => f.ref)
		.sort();
	expect(refs).toEqual(["bot-pass", "human-pass"]);
});

test("create(): grading a submission marked WILL_NOT_GRADE moves it to GRADED_MANUALLY", async () => {
	const { instructor, submission } = await makePendingSubmission();
	await prisma.submission.update({
		where: { id: submission.id },
		data: { status: "WILL_NOT_GRADE" },
	});

	await db.feedback.create(
		{ submission: { id: submission.id }, ref: "pass", score: "1" },
		{ actor: instructor },
	);

	expect(await statusOf(submission.id)).toBe("GRADED_MANUALLY");
});

//
// db.feedback.upsert
//

test("upsert(): the instructor writing a new pass moves the submission to GRADED_MANUALLY", async () => {
	const { instructor, submission } = await makePendingSubmission();

	await db.feedback.upsert(
		{ submission: { id: submission.id }, ref: "pass", score: "0.9" },
		{ actor: instructor },
	);

	expect(await statusOf(submission.id)).toBe("GRADED_MANUALLY");
});

test("upsert(): a bot writing a new pass moves the submission to GRADED_AUTOMATICALLY", async () => {
	const { submission } = await makePendingSubmission();

	await db.feedback.upsert(
		{
			submission: { id: submission.id },
			ref: "bot-pass",
			score: "0.9",
			bot: "some-bot",
		},
		{ actor: SYSTEM },
	);

	expect(await statusOf(submission.id)).toBe("GRADED_AUTOMATICALLY");
});

//
// refused writes
//

test("a refused create() by a student leaves the submission status untouched", async () => {
	const { author, submission } = await makePendingSubmission();

	await expect(
		db.feedback.create(
			{ submission: { id: submission.id }, ref: "pass", score: "1" },
			{ actor: author },
		),
	).rejects.toBeInstanceOf(NotAllowed);

	expect(await statusOf(submission.id)).toBe("PENDING_GRADE");
	expect(
		await prisma.feedback.count({ where: { submissionId: submission.id } }),
	).toBe(0);
});

test("a refused upsert() by a student leaves the submission status untouched", async () => {
	const { author, submission } = await makePendingSubmission();
	await prisma.submission.update({
		where: { id: submission.id },
		data: { status: "WILL_NOT_GRADE" },
	});

	await expect(
		db.feedback.upsert(
			{ submission: { id: submission.id }, ref: "pass", score: "1" },
			{ actor: author },
		),
	).rejects.toBeInstanceOf(NotAllowed);

	expect(await statusOf(submission.id)).toBe("WILL_NOT_GRADE");
	expect(
		await prisma.feedback.count({ where: { submissionId: submission.id } }),
	).toBe(0);
});
