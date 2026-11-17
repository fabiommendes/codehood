/**
 * An attempt whose time ran out without being delivered has its objective
 * answers graded by `response.settleExpired`, so it stops blocking the release
 * of grades.
 */
import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";
import { capitalChoice } from "@/mdq/fixtures";
import { examResult } from "@/services/exam-result";
import { loadExamStaffData } from "@/utils/load-exam-staff";
import { tag } from "./answer-edit-service-support";

const MINUTE = 60_000;

/// A course with one student and an ongoing exam of one objective question, `choice`.
async function makeSitting() {
	const instructor = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
	});
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	await db.question.create(
		{
			course: course.id,
			slug: "choice",
			status: "PUBLISHED",
			version: "1",
			question: capitalChoice,
		},
		FULL_ACCESS,
	);
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: tag("exam-"),
		type: "EXAM",
		status: "ONGOING",
		duration: { minutes: 60 },
		questions: [{ slug: "choice" }],
	});
	return { instructor, course, student, exam };
}

type Sitting = Awaited<ReturnType<typeof makeSitting>>;

/// The student answers the question.
function answer(sitting: Sitting, payload: string) {
	return db.response.submit(
		{
			course: sitting.course.id,
			exam: sitting.exam.slug,
			question: "choice",
			payload,
		},
		{ actor: sitting.student },
	);
}

/// Moves the start of the student's attempt `minutes` into the past.
function startedAgo(sitting: Sitting, minutes: number) {
	return prisma.response.updateMany({
		where: { examId: sitting.exam.id },
		data: { createdAt: new Date(Date.now() - minutes * MINUTE) },
	});
}

/// The student's answered, undelivered attempt, started three hours ago.
async function expiredSitting() {
	const sitting = await makeSitting();
	await answer(sitting, "brasilia");
	await startedAgo(sitting, 180);
	return sitting;
}

function settle(sitting: Sitting, author?: string) {
	return db.response.settleExpired(
		{ course: sitting.course.id, exam: sitting.exam.slug, author },
		{ actor: sitting.instructor },
	);
}

function feedbackCount(sitting: Sitting) {
	return prisma.feedback.count({
		where: { submission: { response: { examId: sitting.exam.id } } },
	});
}

test("the instructor's loader settles an expired attempt, which stops blocking the release", async () => {
	const sitting = await expiredSitting();
	await prisma.exam.update({
		where: { id: sitting.exam.id },
		data: { status: "COMPLETED" },
	});
	const exam = await db.exam.findOne(
		{ course: sitting.course.id, slug: sitting.exam.slug },
		{ actor: sitting.instructor },
	);

	const data = await loadExamStaffData(
		sitting.course.id,
		exam as NonNullable<typeof exam>,
		sitting.instructor,
		new Map(),
		new Date(),
	);

	expect(data.pending).toBe(0);
	expect(data.releaseBlocker).toBeNull();
});

test("releaseGrades settles the expired attempts first", async () => {
	const sitting = await expiredSitting();
	await prisma.exam.update({
		where: { id: sitting.exam.id },
		data: { status: "COMPLETED" },
	});

	const released = await db.exam.releaseGrades(
		{ course: sitting.course.id, slug: sitting.exam.slug },
		{ actor: sitting.instructor },
	);

	expect(released.gradesReleasedAt).not.toBeNull();
	expect(await feedbackCount(sitting)).toBe(1);
});

test("settleExpired counts what it graded and a second call writes nothing", async () => {
	const sitting = await expiredSitting();

	expect(await settle(sitting)).toBe(1);
	const before = await prisma.feedback.findMany();
	expect(await settle(sitting)).toBe(0);

	expect(await prisma.feedback.findMany()).toEqual(before);
	const response = await prisma.response.findFirstOrThrow({
		where: { examId: sitting.exam.id },
	});
	expect(response.acceptingSubmissions).toBe(true);
});

test("extra time granted after the pass lets the student answer again, and the new answer is graded in the next pass", async () => {
	const sitting = await makeSitting();
	await answer(sitting, "sao-paulo");
	await startedAgo(sitting, 70);
	expect(await settle(sitting)).toBe(1);

	await db.examException.create(
		{
			course: sitting.course.id,
			exam: sitting.exam.slug,
			username: sitting.student.username,
			extraTime: { minutes: 30 },
		},
		FULL_ACCESS,
	);
	await answer(sitting, "brasilia");
	// Still inside the extended window: nothing to settle yet.
	expect(await settle(sitting)).toBe(0);
	await startedAgo(sitting, 200);
	expect(await settle(sitting)).toBe(1);

	const submissions = await prisma.submission.findMany({
		where: { response: { examId: sitting.exam.id } },
		include: { feedbacks: true, question: { select: { slug: true } } },
		orderBy: { id: "asc" },
	});
	expect(submissions).toHaveLength(2);
	const [outcome] = examResult(
		[{ slug: "choice", weight: 1 }],
		submissions.map((s) => ({ ...s, question: s.question.slug })),
		submissions.flatMap((s) =>
			s.feedbacks.map((f) => ({
				score: f.score,
				feedback: f.feedback ?? "",
				updatedAt: f.updatedAt,
				submission: s.publicId,
			})),
		),
		[],
	).questions;
	expect(outcome?.submission).toBe(submissions[1]?.publicId);
	expect(outcome?.score).toBe(1);
});

test("a student settles only their own attempt", async () => {
	const sitting = await expiredSitting();
	const input = { course: sitting.course.id, exam: sitting.exam.slug };
	const other = await persistedUserFactory.create({ role: "STUDENT" });

	await expect(
		db.response.settleExpired(input, { actor: sitting.student }),
	).rejects.toThrow();
	await expect(
		db.response.settleExpired(
			{ ...input, author: sitting.student.username },
			{ actor: other },
		),
	).rejects.toThrow();
	expect(await feedbackCount(sitting)).toBe(0);

	expect(
		await db.response.settleExpired(
			{ ...input, author: sitting.student.username },
			{ actor: sitting.student },
		),
	).toBe(1);
});
