/**
 * `measureAnswerHistory` and `db.answerEdit.stats`: how much the edit history
 * of answers holds, counted in the database and checked here against the rows.
 */
import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import {
	measureAnswerHistory,
	measureAnswerHistoryByAttempt,
} from "@/db/services/answer-edit.service";
import {
	appendBatch,
	makeBatch,
	makeWorld,
	otherAttempt,
	send,
	sendBatch,
	type World,
} from "./answer-edit-service-support";

/// Bytes of a stored column, counted by Node on the value Prisma reads back.
function bytes(value: unknown): number {
	if (value === null || value === undefined) return 0;
	return Buffer.byteLength(
		typeof value === "string" ? value : JSON.stringify(value),
	);
}

/// What the stored columns of one attempt weigh, summed by hand.
async function handCounted(responseId: number) {
	const history = await prisma.answerEditHistory.findUniqueOrThrow({
		where: { responseId },
		include: { fields: { include: { batches: true, gaps: true } } },
	});
	let stored = 0;
	let batches = 0;
	let gaps = 0;
	for (const field of history.fields) {
		stored += bytes(field.text);
		gaps += field.gaps.length;
		for (const b of field.batches) {
			batches++;
			stored +=
				bytes(b.edits) +
				bytes(b.baseText) +
				bytes(b.gapBefore) +
				bytes(b.contentHash) +
				bytes(b.batchId) +
				bytes(b.sessionId);
		}
	}
	return {
		fields: history.fields.length,
		batches,
		gaps,
		edits: history.editCount,
		countedBytes: history.byteCount,
		storedBytes: stored,
	};
}

/// Types multibyte text in both essays of the world, with a gap marker.
async function fill(world: World) {
	const first = appendBatch("", "olá 😀 ñ", { batchId: "b-1" });
	await sendBatch(world, first);
	await sendBatch(
		world,
		appendBatch(first.snapshot, " 日本語", {
			baseRevision: 1,
			firstSeq: first.edits.length,
			batchId: "b-2",
		}),
	);
	await sendBatch(
		world,
		makeBatch({
			steps: [{ position: 0, deleteCount: 0, insertedText: "x = 'é'" }],
			batchId: "c-1",
		}),
		{ question: world.slugs.code },
	);
	await send(world, [
		{ question: world.slugs.text, field: "answer", gaps: [{ reason: "tab" }] },
	]);
}

const ZEROS = {
	attempts: 0,
	fields: 0,
	batches: 0,
	gaps: 0,
	edits: 0,
	countedBytes: 0,
	storedBytes: 0,
};

test("measureAnswerHistory matches the bytes of the stored columns, multibyte included", async () => {
	const world = await makeWorld();
	await fill(world);
	const expected = await handCounted(world.attempt.id);
	expect(expected).toMatchObject({ fields: 2, batches: 3, gaps: 1 });
	expect(expected.storedBytes).toBeGreaterThan(0);

	const measured = await prisma.$transaction((tx) =>
		measureAnswerHistory(tx, { responseIds: [world.attempt.id] }),
	);

	expect(measured).toEqual({ attempts: 1, ...expected });
});

test("an attempt without history measures zeros", async () => {
	const world = await makeWorld();
	const measured = await prisma.$transaction((tx) =>
		measureAnswerHistory(tx, { responseIds: [world.attempt.id] }),
	);
	expect(measured).toEqual(ZEROS);
	expect(
		await prisma.$transaction((tx) =>
			measureAnswerHistoryByAttempt(tx, { responseIds: [world.attempt.id] }),
		),
	).toEqual([]);
});

test("an empty list of attempts measures zeros", async () => {
	expect(
		await prisma.$transaction((tx) =>
			measureAnswerHistory(tx, { responseIds: [] }),
		),
	).toEqual(ZEROS);
});

test("the scope picks one attempt, every attempt of a user or of an exam", async () => {
	const world = await makeWorld();
	await fill(world);
	const other = await otherAttempt(world);
	await sendBatch(
		{ ...world, student: other.student, attempt: other.attempt } as World,
		appendBatch("", "só isto"),
	);
	const mine = await handCounted(world.attempt.id);
	const theirs = await handCounted(other.attempt.id);

	const measure = (scope: Parameters<typeof measureAnswerHistory>[1]) =>
		prisma.$transaction((tx) => measureAnswerHistory(tx, scope));

	expect(await measure({ responseIds: [other.attempt.id] })).toEqual({
		attempts: 1,
		...theirs,
	});
	expect(await measure({ author: world.student.username })).toEqual({
		attempts: 1,
		...mine,
	});
	const both = await measure({ exam: world.exam.id });
	expect(both).toEqual({
		attempts: 2,
		fields: mine.fields + theirs.fields,
		batches: mine.batches + theirs.batches,
		gaps: mine.gaps + theirs.gaps,
		edits: mine.edits + theirs.edits,
		countedBytes: mine.countedBytes + theirs.countedBytes,
		storedBytes: mine.storedBytes + theirs.storedBytes,
	});

	const rows = await prisma.$transaction((tx) =>
		measureAnswerHistoryByAttempt(tx, { exam: world.exam.id }),
	);
	expect(rows.map((r) => r.responseId).sort()).toEqual(
		[world.attempt.id, other.attempt.id].sort(),
	);
	expect(rows.every((r) => r.examId === world.exam.id)).toBe(true);
});

test("an attempt that reached a limit counts as incomplete", async () => {
	const world = await makeWorld();
	await fill(world);
	await prisma.answerEditHistory.update({
		where: { responseId: world.attempt.id },
		data: { incompleteAt: new Date() },
	});
	const [row] = await prisma.$transaction((tx) =>
		measureAnswerHistoryByAttempt(tx, { responseIds: [world.attempt.id] }),
	);
	expect(row?.incomplete).toBe(true);
});

test("stats reports each exam of a course, with totals and per-attempt median and max", async () => {
	const world = await makeWorld();
	await fill(world);
	const other = await otherAttempt(world);
	await sendBatch(
		{ ...world, student: other.student, attempt: other.attempt } as World,
		appendBatch("", "só isto"),
	);
	// A third attempt that never recorded anything.
	await otherAttempt(world);
	const mine = await handCounted(world.attempt.id);
	const theirs = await handCounted(other.attempt.id);

	const report = await db.answerEdit.stats(
		{ course: world.course.id },
		FULL_ACCESS,
	);

	expect(report.exams).toHaveLength(1);
	const [exam] = report.exams;
	expect(exam).toMatchObject({
		exam: world.exam.slug,
		attempts: 3,
		withHistory: 2,
		incomplete: 0,
		fields: mine.fields + theirs.fields,
		edits: mine.edits + theirs.edits,
		countedBytes: mine.countedBytes + theirs.countedBytes,
		storedBytes: mine.storedBytes + theirs.storedBytes,
		maxStoredBytes: Math.max(mine.storedBytes, theirs.storedBytes),
		medianStoredBytes: Math.round((mine.storedBytes + theirs.storedBytes) / 2),
	});
	expect(report.total).toMatchObject({
		attempts: 3,
		withHistory: 2,
		storedBytes: mine.storedBytes + theirs.storedBytes,
	});

	const one = await db.answerEdit.stats(
		{ course: world.course.id, exam: world.exam.slug },
		FULL_ACCESS,
	);
	expect(one.exams).toHaveLength(1);
	await expect(
		db.answerEdit.stats(
			{ course: world.course.id, exam: "no-such-exam" },
			FULL_ACCESS,
		),
	).rejects.toThrow();
});

test("stats is for the system only", async () => {
	const world = await makeWorld();
	await expect(
		db.answerEdit.stats({ course: world.course.id }, { actor: world.student }),
	).rejects.toThrow();
});
