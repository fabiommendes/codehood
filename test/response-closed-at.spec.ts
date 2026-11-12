/**
 * `Response.closedAt`: the instant an attempt was closed, which grading must
 * not move even though it moves `updatedAt` (ADR 0013).
 */
import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { ANSWER_HISTORY_LATE_MS } from "@/core/constants";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { attemptClosedAt } from "@/services/exam-state";
import {
	appendBatch,
	MINUTE,
	makeWorld,
	sendBatch,
	T0,
	type World,
} from "./answer-edit-service-support";

const LATE = ANSWER_HISTORY_LATE_MS;

/// The database row of the attempt of `world`.
function row(world: World) {
	return prisma.response.findUniqueOrThrow({
		where: { id: world.attempt.id },
	});
}

/// The student delivers the attempt.
function finish(world: World) {
	return db.response.finish(
		{ course: world.course.id, exam: world.exam.slug },
		{ actor: world.student },
	);
}

/// Answers the text question and grades it, which moves `updatedAt` of the attempt.
async function answerAndGrade(
	world: World,
	status: "GRADED_MANUALLY" | "PENDING_GRADE",
) {
	const answered = await db.response.submit(
		{
			course: world.course.id,
			exam: world.exam.slug,
			question: world.slugs.text,
			payload: "answer",
		},
		{ actor: world.student },
	);
	const submission = answered.submissions.at(-1);
	if (!submission) throw new Error("no submission");
	return () =>
		db.submission.update(
			{ publicId: submission.publicId },
			{ status },
			FULL_ACCESS,
		);
}

test("an open attempt has no closedAt", async () => {
	const world = await makeWorld();
	expect((await row(world)).closedAt).toBeNull();
	const read = await db.response.findOne({ id: world.attempt.id }, FULL_ACCESS);
	expect(read?.closedAt).toBeNull();
	expect(attemptClosedAt(read as never)).toBeNull();
});

test("finish records the server time as closedAt and exposes it", async () => {
	const world = await makeWorld();
	const before = Date.now();
	const finished = await finish(world);
	const after = Date.now();

	const closedAt = (await row(world)).closedAt;
	expect(closedAt).not.toBeNull();
	expect(closedAt?.getTime()).toBeGreaterThanOrEqual(before);
	expect(closedAt?.getTime()).toBeLessThanOrEqual(after);
	expect(finished.closedAt).toEqual(closedAt);
});

test("grading a delivered attempt moves updatedAt but not closedAt", async () => {
	const world = await makeWorld();
	const grade = await answerAndGrade(world, "GRADED_MANUALLY");
	await finish(world);
	const delivered = await row(world);

	await grade();
	const graded = await row(world);

	expect(graded.updatedAt.getTime()).toBeGreaterThan(
		delivered.updatedAt.getTime(),
	);
	expect(graded.closedAt).toEqual(delivered.closedAt);
	const read = await db.response.findOne({ id: world.attempt.id }, FULL_ACCESS);
	expect(attemptClosedAt(read as never)).toEqual(delivered.closedAt);
});

test("response.update closes with a time, keeps it on a second close and clears it on reopen", async () => {
	const world = await makeWorld();
	const pk = { id: world.attempt.id };

	const closed = await db.response.update(
		pk,
		{ acceptingSubmissions: false },
		FULL_ACCESS,
	);
	expect(closed.closedAt).not.toBeNull();

	const again = await db.response.update(
		pk,
		{ acceptingSubmissions: false },
		FULL_ACCESS,
	);
	expect(again.closedAt).toEqual(closed.closedAt);

	const reopened = await db.response.update(
		pk,
		{ acceptingSubmissions: true },
		FULL_ACCESS,
	);
	expect(reopened.closedAt).toBeNull();

	const closedAgain = await db.response.update(
		pk,
		{ acceptingSubmissions: false },
		FULL_ACCESS,
	);
	expect(closedAgain.closedAt?.getTime()).toBeGreaterThanOrEqual(
		closed.closedAt?.getTime() ?? 0,
	);
});

test("an attempt created already closed has a closedAt", async () => {
	const world = await makeWorld({ type: "PRACTICE" });
	const created = await db.response.create(
		{
			course: world.course.id,
			exam: world.exam.slug,
			author: world.student.username,
			practiceSession: new Date(Date.now() - 3 * 3_600_000),
			acceptingSubmissions: false,
		},
		FULL_ACCESS,
	);
	expect(created.closedAt).not.toBeNull();
});

test("an old closed row without closedAt reads as updatedAt", () => {
	const updatedAt = new Date("2026-01-01T10:00:00Z");
	expect(
		attemptClosedAt({ acceptingSubmissions: false, closedAt: null, updatedAt }),
	).toEqual(updatedAt);
	expect(
		attemptClosedAt({ acceptingSubmissions: true, closedAt: null, updatedAt }),
	).toBeNull();
});

test("a late batch after grading is refused when the window is counted from closedAt", async () => {
	const world = await makeWorld({ startAtT0: true });
	await finish(world);
	const closedAt = new Date(T0.getTime() + MINUTE);
	await prisma.response.update({
		where: { id: world.attempt.id },
		data: { closedAt },
	});
	// Grading moves updatedAt to the real clock, long after `closedAt`.
	const grade = await answerAndGradeClosed(world);
	await grade();
	expect((await row(world)).closedAt).toEqual(closedAt);

	const result = await sendBatch(world, appendBatch("", "too late"), {
		now: new Date(closedAt.getTime() + LATE + 2_000),
	});

	expect(result).toMatchObject({ kind: "closed", reason: "finished" });
});

/// Plants a submission in a closed attempt, which `submit` refuses, and returns the grading call.
async function answerAndGradeClosed(world: World) {
	const submission = await prisma.submission.create({
		data: {
			publicId: `s-${Math.random().toString(36).slice(2)}`,
			responseId: world.attempt.id,
			questionId: (
				await prisma.questionRef.findFirstOrThrow({
					where: { courseId: world.course.id, slug: world.slugs.text },
				})
			).id,
			payload: "answer",
		},
	});
	return () =>
		db.submission.update(
			{ publicId: submission.publicId },
			{ status: "GRADED_MANUALLY" },
			FULL_ACCESS,
		);
}

test("a late batch right after closing, inside the window, is still accepted after grading", async () => {
	const world = await makeWorld({ startAtT0: true });
	await finish(world);
	const closedAt = new Date(T0.getTime() + MINUTE);
	await prisma.response.update({
		where: { id: world.attempt.id },
		data: { closedAt },
	});
	await (await answerAndGradeClosed(world))();

	const result = await sendBatch(world, appendBatch("", "in flight"), {
		now: new Date(closedAt.getTime() + 2_000),
	});

	expect(result.kind).toBe("accepted");
});
