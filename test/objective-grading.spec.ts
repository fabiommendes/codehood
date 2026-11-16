/**
 * Closing an attempt grades its objective answers, and `response.gradeObjectives`
 * does the same for the attempts that were closed before the server did.
 */
import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { renderObjectiveGrading } from "@/commands/grade-objectives";
import { scoreValue } from "@/core/score";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";
import {
	capitalChoice,
	idempotenceEssay,
	plateauFillIn,
	primesSelection,
	sumCode,
	waterNumeric,
} from "@/mdq/fixtures";
import { examResult } from "@/services/exam-result";
import { tag } from "./answer-edit-service-support";

const MINUTE = 60_000;

/// Slugs of the questions of {@link makeSitting}, by kind.
const SLUGS = {
	choice: "choice",
	selection: "selection",
	numeric: "numeric",
	essay: "essay",
	fillIn: "fill-in",
	code: "code",
} as const;

/**
 * A course with a student and an ongoing exam carrying one question of each
 * kind: three objective, an essay, a fill-in with a blank only an instructor
 * can grade, and a code question.
 */
async function makeSitting(options: { durationMs?: number } = {}) {
	const instructor = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
	});
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	const documents = [
		[SLUGS.choice, capitalChoice],
		[SLUGS.selection, primesSelection],
		[SLUGS.numeric, waterNumeric],
		[SLUGS.essay, idempotenceEssay],
		[SLUGS.fillIn, plateauFillIn],
		[SLUGS.code, sumCode],
	] as const;
	for (const [slug, question] of documents) {
		await db.question.create(
			{
				course: course.id,
				slug,
				status: "PUBLISHED",
				version: "1",
				question,
			},
			FULL_ACCESS,
		);
	}
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: tag("exam-"),
		type: "EXAM",
		status: "ONGOING",
		...(options.durationMs ? { duration: { minutes: 60 } } : {}),
		questions: documents.map(([slug]) => ({ slug })),
	});
	return { instructor, course, student, exam };
}

type Sitting = Awaited<ReturnType<typeof makeSitting>>;

/// The student answers `question` with `payload`.
function answer(sitting: Sitting, question: string, payload: unknown) {
	return db.response.submit(
		{
			course: sitting.course.id,
			exam: sitting.exam.slug,
			question,
			payload: payload as never,
		},
		{ actor: sitting.student },
	);
}

/// The student delivers the attempt.
function finish(sitting: Sitting) {
	return db.response.finish(
		{ course: sitting.course.id, exam: sitting.exam.slug },
		{ actor: sitting.student },
	);
}

/// Every submission of the student's attempt with its feedback, oldest first.
async function stored(sitting: Sitting, question?: string) {
	return prisma.submission.findMany({
		where: {
			response: {
				examId: sitting.exam.id,
				authorId: sitting.student.username,
			},
			...(question ? { question: { slug: question } } : {}),
		},
		include: { feedbacks: true, question: { select: { slug: true } } },
		orderBy: { id: "asc" },
	});
}

/// The only submission of `question`, which must have been answered once.
async function only(sitting: Sitting, question: string) {
	const rows = await stored(sitting, question);
	expect(rows).toHaveLength(1);
	return rows[0] as (typeof rows)[number];
}

test("closing grades each objective answer with the library's score and no grader", async () => {
	const sitting = await makeSitting();
	await answer(sitting, SLUGS.choice, "sao-paulo");
	await answer(sitting, SLUGS.selection, ["two", "three", "five"]);
	await answer(sitting, SLUGS.numeric, 1000);
	await finish(sitting);

	const choice = await only(sitting, SLUGS.choice);
	expect(choice.status).toBe("GRADED_AUTOMATICALLY");
	expect(choice.feedbacks).toHaveLength(1);
	expect(choice.feedbacks[0]).toMatchObject({ graderId: null, botId: null });
	expect(scoreValue(choice.feedbacks[0]?.score ?? "")).toBe(-0.5);

	const selection = await only(sitting, SLUGS.selection);
	expect(selection.status).toBe("GRADED_AUTOMATICALLY");
	expect(scoreValue(selection.feedbacks[0]?.score ?? "")).toBe(1);

	const numeric = await only(sitting, SLUGS.numeric);
	expect(numeric.status).toBe("GRADED_AUTOMATICALLY");
	expect(scoreValue(numeric.feedbacks[0]?.score ?? "")).toBe(1);
});

test("closing leaves essay, pending fill-in and code answers as they are", async () => {
	const sitting = await makeSitting();
	await answer(sitting, SLUGS.essay, "Doing it twice changes nothing.");
	await answer(sitting, SLUGS.fillIn, {
		capital: "brasilia",
		plateau: "Brazilian Highlands",
	});
	await answer(sitting, SLUGS.code, "def f(a, b): return a + b");
	await finish(sitting);

	for (const slug of [SLUGS.essay, SLUGS.fillIn, SLUGS.code]) {
		const rows = await stored(sitting, slug);
		expect(rows.length).toBeGreaterThan(0);
		for (const row of rows) {
			expect(row.status).toBe("PENDING_GRADE");
			expect(row.feedbacks).toHaveLength(0);
		}
	}
});

test("an answer the library refuses scores 0", async () => {
	const sitting = await makeSitting();
	// The service refuses such an answer, so it takes a question edited after the answer.
	const response = await answer(sitting, SLUGS.choice, "brasilia");
	await prisma.submission.updateMany({
		where: { response: { publicId: response.publicId } },
		data: { payload: "no-such-choice" },
	});
	await finish(sitting);

	const choice = await only(sitting, SLUGS.choice);
	expect(choice.status).toBe("GRADED_AUTOMATICALLY");
	expect(scoreValue(choice.feedbacks[0]?.score ?? "")).toBe(0);
});

test("a blank answer scores 0 on any kind of question, skipped or not", async () => {
	for (const blank of [null, "", "   "]) {
		const sitting = await makeSitting();
		await answer(sitting, SLUGS.essay, blank);
		// A fill-in takes a mapping, so only a skip can be blank.
		if (blank === null) await answer(sitting, SLUGS.fillIn, blank);
		await finish(sitting);

		const slugs = blank === null ? [SLUGS.essay, SLUGS.fillIn] : [SLUGS.essay];
		for (const slug of slugs) {
			const row = await only(sitting, slug);
			expect(row.status).toBe("GRADED_AUTOMATICALLY");
			expect(scoreValue(row.feedbacks[0]?.score ?? "")).toBe(0);
		}
	}
});

test("closing twice does not grade again", async () => {
	const sitting = await makeSitting();
	await answer(sitting, SLUGS.choice, "brasilia");
	await finish(sitting);
	await finish(sitting);
	await db.response.update(
		{ id: (await stored(sitting))[0]?.responseId as never },
		{ acceptingSubmissions: false },
		FULL_ACCESS,
	);

	expect((await only(sitting, SLUGS.choice)).feedbacks).toHaveLength(1);
});

test("closing through update and upsert grades too", async () => {
	for (const close of ["update", "upsert"] as const) {
		const sitting = await makeSitting();
		const response = await answer(sitting, SLUGS.choice, "brasilia");
		if (close === "update") {
			await db.response.update(
				{ publicId: response.publicId },
				{ acceptingSubmissions: false },
				{ actor: sitting.instructor },
			);
		} else {
			await db.response.upsert(
				{
					course: sitting.course.id,
					exam: sitting.exam.slug,
					acceptingSubmissions: false,
				},
				{ actor: sitting.student },
			);
		}
		expect((await only(sitting, SLUGS.choice)).status).toBe(
			"GRADED_AUTOMATICALLY",
		);
	}
});

test("an autosaved answer is graded the same way", async () => {
	const sitting = await makeSitting();
	const response = await answer(sitting, SLUGS.choice, "brasilia");
	const submission = response.submissions.at(-1);
	expect(submission?.kind).toBe("AUTOSAVE");
	await finish(sitting);
	expect((await only(sitting, SLUGS.choice)).status).toBe(
		"GRADED_AUTOMATICALLY",
	);
});

test("a later manual grade stays the verdict over the automatic one", async () => {
	const sitting = await makeSitting();
	await answer(sitting, SLUGS.choice, "sao-paulo");
	await finish(sitting);
	const submission = await only(sitting, SLUGS.choice);

	await db.feedback.create(
		{
			submission: { id: submission.id },
			ref: "manual",
			score: "1",
		} as never,
		{ actor: sitting.instructor },
	);

	const rows = await only(sitting, SLUGS.choice);
	const result = examResult(
		[{ slug: SLUGS.choice, weight: 1 }],
		[
			{
				publicId: rows.publicId,
				question: SLUGS.choice,
				createdAt: rows.createdAt,
				status: rows.status,
			},
		],
		rows.feedbacks.map((f) => ({
			score: f.score,
			feedback: f.feedback,
			updatedAt: f.updatedAt,
			submission: rows.publicId,
		})),
	);
	expect(result.questions[0]).toMatchObject({ status: "graded", score: 1 });
});

test("reopening and closing grades only the answer that is new", async () => {
	const sitting = await makeSitting();
	await answer(sitting, SLUGS.choice, "sao-paulo");
	await answer(sitting, SLUGS.numeric, 1000);
	await finish(sitting);
	const [first] = await stored(sitting, SLUGS.choice);
	const gradedAt = first?.feedbacks[0]?.createdAt;

	await db.response.update(
		{ id: first?.responseId as never },
		{ acceptingSubmissions: true },
		{ actor: sitting.instructor },
	);
	await answer(sitting, SLUGS.choice, "brasilia");
	await finish(sitting);

	const choices = await stored(sitting, SLUGS.choice);
	expect(choices.length).toBeGreaterThanOrEqual(2);
	const [old, ...newer] = choices;
	expect(old?.feedbacks).toHaveLength(1);
	expect(old?.feedbacks[0]?.createdAt).toEqual(gradedAt);
	const counting = newer.at(-1);
	expect(counting?.feedbacks).toHaveLength(1);
	expect(scoreValue(counting?.feedbacks[0]?.score ?? "")).toBe(1);
	expect((await only(sitting, SLUGS.numeric)).feedbacks).toHaveLength(1);
});

test("the student reads the automatic grade only after the exam releases it", async () => {
	const sitting = await makeSitting();
	await answer(sitting, SLUGS.choice, "brasilia");
	await finish(sitting);
	const read = () =>
		db.feedback.findMany(
			{ course: sitting.course.id, exam: sitting.exam.slug } as never,
			{ actor: sitting.student },
		);

	expect(await read()).toHaveLength(0);

	await prisma.exam.update({
		where: { id: sitting.exam.id },
		data: { status: "COMPLETED", gradesReleasedAt: new Date() },
	});
	expect((await read()).length).toBe(1);
});

test("gradeObjectives grades attempts closed before and reports each exam", async () => {
	const sitting = await makeSitting();
	await answer(sitting, SLUGS.choice, "brasilia");
	await answer(sitting, SLUGS.essay, "text");
	await finish(sitting);
	// An attempt closed by a server that did not grade.
	await prisma.feedback.deleteMany({
		where: { submission: { response: { examId: sitting.exam.id } } },
	});
	await prisma.submission.updateMany({
		where: { response: { examId: sitting.exam.id } },
		data: { status: "PENDING_GRADE" },
	});

	const report = await db.response.gradeObjectives(
		{ course: sitting.course.id },
		FULL_ACCESS,
	);

	expect(report).toEqual([
		{ exam: sitting.exam.slug, attempts: 1, graded: 1, released: false },
	]);
	expect((await only(sitting, SLUGS.choice)).status).toBe(
		"GRADED_AUTOMATICALLY",
	);
	expect((await only(sitting, SLUGS.essay)).status).toBe("PENDING_GRADE");
});

test("gradeObjectives with dryRun counts and writes nothing", async () => {
	const sitting = await makeSitting();
	await answer(sitting, SLUGS.choice, "brasilia");
	await finish(sitting);
	await prisma.feedback.deleteMany({
		where: { submission: { response: { examId: sitting.exam.id } } },
	});
	await prisma.submission.updateMany({
		where: { response: { examId: sitting.exam.id } },
		data: { status: "PENDING_GRADE" },
	});

	const report = await db.response.gradeObjectives(
		{ course: sitting.course.id, dryRun: true },
		FULL_ACCESS,
	);

	expect(report[0]).toMatchObject({ graded: 1 });
	const choice = await only(sitting, SLUGS.choice);
	expect(choice.status).toBe("PENDING_GRADE");
	expect(choice.feedbacks).toHaveLength(0);
});

test("gradeObjectives skips released exams unless asked, and exams by slug", async () => {
	const sitting = await makeSitting();
	await answer(sitting, SLUGS.choice, "brasilia");
	await finish(sitting);
	await prisma.feedback.deleteMany({
		where: { submission: { response: { examId: sitting.exam.id } } },
	});
	await prisma.submission.updateMany({
		where: { response: { examId: sitting.exam.id } },
		data: { status: "PENDING_GRADE" },
	});
	await prisma.exam.update({
		where: { id: sitting.exam.id },
		data: { status: "COMPLETED", gradesReleasedAt: new Date() },
	});
	const course = sitting.course.id;

	expect(await db.response.gradeObjectives({ course }, FULL_ACCESS)).toEqual(
		[],
	);
	expect(
		await db.response.gradeObjectives(
			{ course, exam: "other-exam", released: true },
			FULL_ACCESS,
		),
	).toEqual([]);
	const report = await db.response.gradeObjectives(
		{ course, exam: sitting.exam.slug, released: true },
		FULL_ACCESS,
	);
	expect(report).toEqual([
		{ exam: sitting.exam.slug, attempts: 1, graded: 1, released: true },
	]);
});

test("gradeObjectives grades a timed-out attempt nobody closed, and leaves an open one", async () => {
	const sitting = await makeSitting({ durationMs: 60 * MINUTE });
	await answer(sitting, SLUGS.choice, "brasilia");
	const other = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ course: sitting.course.id, username: other.username },
		FULL_ACCESS,
	);
	await db.response.submit(
		{
			course: sitting.course.id,
			exam: sitting.exam.slug,
			question: SLUGS.choice,
			payload: "brasilia",
		},
		{ actor: other },
	);
	// The first student started three hours ago, the second just now.
	await prisma.response.updateMany({
		where: { examId: sitting.exam.id, authorId: sitting.student.username },
		data: { createdAt: new Date(Date.now() - 180 * MINUTE) },
	});

	const report = await db.response.gradeObjectives(
		{ course: sitting.course.id },
		FULL_ACCESS,
	);

	expect(report).toEqual([
		{ exam: sitting.exam.slug, attempts: 1, graded: 1, released: false },
	]);
	expect((await only(sitting, SLUGS.choice)).status).toBe(
		"GRADED_AUTOMATICALLY",
	);
	const open = await prisma.submission.findMany({
		where: { response: { authorId: other.username } },
	});
	expect(open.every((s) => s.status === "PENDING_GRADE")).toBe(true);
});

test("gradeObjectives is for the system only", async () => {
	const sitting = await makeSitting();
	await expect(
		db.response.gradeObjectives(
			{ course: sitting.course.id },
			{ actor: sitting.instructor },
		),
	).rejects.toThrow();
});

test("the command prints a line per exam and a total, worded for a dry run", () => {
	const lines = [
		{ exam: "p1", attempts: 3, graded: 5, released: false },
		{ exam: "p2", attempts: 1, graded: 2, released: true },
	];

	expect(renderObjectiveGrading(lines, false)).toBe(
		[
			"p1: graded 5 answer(s) of 3 attempt(s)",
			"p2: graded 2 answer(s) of 1 attempt(s) (grades released)",
			"total: graded 7 answer(s)",
		].join("\n"),
	);
	expect(renderObjectiveGrading(lines, true)).toContain("would grade 7");
	expect(renderObjectiveGrading([], true)).toBe("Nothing to grade.");
});
