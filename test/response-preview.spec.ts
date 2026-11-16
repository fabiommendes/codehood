/**
 * The instructor's simulation of an exam: a `Response` with `preview = true`,
 * opened without enrollment, answered on any exam status, timed by the exam's
 * duration alone and restarted from scratch.
 */
import { expect, test } from "@playwright/test";
import { FULL_ACCESS, SYSTEM } from "@/auth/actor";
import { InvalidData, NotAllowed, NotFound } from "@/core/error";
import { scoreValue } from "@/core/score";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";
import { capitalChoice, idempotenceEssay, sumCode } from "@/mdq/fixtures";
import { DEFAULT_CODE_ATTEMPTS } from "@/services/code-grading";
import {
	attemptOf,
	canReopen,
	examSchedule,
	previewAttemptState,
} from "@/services/exam-state";
import { appendBatch, tag } from "./answer-edit-service-support";

const MINUTE = 60_000;

const SLUGS = { choice: "choice", essay: "essay", code: "code" } as const;

interface Options {
	type?: "EXAM" | "QUIZ" | "PRACTICE";
	status?: "DRAFT" | "SCHEDULED" | "ONGOING" | "COMPLETED" | "ARCHIVED";
	scheduledAt?: Date;
	timed?: boolean;
}

/// A course with a student, an exam (a draft by default) and its three questions.
async function makeWorld(options: Options = {}) {
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
		[SLUGS.essay, idempotenceEssay],
		[
			SLUGS.code,
			{ ...sumCode, meta: { worker: "elm-test" } } as typeof sumCode,
		],
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
		type: options.type ?? "EXAM",
		status: options.status ?? "DRAFT",
		...(options.scheduledAt ? { scheduledAt: options.scheduledAt } : {}),
		...(options.timed === false ? {} : { duration: { minutes: 60 } }),
		questions: documents.map(([slug]) => ({ slug })),
	});
	const ref = { course: course.id, exam: exam.slug };
	return {
		instructor,
		course,
		student,
		exam,
		ref,
		open: () => db.response.create(ref, { actor: instructor }),
		answer: (question: string, payload: unknown, kind?: "SUBMIT") =>
			db.response.submit(
				{
					...ref,
					question,
					payload: payload as never,
					...(kind ? { kind } : {}),
				},
				{ actor: instructor },
			),
		finish: () => db.response.finish(ref, { actor: instructor }),
	};
}

test("the instructor opens a simulation of a draft exam without being enrolled", async () => {
	const world = await makeWorld({ status: "DRAFT" });

	const simulation = await world.open();

	expect(simulation.preview).toBe(true);
	expect(simulation.author).toBe(world.instructor.username);
	expect(simulation.practiceSession).toBeNull();
	const row = await prisma.response.findUniqueOrThrow({
		where: { id: simulation.id },
	});
	expect(row).toMatchObject({ preview: true, slotKey: 0 });
});

test("a simulation opens on any status and ignores the exam's window", async () => {
	const past = new Date(Date.now() - 24 * 60 * MINUTE);
	for (const status of ["SCHEDULED", "ONGOING", "COMPLETED"] as const) {
		const world = await makeWorld({ status, scheduledAt: past });

		const simulation = await world.open();
		const after = await world.answer(SLUGS.choice, "brasilia");

		expect(simulation.preview, status).toBe(true);
		expect(after.submissions, status).toHaveLength(1);
	}
});

test("a student's attempt is not a simulation", async () => {
	const world = await makeWorld({ status: "ONGOING" });

	const attempt = await db.response.create(world.ref, {
		actor: world.student,
	});

	expect(attempt.preview).toBe(false);
});

test("the instructor backfilling a student's attempt does not open a simulation", async () => {
	const world = await makeWorld({ status: "ONGOING" });

	const attempt = await db.response.create(
		{ ...world.ref, author: world.student.username },
		{ actor: world.instructor },
	);

	expect(attempt.preview).toBe(false);
	expect(attempt.author).toBe(world.student.username);
});

test("a student or another course's instructor cannot open a simulation", async () => {
	const world = await makeWorld({ status: "ONGOING" });
	const stranger = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	await persistedCourseFactory.create({ instructor: stranger.username });
	const outsider = await persistedUserFactory.create({ role: "STUDENT" });

	await expect(
		db.response.create(
			{ ...world.ref, author: world.instructor.username },
			{ actor: world.student },
		),
	).rejects.toBeInstanceOf(NotAllowed);
	await expect(
		db.response.create(world.ref, { actor: stranger }),
	).rejects.toThrow();
	await expect(
		db.response.create(world.ref, { actor: outsider }),
	).rejects.toThrow();
	expect(
		await prisma.response.count({
			where: { examId: world.exam.id, preview: true },
		}),
	).toBe(0);
});

test("a student still cannot open an attempt at a draft exam", async () => {
	const world = await makeWorld({ status: "DRAFT" });

	await expect(
		db.response.create(world.ref, { actor: world.student }),
	).rejects.toBeInstanceOf(NotFound);
});

test("submit and upsert find the same simulation, with no attempt created twice", async () => {
	const world = await makeWorld();

	const first = await world.answer(SLUGS.choice, "brasilia");
	const second = await db.response.upsert(world.ref, {
		actor: world.instructor,
	});

	expect(second.publicId).toBe(first.publicId);
	expect(second.preview).toBe(true);
});

test("a simulation of a practice exam is keyed on slot 0 and reused at any time", async () => {
	const world = await makeWorld({ type: "PRACTICE", status: "ONGOING" });

	const first = await world.open();
	await prisma.response.update({
		where: { id: first.id },
		data: { createdAt: new Date(Date.now() - 24 * 60 * MINUTE) },
	});
	const again = await db.response.upsert(world.ref, {
		actor: world.instructor,
	});

	expect(first.practiceSession).toBeNull();
	expect(again.publicId).toBe(first.publicId);
});

test("the deadline is the start plus the exam's duration, extra time included, and no exception applies", async () => {
	const world = await makeWorld({ status: "DRAFT" });
	const simulation = await world.open();
	await db.exam.update(
		{ course: world.course.id, slug: world.exam.slug },
		{ extraTime: { minutes: 10 } },
		FULL_ACCESS,
	);
	await db.examException.create(
		{
			...world.ref,
			username: world.student.username,
			extraTime: { minutes: 600 },
		},
		FULL_ACCESS,
	);

	const startedAt = (minutesAgo: number) =>
		prisma.response.update({
			where: { id: simulation.id },
			data: {
				createdAt: new Date(Date.now() - minutesAgo * MINUTE),
			},
		});

	await startedAt(69);
	await world.answer(SLUGS.choice, "brasilia");

	await startedAt(90);
	await expect(world.answer(SLUGS.choice, "brasilia")).rejects.toBeInstanceOf(
		InvalidData,
	);
});

test("an untimed exam gives the simulation no deadline", async () => {
	const world = await makeWorld({ status: "DRAFT", timed: false });
	const simulation = await world.open();
	await prisma.response.update({
		where: { id: simulation.id },
		data: { createdAt: new Date(Date.now() - 400 * 24 * 60 * MINUTE) },
	});

	const after = await world.answer(SLUGS.choice, "brasilia");

	expect(after.submissions).toHaveLength(1);
});

test("finishing grades the objective answers and the state is results right away", async () => {
	const world = await makeWorld({ status: "DRAFT" });
	await world.answer(SLUGS.choice, "brasilia");
	await world.answer(SLUGS.essay, "Doing it twice changes nothing.");

	const finished = await world.finish();

	expect(finished.acceptingSubmissions).toBe(false);
	const rows = await prisma.submission.findMany({
		where: { responseId: finished.id },
		include: { feedbacks: true, question: { select: { slug: true } } },
	});
	const choice = rows.find((row) => row.question.slug === SLUGS.choice);
	expect(choice?.status).toBe("GRADED_AUTOMATICALLY");
	expect(scoreValue(choice?.feedbacks[0]?.score ?? "")).toBe(1);
	const essay = rows.find((row) => row.question.slug === SLUGS.essay);
	expect(essay?.status).toBe("PENDING_GRADE");

	const schedule = examSchedule({
		type: world.exam.type,
		status: world.exam.status,
		scheduledAt: world.exam.scheduledAt ?? null,
		duration: world.exam.duration ?? null,
		extraTime: world.exam.extraTime ?? null,
	});
	const now = new Date();
	expect(attemptOf(schedule, world.instructor.username, finished, now)).toEqual(
		{ kind: "results" },
	);
	expect(
		attemptOf(
			schedule,
			world.instructor.username,
			{ ...finished, preview: false },
			now,
		).kind,
	).toBe("not-open");
});

test("previewAttemptState reads can-start, in-progress and results for a draft exam", async () => {
	const world = await makeWorld({ status: "DRAFT" });
	const timing = {
		type: world.exam.type,
		status: world.exam.status,
		scheduledAt: null,
		duration: world.exam.duration ?? null,
		extraTime: null,
	};
	const now = new Date();

	expect(previewAttemptState(timing, null, now)).toEqual({ kind: "can-start" });
	const simulation = await world.open();
	expect(previewAttemptState(timing, simulation, now).kind).toBe("in-progress");
	expect(
		previewAttemptState(
			timing,
			{ ...simulation, acceptingSubmissions: false },
			now,
		),
	).toEqual({ kind: "results" });
});

test("a simulation can be reopened on a draft exam while its time lasts", async () => {
	const world = await makeWorld({ status: "DRAFT" });
	await world.open();
	const finished = await world.finish();

	const reopened = await db.response.update(
		{ id: finished.id },
		{ acceptingSubmissions: true },
		{ actor: world.instructor },
	);

	expect(reopened.acceptingSubmissions).toBe(true);
	expect(
		canReopen(
			examSchedule({
				type: "EXAM",
				status: "DRAFT",
				scheduledAt: null,
				duration: null,
				extraTime: null,
			}),
			world.instructor.username,
			{ ...finished, preview: true },
			new Date(),
		),
	).toBe(true);
});

test("restarting deletes the simulation with its submissions and opens a new one", async () => {
	const world = await makeWorld({ status: "DRAFT" });
	const old = await world.answer(SLUGS.choice, "brasilia");
	await world.answer(SLUGS.essay, "text");
	await world.finish();

	const fresh = await db.response.restartPreview(world.ref, {
		actor: world.instructor,
	});

	expect(fresh.preview).toBe(true);
	expect(fresh.publicId).not.toBe(old.publicId);
	expect(fresh.acceptingSubmissions).toBe(true);
	expect(fresh.submissions).toHaveLength(0);
	expect(
		await prisma.response.count({ where: { publicId: old.publicId } }),
	).toBe(0);
	expect(await prisma.submission.count({ where: { responseId: old.id } })).toBe(
		0,
	);
	expect(
		await prisma.feedback.count({
			where: { submission: { responseId: old.id } },
		}),
	).toBe(0);
	expect(
		await prisma.response.count({
			where: { examId: world.exam.id, preview: true },
		}),
	).toBe(1);
});

test("restarting with no simulation opens one, and touches nobody else's attempt", async () => {
	const world = await makeWorld({ status: "ONGOING" });
	const attempt = await db.response.create(world.ref, {
		actor: world.student,
	});

	const fresh = await db.response.restartPreview(world.ref, {
		actor: world.instructor,
	});

	expect(fresh.preview).toBe(true);
	expect(
		await prisma.response.count({ where: { publicId: attempt.publicId } }),
	).toBe(1);
});

test("only the instructor restarts a simulation", async () => {
	const world = await makeWorld({ status: "ONGOING" });

	await expect(
		db.response.restartPreview(world.ref, { actor: world.student }),
	).rejects.toThrow();
});

test("a simulation sends code without limit and the instructor reads the attempts left as unlimited", async () => {
	const world = await makeWorld({ status: "DRAFT", type: "EXAM" });
	const simulation = await world.open();
	const sends = DEFAULT_CODE_ATTEMPTS + 2;

	for (let i = 0; i < sends; i++) {
		await world.answer(SLUGS.code, `def add(a, b): return a + ${i}`, "SUBMIT");
		const job = await prisma.gradingJob.findFirstOrThrow({
			where: { submission: { responseId: simulation.id } },
			orderBy: { id: "desc" },
			include: { submission: true },
		});
		await prisma.gradingJob.update({
			where: { id: job.id },
			data: { state: "DONE" },
		});
		await prisma.submission.update({
			where: { id: job.submission.id },
			data: { status: "GRADED_AUTOMATICALLY" },
		});
	}

	expect(
		await prisma.gradingJob.count({
			where: { submission: { responseId: simulation.id } },
		}),
	).toBe(sends);
	const view = await db.gradingJob.forStudent(
		{ response: simulation.publicId, question: SLUGS.code },
		{ actor: world.instructor },
	);
	expect(view.attemptsLeft).toBeNull();
});

test("a graded exam still stops a student's code sends at the limit", async () => {
	const world = await makeWorld({ status: "ONGOING", type: "EXAM" });
	const send = async (i: number) => {
		await db.response.submit(
			{
				...world.ref,
				question: SLUGS.code,
				payload: `def add(a, b): return a + ${i}`,
				kind: "SUBMIT",
			},
			{ actor: world.student },
		);
		const job = await prisma.gradingJob.findFirstOrThrow({
			where: { submission: { response: { authorId: world.student.username } } },
			orderBy: { id: "desc" },
			include: { submission: true },
		});
		await prisma.gradingJob.update({
			where: { id: job.id },
			data: { state: "DONE" },
		});
		await prisma.submission.update({
			where: { id: job.submission.id },
			data: { status: "GRADED_AUTOMATICALLY" },
		});
	};
	for (let i = 0; i < DEFAULT_CODE_ATTEMPTS; i++) await send(i);

	await expect(send(99)).rejects.toBeInstanceOf(NotAllowed);
});

test("the edit history of a simulation follows the exam's switch", async () => {
	for (const [type, accepted] of [
		["EXAM", true],
		["PRACTICE", false],
	] as const) {
		const world = await makeWorld({ type, status: "DRAFT" });
		const simulation = await world.open();

		const { enabled, results } = await db.answerEdit.append(
			{
				...world.ref,
				attempt: simulation.publicId,
				fields: [
					{
						question: SLUGS.essay,
						field: "answer",
						batch: appendBatch("", "abc"),
					},
				],
			},
			{ actor: world.instructor },
		);

		expect(enabled, type).toBe(accepted);
		expect(results[0]?.kind, type).toBe(accepted ? "accepted" : "closed");
	}
});

test("a manual grade on a simulation's submission is refused", async () => {
	const world = await makeWorld({ status: "DRAFT" });
	const after = await world.answer(SLUGS.essay, "text");
	const submission = after.submissions[0];

	await expect(
		db.feedback.create(
			{
				submission: { publicId: submission?.publicId as string },
				ref: "manual",
				score: "1",
			},
			{ actor: world.instructor },
		),
	).rejects.toBeInstanceOf(NotAllowed);

	// The worker's report still lands.
	const pass = await db.feedback.create(
		{
			submission: { publicId: submission?.publicId as string },
			ref: "worker",
			score: "1",
			bot: "grading-bot",
		},
		{ actor: SYSTEM },
	);
	expect(pass.score).toBeDefined();
});

test("the preview flag is not a field a client writes", async () => {
	const world = await makeWorld({ status: "ONGOING" });

	const attempt = await db.response.create(
		{ ...world.ref, preview: true } as never,
		{ actor: world.student },
	);

	expect(attempt.preview).toBe(false);
});

test("the simulation of a draft exam is found by its author and not by a student", async () => {
	const world = await makeWorld({ status: "DRAFT" });
	const simulation = await world.open();

	const own = await db.response.findOne(
		{ publicId: simulation.publicId },
		{ actor: world.instructor },
	);
	const other = await db.response.findOne(
		{ publicId: simulation.publicId },
		{ actor: world.student },
	);

	expect(own?.preview).toBe(true);
	expect(other).toBeNull();
});
