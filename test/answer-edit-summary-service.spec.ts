/**
 * `db.answerEdit.summary`: what the course owner reads about one attempt (spec
 * `dev/specs/to-review/historico-de-edicao-no-servidor.md`, R32 to R34). The
 * pure computation is covered in `answer-edit-summary.spec.ts`; here the
 * service feeds it from the stored rows.
 *
 * The spec gives no result shape, so this file assumes
 *
 *   summary({ course, exam, author }, { actor }) -> {
 *     enabled: boolean,
 *     incomplete: boolean,
 *     questions: { question: <slug>, summary: AnswerEditSummary }[],
 *   }
 *
 * with `AnswerEditSummary` as described at the top of
 * `answer-edit-summary.spec.ts`, one entry per followed question of the exam,
 * in the order of the exam. `author` is the student's username.
 */
import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { MAX_ANSWER_HISTORY_TEXT_BYTES } from "@/core/constants";
import { NotAllowed } from "@/core/error";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";
import {
	appendBatch,
	GAPPED_AT,
	historyOf,
	makeBatch,
	makeWorld,
	NORMAL_FIRST_AT,
	NORMAL_LAST_AT,
	PASTED_BLOCK,
	receiptOf,
	seedGappedHistory,
	seedNormalHistory,
	send,
	sendBatch,
	snapshotRows,
	storedField,
	submitAnswer,
	summaryOf,
	type World,
} from "./answer-edit-service-support";

async function failure(call: Promise<unknown>): Promise<unknown> {
	try {
		await call;
		return null;
	} catch (error) {
		return error;
	}
}

/// The summary of one question of the result.
async function questionSummary(world: World, slug = world.slugs.text) {
	const result = await summaryOf(world);
	const entry = result.questions.find((q) => q.question === slug);
	if (!entry) throw new Error(`No summary for ${slug}`);
	return entry.summary;
}

test.describe("R32: who may read", () => {
	test("the owner of the course reads", async () => {
		const world = await makeWorld();
		await seedNormalHistory(world);
		const result = await summaryOf(world, world.instructor);
		expect(result.enabled).toBe(true);
		expect(result.incomplete).toBe(false);
	});

	test("SYSTEM reads", async () => {
		const world = await makeWorld();
		await seedNormalHistory(world);
		const result = await summaryOf(world, FULL_ACCESS.actor);
		expect(result.enabled).toBe(true);
	});

	test("the author of the attempt may not read their own history", async () => {
		const world = await makeWorld();
		await seedNormalHistory(world);
		expect(await failure(summaryOf(world, world.student))).toBeInstanceOf(
			NotAllowed,
		);
	});

	test("another student may not", async () => {
		const world = await makeWorld();
		await seedNormalHistory(world);
		const other = await persistedUserFactory.create({ role: "STUDENT" });
		expect(await failure(summaryOf(world, other))).toBeInstanceOf(NotAllowed);
	});

	test("an instructor of another course may not", async () => {
		const world = await makeWorld();
		await seedNormalHistory(world);
		const other = await persistedUserFactory.create({ role: "INSTRUCTOR" });
		expect(await failure(summaryOf(world, other))).toBeInstanceOf(NotAllowed);
	});

	test("an admin who does not teach the course may not", async () => {
		const world = await makeWorld();
		await seedNormalHistory(world);
		const admin = await persistedUserFactory.create({ role: "ADMIN" });
		expect(await failure(summaryOf(world, admin))).toBeInstanceOf(NotAllowed);
	});
});

test.describe("R33: the result", () => {
	test("has one entry per followed question, in the order of the exam", async () => {
		const world = await makeWorld({ extraEssays: 1 });
		const result = await summaryOf(world);
		// The choice question and the essay outside the exam are not followed.
		expect(result.questions.map((q) => q.question)).toEqual([
			world.slugs.text,
			world.slugs.code,
			...world.slugs.extra,
		]);
	});

	test("reads without writing anything", async () => {
		const world = await makeWorld();
		await seedNormalHistory(world);
		const before = await snapshotRows(world);
		await summaryOf(world);
		expect(await snapshotRows(world)).toEqual(before);
	});

	test("an attempt that never sent anything has no history rows, and reading creates none", async () => {
		const world = await makeWorld();
		const result = await summaryOf(world);
		expect(result.enabled).toBe(true);
		expect(result.incomplete).toBe(false);
		expect(await historyOf(world)).toBeNull();
	});

	test("a question answered without any batch is none", async () => {
		const world = await makeWorld();
		await submitAnswer(world, world.slugs.text, "typed somewhere else");
		const summary = await questionSummary(world);
		expect(summary.state).toBe("none");
		expect(summary.activeMs).toBe(0);
		expect(summary.firstAt).toBeNull();
	});

	test("the history of one question does not leak into another", async () => {
		const world = await makeWorld();
		await seedNormalHistory(world);
		const code = await questionSummary(world, world.slugs.code);
		expect(code.activeMs).toBe(0);
		expect(code.pastes).toEqual({ count: 0, chars: 0 });
		expect(code.largeInsertions).toEqual([]);
	});
});

test.describe("R34: a normal history, read from the stored rows", () => {
	test("active time, kinds, pastes, large insertions and arrival times", async () => {
		const world = await makeWorld();
		await seedNormalHistory(world);

		const summary = await questionSummary(world);

		// Starts 1000, 4000, 4500, 70000, last duration 400:
		// 3000 + 500 + (65500 limited to 60000) + 400.
		expect(summary.activeMs).toBe(63_900);
		expect(summary.state).toBe("complete");
		expect(summary.firstAt).toEqual(NORMAL_FIRST_AT);
		expect(summary.lastAt).toEqual(NORMAL_LAST_AT);
		expect(summary.kinds).toEqual({
			typing: 2,
			paste: 1,
			delete: 1,
			undo: 0,
			redo: 0,
			composition: 0,
			other: 0,
		});
		// One paste of the 120 characters of "ab" x 60.
		expect(PASTED_BLOCK).toHaveLength(120);
		expect(summary.pastes).toEqual({ count: 1, chars: 120 });
		// The paste is the only insertion of 100 units or more; it came with batch 1.
		expect(summary.largeInsertions).toEqual([
			{ kind: "paste", length: 120, receivedAt: NORMAL_FIRST_AT },
		]);
		// The saved answer is what the anchor holds, so nothing is missing.
		expect(summary.gaps).toEqual([]);
	});

	test("the first and last times follow receivedAt, not the session clock", async () => {
		const world = await makeWorld();
		await seedNormalHistory(world);
		const field = await storedField(world);
		const later = new Date("2026-04-02T08:30:00.000Z");
		await prisma.answerEditBatch.updateMany({
			where: { fieldId: field?.id, batchId: "normal-2" },
			data: { receivedAt: later },
		});

		const summary = await questionSummary(world);

		expect(summary.firstAt).toEqual(NORMAL_FIRST_AT);
		expect(summary.lastAt).toEqual(later);
	});
});

test.describe("R34: gaps, read from the stored rows", () => {
	test("a marker, a rebase and a final gap", async () => {
		const world = await makeWorld();
		await seedGappedHistory(world);

		const summary = await questionSummary(world);

		expect(summary.state).toBe("complete");
		expect(summary.gaps).toHaveLength(3);
		expect(summary.gaps).toEqual(
			expect.arrayContaining([
				{ type: "marker", reason: "input-lost", receivedAt: GAPPED_AT.marker },
				// The anchor held "The quick brown fox" and the rebase started from
				// "The slow brown fox": "quick" (5) out, "slow" (4) in.
				{
					type: "rebase",
					removed: 5,
					inserted: 4,
					receivedAt: GAPPED_AT.rebase,
				},
				// The anchor ends at "The slow brown fox!" and the answer is that plus " Done." (6).
				{ type: "final", removed: 0, inserted: 6 },
			]),
		);
	});

	test("a rebase onto the very text the anchor holds is no gap", async () => {
		const world = await makeWorld();
		receiptOf(
			await sendBatch(world, appendBatch("", "hello", { batchId: "b1" })),
		);
		receiptOf(
			await sendBatch(
				world,
				makeBatch({
					batchId: "b2",
					start: "hello",
					steps: [{ position: 5, deleteCount: 0, insertedText: "!" }],
					baseRevision: 1,
					firstSeq: 5,
					base: { reason: "rebase", text: "hello" },
				}),
			),
		);
		await submitAnswer(world, world.slugs.text, "hello!");

		expect((await questionSummary(world)).gaps).toEqual([]);
	});

	test("the final gap compares the anchor with the last answer, not an earlier one", async () => {
		const world = await makeWorld();
		receiptOf(
			await sendBatch(world, appendBatch("", "hello", { batchId: "b1" })),
		);
		await submitAnswer(world, world.slugs.text, "an earlier draft");
		await submitAnswer(world, world.slugs.text, "hello");

		expect((await questionSummary(world)).gaps).toEqual([]);
	});

	test("a marker on a field that kept recording shows beside the batches", async () => {
		const world = await makeWorld();
		receiptOf(
			await sendBatch(world, appendBatch("", "hello", { batchId: "b1" })),
		);
		await send(world, [
			{
				question: world.slugs.text,
				field: "answer",
				gaps: [{ reason: "page-hidden", id: "m1" }],
			},
		]);
		await submitAnswer(world, world.slugs.text, "hello");

		const summary = await questionSummary(world);

		expect(summary.gaps).toHaveLength(1);
		expect(summary.gaps[0]).toMatchObject({
			type: "marker",
			reason: "page-hidden",
		});
	});
});

test.describe("R34: incompleteness", () => {
	test("a field that reached the text limit is incomplete, and the other is not", async () => {
		const world = await makeWorld();
		receiptOf(
			await sendBatch(world, appendBatch("", "abc", { batchId: "b1" })),
		);
		// One more byte than the field may hold.
		const refused = await sendBatch(
			world,
			makeBatch({
				batchId: "b2",
				start: "abc",
				steps: [
					{
						position: 3,
						deleteCount: 0,
						insertedText: "x".repeat(MAX_ANSWER_HISTORY_TEXT_BYTES),
					},
				],
				baseRevision: 1,
				firstSeq: 3,
			}),
		);
		expect(refused).toMatchObject({ kind: "closed", reason: "limit" });
		await submitAnswer(world, world.slugs.text, "abc");
		await submitAnswer(world, world.slugs.code, "print(1)");

		const result = await summaryOf(world);

		const state = (slug: string) =>
			result.questions.find((q) => q.question === slug)?.summary.state;
		expect(state(world.slugs.text)).toBe("incomplete");
		expect(state(world.slugs.code)).toBe("none");
		expect(result.incomplete).toBe(false);
	});

	test("an attempt that reached its limit is incomplete as a whole", async () => {
		const world = await makeWorld();
		receiptOf(
			await sendBatch(world, appendBatch("", "abc", { batchId: "b1" })),
		);
		await submitAnswer(world, world.slugs.text, "abc");
		await prisma.answerEditHistory.update({
			where: { responseId: world.attempt.id },
			data: { incompleteAt: new Date() },
		});

		const result = await summaryOf(world);

		expect(result.incomplete).toBe(true);
		expect(
			result.questions.find((q) => q.question === world.slugs.text)?.summary
				.state,
		).toBe("incomplete");
	});
});

test.describe("R33: the exam's switch", () => {
	test("reports the effective value and keeps what was recorded before the switch went off", async () => {
		const world = await makeWorld();
		await seedNormalHistory(world);
		const before = await summaryOf(world);
		expect(before.enabled).toBe(true);

		await db.exam.setAnswerHistory(
			{ course: world.course.id, slug: world.exam.slug },
			false,
			FULL_ACCESS,
		);
		const after = await summaryOf(world);

		expect(after.enabled).toBe(false);
		expect(after.questions).toEqual(before.questions);
	});

	test("a practice exam on the default is off and has nothing to show", async () => {
		const world = await makeWorld({ type: "PRACTICE" });

		const result = await summaryOf(world);

		expect(result.enabled).toBe(false);
		for (const entry of result.questions) {
			expect(entry.summary.activeMs).toBe(0);
			expect(entry.summary.firstAt).toBeNull();
		}
	});

	test("a practice exam switched on reports on", async () => {
		const world = await makeWorld({ type: "PRACTICE" });
		await db.exam.setAnswerHistory(
			{ course: world.course.id, slug: world.exam.slug },
			true,
			FULL_ACCESS,
		);

		expect((await summaryOf(world)).enabled).toBe(true);
	});
});

test.describe("R33: several attempts by the same author", () => {
	test("reads the first attempt, the one the instructor's attempt page shows", async () => {
		// A practice exam may be attempted again and again.
		const world = await makeWorld({ type: "PRACTICE" });
		await db.exam.setAnswerHistory(
			{ course: world.course.id, slug: world.exam.slug },
			true,
			FULL_ACCESS,
		);
		const second = await persistedResponseFactory.create({
			course: world.course.id,
			exam: world.exam.slug,
			author: world.student.username,
			practiceSession: new Date(Date.now() + 3_600_000),
		});
		await prisma.response.update({
			where: { id: world.attempt.id },
			data: { createdAt: new Date(Date.now() - 600_000) },
		});
		expect(second.publicId).not.toBe(world.attempt.publicId);

		// The first attempt types for 63.9 s; the second only pastes.
		await seedNormalHistory(world);
		const later = await db.answerEdit.append(
			{
				course: world.course.id,
				exam: world.exam.slug,
				attempt: second.publicId,
				fields: [
					{
						question: world.slugs.text,
						field: "answer",
						batch: appendBatch("", "second attempt", { batchId: "other-1" }),
					},
				],
			},
			{ actor: world.student },
		);
		receiptOf(later.results[0] as Parameters<typeof receiptOf>[0]);

		const summary = await questionSummary(world);

		expect(summary.activeMs).toBe(63_900);
		expect(summary.firstAt).toEqual(NORMAL_FIRST_AT);
		expect(summary.pastes).toEqual({ count: 1, chars: 120 });
	});
});
