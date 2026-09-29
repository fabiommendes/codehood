import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { InvalidData, NotAllowed, NotFound } from "@/core/error";
import { db, type schema } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";

const MINUTE = 60_000;

function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureEdition(slug = "2094-1"): Promise<string> {
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
	const instructor = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		edition: await ensureEdition(),
	});
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	return { course, instructor, student };
}

interface ExamShape {
	type?: "PRACTICE" | "QUIZ" | "EXAM";
	status?: "SCHEDULED" | "ONGOING" | "COMPLETED";
	scheduledAt?: Date;
	duration?: { minutes: number };
}

/**
 * An exam the student answered and the instructor graded, then moved to `shape`.
 *
 * The answer is written while the exam is `ONGOING`, the only time answers are
 * accepted, and the exam is moved to its final state afterwards.
 */
async function gradedExam(shape: ExamShape = { status: "COMPLETED" }) {
	const ctx = await makeCourse();
	const question = await persistedQuestionFactory.create({
		course: ctx.course.id,
		slug: tag("q-"),
	});
	const exam = await persistedExamFactory.create({
		course: ctx.course.id,
		slug: tag("exam-"),
		type: shape.type ?? "EXAM",
		status: "ONGOING",
		questions: [{ slug: question.slug }],
	});
	const response = await db.response.submit(
		{
			course: ctx.course.id,
			exam: exam.slug,
			question: question.slug,
			payload: { answer: 1 },
		},
		{ actor: ctx.student },
	);
	const submission = response.submissions.at(-1);
	const feedback = await db.feedback.create(
		{
			submission: { publicId: submission?.publicId ?? "" },
			ref: "pass-1",
			score: "1",
			feedback: "Good",
			grader: ctx.instructor.username,
		},
		FULL_ACCESS,
	);
	await prisma.exam.update({
		where: { id: exam.id },
		data: {
			status: shape.status ?? "COMPLETED",
			scheduledAt: shape.scheduledAt ?? null,
			durationMs: shape.duration ? shape.duration.minutes * MINUTE : null,
		},
	});
	const pk = { course: ctx.course.id, slug: exam.slug };
	return { ...ctx, exam, pk, feedback, submission };
}

async function storedRelease(examId: schema.ExamId): Promise<Date | null> {
	const row = await prisma.exam.findUniqueOrThrow({ where: { id: examId } });
	return row.gradesReleasedAt;
}

test("releaseGrades: the instructor releases a closed EXAM, stamping gradesReleasedAt with the current time", async () => {
	const { pk, exam, instructor } = await gradedExam();
	const before = Date.now();

	const released = await db.exam.releaseGrades(pk, { actor: instructor });

	const after = Date.now();
	expect(released.slug).toBe(exam.slug);
	expect(released.gradesReleasedAt).not.toBeNull();
	const stamp = released.gradesReleasedAt?.getTime() ?? 0;
	expect(stamp).toBeGreaterThanOrEqual(before - 5000);
	expect(stamp).toBeLessThanOrEqual(after + 5000);
	expect((await storedRelease(exam.id))?.getTime()).toBe(stamp);
});

test("releaseGrades: an EXAM whose scheduled window has ended is closed and can be released", async () => {
	const { pk, instructor } = await gradedExam({
		status: "SCHEDULED",
		scheduledAt: new Date(Date.now() - 180 * MINUTE),
		duration: { minutes: 60 },
	});

	const released = await db.exam.releaseGrades(pk, { actor: instructor });

	expect(released.gradesReleasedAt).not.toBeNull();
});

test("releaseGrades: a student sees the feedback only after the release", async () => {
	const { pk, student, instructor, submission, course, exam } =
		await gradedExam();
	const key = {
		submission: { publicId: submission?.publicId ?? "" },
		ref: "pass-1",
	};

	expect(await db.feedback.findOne(key, { actor: student })).toBeNull();
	expect(
		await db.feedback.findMany(
			{ course: course.id, exam: exam.slug },
			{ actor: student },
		),
	).toHaveLength(0);

	await db.exam.releaseGrades(pk, { actor: instructor });

	const seen = await db.feedback.findOne(key, { actor: student });
	expect(seen?.score).toBe("1");
	expect(seen?.feedback).toBe("Good");
	expect(
		await db.feedback.findMany(
			{ course: course.id, exam: exam.slug },
			{ actor: student },
		),
	).toHaveLength(1);
});

test("releaseGrades: calling it again returns the exam with the same gradesReleasedAt", async () => {
	const { pk, exam, instructor } = await gradedExam();

	const first = await db.exam.releaseGrades(pk, { actor: instructor });
	const second = await db.exam.releaseGrades(pk, { actor: instructor });

	expect(second.gradesReleasedAt).toEqual(first.gradesReleasedAt);
	expect(await storedRelease(exam.id)).toEqual(first.gradesReleasedAt);
});

const notReleasable: { label: string; shape: ExamShape }[] = [
	{ label: "an EXAM still open", shape: { status: "ONGOING" } },
	{
		label: "an EXAM upcoming",
		shape: {
			status: "SCHEDULED",
			scheduledAt: new Date(Date.now() + 2 * 24 * 60 * MINUTE),
			duration: { minutes: 60 },
		},
	},
	{
		label: "an EXAM inside its scheduled window",
		shape: {
			status: "SCHEDULED",
			scheduledAt: new Date(Date.now() - 10 * MINUTE),
			duration: { minutes: 60 },
		},
	},
	{ label: "a closed QUIZ", shape: { type: "QUIZ", status: "COMPLETED" } },
	{
		label: "a closed PRACTICE exam",
		shape: { type: "PRACTICE", status: "COMPLETED" },
	},
];

for (const { label, shape } of notReleasable) {
	test(`releaseGrades: refuses ${label} with InvalidData and changes nothing`, async () => {
		const { pk, exam, instructor } = await gradedExam(shape);

		await expect(
			db.exam.releaseGrades(pk, { actor: instructor }),
		).rejects.toBeInstanceOf(InvalidData);

		expect(await storedRelease(exam.id)).toBeNull();
	});
}

test("releaseGrades: an answer still waiting for a grade blocks the release and changes nothing", async () => {
	const { pk, exam, instructor, feedback } = await gradedExam();
	await prisma.feedback.delete({ where: { id: feedback.id } });

	const error = await db.exam
		.releaseGrades(pk, { actor: instructor })
		.then(() => null)
		.catch((e) => e);

	expect(error).toBeInstanceOf(InvalidData);
	expect(JSON.stringify(error.errors)).toContain("waiting for a grade");
	expect(await storedRelease(exam.id)).toBeNull();
});

test("releaseGrades: a student of the course is refused and nothing changes", async () => {
	const { pk, exam, student } = await gradedExam();

	const error = await db.exam
		.releaseGrades(pk, { actor: student })
		.then(() => null)
		.catch((e) => e);

	expect(error).not.toBeNull();
	expect(error instanceof NotAllowed || error instanceof NotFound).toBe(true);
	expect(await storedRelease(exam.id)).toBeNull();
});

test("releaseGrades: an instructor of another course gets NotFound and nothing changes", async () => {
	const { pk, exam } = await gradedExam();
	const { instructor: outsider } = await makeCourse();

	await expect(
		db.exam.releaseGrades(pk, { actor: outsider }),
	).rejects.toBeInstanceOf(NotFound);

	expect(await storedRelease(exam.id)).toBeNull();
});

test("releaseGrades: an exam that does not exist is NotFound", async () => {
	const { course, instructor } = await makeCourse();

	await expect(
		db.exam.releaseGrades(
			{ course: course.id, slug: "no-such-exam" },
			{ actor: instructor },
		),
	).rejects.toBeInstanceOf(NotFound);
});
