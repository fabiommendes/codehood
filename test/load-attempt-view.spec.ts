import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { isoDate } from "@/core/schemas/base";
import { db, type schema, type User } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { persistedSubmissionFactory } from "@/fixtures/submission.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";
import { attemptOf, examSchedule } from "@/services/exam-state";
import { loadAttemptView } from "@/utils/load-attempt-view";

const MINUTE = 60_000;

// Random suffix, not a counter: slugs would collide with the ones sibling spec files draw from the shared database.
function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

/// An `ONGOING` exam of one question with one enrolled student who has no attempt yet.
async function makeWorld() {
	const instructor = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const edition = "2095-2";
	if (!(await db.edition.findOne({ slug: edition }, FULL_ACCESS))) {
		await db.edition.create(
			{
				slug: edition,
				name: edition,
				startDate: isoDate.parse("2026-01-01"),
				endDate: isoDate.parse("2030-12-31"),
			},
			FULL_ACCESS,
		);
	}
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		edition,
	});
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
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ course: course.id as schema.CourseId, username: student.username },
		FULL_ACCESS,
	);
	return { instructor, course, question, exam, student };
}

type World = Awaited<ReturnType<typeof makeWorld>>;

/// The student answers the question and gets a full score from the instructor.
async function answerAndGrade(world: World, student: User) {
	const response = await persistedResponseFactory.create({
		course: world.course.id,
		exam: world.exam.slug,
		author: student.username,
	});
	const submission = await persistedSubmissionFactory.create({
		response: { publicId: response.publicId },
		question: world.question.slug,
	});
	await db.feedback.create(
		{
			submission: { id: submission.id },
			ref: "first-pass",
			score: "1",
			grader: world.instructor.username,
		},
		FULL_ACCESS,
	);
}

/// Closes the exam and releases its grades.
async function release({ exam }: World) {
	await prisma.exam.update({
		where: { id: exam.id },
		data: {
			status: "COMPLETED",
			gradesReleasedAt: new Date(Date.now() - MINUTE),
		},
	});
}

/// Adjusts the student on the whole exam, as the instructor.
function adjust(
	world: World,
	student: User,
	adjustment: { op: "SET" | "FACTOR" | "OFFSET"; value: string },
) {
	return db.examAdjustment.create(
		{
			course: world.course.id,
			exam: world.exam.slug,
			usernames: [student.username],
			...adjustment,
			reason: "because",
		},
		{ actor: world.instructor },
	);
}

/// What the exam page hands to `ExamAttempt` for the student, as `exams/[slug].astro` reads it.
async function viewOf(world: World, student: User) {
	const { course, exam } = world;
	const row = await db.exam.findOne(
		{ course: course.id, slug: exam.slug },
		{ actor: student },
	);
	if (!row) throw new Error("exam not found");
	const now = new Date();
	const schedule = examSchedule(row, new Map());
	const attempt =
		(
			await db.response.findMany(
				{
					course: course.id,
					exam: exam.slug,
					author: student.username,
					practice: false,
				},
				{ actor: student },
			)
		).at(-1) ?? null;
	const state = attemptOf(schedule, student.username, attempt, now);
	const granted = await db.examQuestion.forAttempt(
		{ course: course.id, exam: exam.slug },
		{ actor: student },
	);
	const view = await loadAttemptView({
		course: course.id,
		exam: row,
		actor: student,
		schedule,
		attempt,
		state,
		granted,
		now,
	});
	return { view, state };
}

test("an OFFSET bonus keeps the regrade request available and is listed", async () => {
	const world = await makeWorld();
	const { student } = world;
	await answerAndGrade(world, student);
	await adjust(world, student, { op: "OFFSET", value: "0.1" });
	await release(world);

	const { view, state } = await viewOf(world, student);

	expect(state.kind).toBe("results");
	expect(view.result?.adjustments).toEqual([
		{ op: "OFFSET", value: 0.1, reason: "because" },
	]);
	expect(view.regrades[world.question.slug]?.canRequest).toBe(true);
});

test("an exam FACTOR below 1 blocks the regrade request", async () => {
	const world = await makeWorld();
	const { student } = world;
	await answerAndGrade(world, student);
	await adjust(world, student, { op: "FACTOR", value: "0.5" });
	await release(world);

	const { view } = await viewOf(world, student);

	expect(view.regrades[world.question.slug]?.canRequest).toBe(false);
});

test("every exam adjustment reaches the view, in the order SET, FACTOR, OFFSET", async () => {
	const world = await makeWorld();
	const { student } = world;
	await answerAndGrade(world, student);
	await adjust(world, student, { op: "OFFSET", value: "0.1" });
	await adjust(world, student, { op: "FACTOR", value: "0.5" });
	await adjust(world, student, { op: "FACTOR", value: "0.9" });
	await adjust(world, student, { op: "SET", value: "0.8" });
	await release(world);

	const { view } = await viewOf(world, student);

	expect(view.result?.adjustments?.map((a) => [a.op, a.value])).toEqual([
		["SET", 0.8],
		["FACTOR", 0.5],
		["FACTOR", 0.9],
		["OFFSET", 0.1],
	]);
	expect(view.result?.original?.total).toBe(1);
	expect(view.result?.total).toBeCloseTo(0.46, 10);
});

test("an attempt the student made is not empty", async () => {
	const world = await makeWorld();
	const { student } = world;
	await answerAndGrade(world, student);
	await release(world);

	const { view } = await viewOf(world, student);

	expect(view.empty).toBe(false);
});

test("an attempt the instructor created for a student who did not take the exam is empty", async () => {
	const world = await makeWorld();
	const { student } = world;
	await release(world);
	await adjust(world, student, { op: "SET", value: "0.7" });

	const { view, state } = await viewOf(world, student);

	expect(state.kind).toBe("results");
	expect(view.empty).toBe(true);
	expect(view.result?.total).toBeCloseTo(0.7, 10);
	expect(view.result?.adjustments).toEqual([
		{ op: "SET", value: 0.7, reason: "because" },
	]);
});
