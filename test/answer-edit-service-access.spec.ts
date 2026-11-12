/**
 * `db.answerEdit`: who may send, when the attempt still takes history, and
 * the per-exam switch (spec `dev/specs/to-review/historico-de-edicao-no-servidor.md`,
 * R4, R5, R14, R15). The clock is injected through `now`; nothing waits.
 */
import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { ANSWER_HISTORY_LATE_MS } from "@/core/constants";
import { InvalidData, NotFound } from "@/core/error";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedUserFactory } from "@/fixtures/user.factory";
import {
	appendBatch,
	enroll,
	GRACE,
	historyOf,
	inspect,
	MINUTE,
	makeWorld,
	otherAttempt,
	receiptOf,
	ref,
	send,
	sendBatch,
	snapshotRows,
	storedField,
	T0,
	type World,
} from "./answer-edit-service-support";

const LATE = ANSWER_HISTORY_LATE_MS;

/// The error of a call, or null when it resolved.
async function failure(call: Promise<unknown>): Promise<unknown> {
	try {
		await call;
		return null;
	} catch (error) {
		return error;
	}
}

test.describe("R4: identity comes from the server", () => {
	test("an attempt of another student, of another exam, of another course and a missing one answer NotFound alike", async () => {
		const world = await makeWorld();
		const { attempt: strangers } = await otherAttempt(world);
		const secondExam = await makeWorld();
		const batch = appendBatch("", "a");
		const item = [{ question: world.slugs.text, field: "answer", batch }];
		const call = (over: Record<string, unknown>) =>
			failure(
				db.answerEdit.append(
					{ ...ref(world), fields: item, ...over } as never,
					{ actor: world.student },
				),
			);

		const errors = [
			await call({ attempt: strangers.publicId }),
			await call({ exam: secondExam.exam.slug }),
			await call({ course: secondExam.course.id }),
			await call({ attempt: "no-such-attempt" }),
		];

		for (const error of errors) expect(error).toBeInstanceOf(NotFound);
		const messages = new Set(errors.map((e) => (e as NotFound).message));
		expect(messages.size).toBe(1);
		expect(await historyOf(world)).toBeNull();
		expect(await snapshotRows(secondExam)).toBeNull();
	});

	test("the same holds for inspect", async () => {
		const world = await makeWorld();
		const { attempt: strangers } = await otherAttempt(world);

		const errors = await Promise.all([
			failure(
				db.answerEdit.inspect(
					{ ...ref(world), attempt: strangers.publicId },
					{ actor: world.student },
				),
			),
			failure(
				db.answerEdit.inspect(
					{ ...ref(world), attempt: "no-such-attempt" },
					{ actor: world.student },
				),
			),
		]);

		for (const error of errors) expect(error).toBeInstanceOf(NotFound);
	});

	test("the instructor of the course cannot send, nor inspect: only the author", async () => {
		const world = await makeWorld();
		const batch = appendBatch("", "a");

		const sent = await failure(
			db.answerEdit.append(
				{
					...ref(world),
					fields: [{ question: world.slugs.text, field: "answer", batch }],
				},
				{ actor: world.instructor },
			),
		);
		const read = await failure(
			db.answerEdit.inspect(ref(world), { actor: world.instructor }),
		);

		expect(sent).toBeInstanceOf(NotFound);
		expect(read).toBeInstanceOf(NotFound);
		expect(await historyOf(world)).toBeNull();
	});

	test("an admin and a student outside the course cannot send either", async () => {
		const world = await makeWorld();
		const admin = await persistedUserFactory.create({ role: "ADMIN" });
		const outsider = await persistedUserFactory.create({ role: "STUDENT" });
		const fields = [
			{
				question: world.slugs.text,
				field: "answer",
				batch: appendBatch("", "a"),
			},
		];

		for (const actor of [admin, outsider]) {
			const error = await failure(
				db.answerEdit.append({ ...ref(world), fields }, { actor }),
			);
			expect(error).toBeInstanceOf(NotFound);
		}
		expect(await historyOf(world)).toBeNull();
	});

	test("another enrolled student cannot write into the attempt of a classmate", async () => {
		const world = await makeWorld();
		const classmate = await enroll(world.course.id);

		const error = await failure(
			db.answerEdit.append(
				{
					...ref(world),
					fields: [
						{
							question: world.slugs.text,
							field: "answer",
							batch: appendBatch("", "a"),
						},
					],
				},
				{ actor: classmate },
			),
		);

		expect(error).toBeInstanceOf(NotFound);
		expect(await historyOf(world)).toBeNull();
	});

	test("an author or attempt id smuggled into the request never moves the history to another attempt", async () => {
		const world = await makeWorld();
		const { student: classmate, attempt: theirs } = await otherAttempt(world);
		const mine = {
			question: world.slugs.text,
			field: "answer",
			batch: appendBatch("", "mine"),
			author: classmate.username,
			attemptId: theirs.id,
			responseId: theirs.id,
		};

		const outcome = await failure(
			db.answerEdit.append(
				{
					...ref(world),
					author: classmate.username,
					responseId: theirs.id,
					fields: [mine],
				} as never,
				{ actor: world.student },
			),
		);

		// The extra keys are either ignored (the batch lands on the author's own
		// attempt) or the call is refused as invalid; never a write to theirs.
		if (outcome === null) {
			expect(await historyOf(world)).not.toBeNull();
		} else {
			expect(outcome).toBeInstanceOf(InvalidData);
		}
		expect(
			await prisma.answerEditHistory.count({
				where: { responseId: theirs.id },
			}),
		).toBe(0);
	});

	test("a lateMs forged by the client is never stored", async () => {
		const world = await makeWorld();
		const forged = { ...appendBatch("", "a"), lateMs: 12_345 };

		await sendBatch(world, forged as never);

		const stored = await storedField(world);
		for (const row of stored?.batches ?? []) expect(row.lateMs).toBeNull();
	});
});

test.describe("R14: the write window", () => {
	/// An attempt that started at T0 on a 60 minute exam: its deadline is T0 + 60 min.
	const deadline = new Date(T0.getTime() + 60 * MINUTE);
	const at = (ms: number) => new Date(deadline.getTime() + GRACE + ms);

	async function sentAt(world: World, now: Date, text = "a") {
		return sendBatch(world, appendBatch("", text), { now });
	}

	test("a batch inside the deadline is accepted with no lateness", async () => {
		const world = await makeWorld({ startAtT0: true });
		const result = await sentAt(world, new Date(T0.getTime() + 10 * MINUTE));
		expect(result.kind).toBe("accepted");
		expect((await storedField(world))?.batches[0]?.lateMs).toBeNull();
	});

	test("the answer grace is not late: exactly deadline + grace is accepted without lateMs", async () => {
		const world = await makeWorld({ startAtT0: true });
		const result = await sentAt(world, at(0));
		expect(result.kind).toBe("accepted");
		expect((await storedField(world))?.batches[0]?.lateMs).toBeNull();
	});

	test("one millisecond past deadline + grace is accepted and recorded as 1 ms late", async () => {
		const world = await makeWorld({ startAtT0: true });
		const result = await sentAt(world, at(1));
		expect(result.kind).toBe("accepted");
		expect((await storedField(world))?.batches[0]?.lateMs).toBe(1);
	});

	test("lateMs is the time past deadline + grace", async () => {
		const world = await makeWorld({ startAtT0: true });
		await sentAt(world, at(7_000));
		expect((await storedField(world))?.batches[0]?.lateMs).toBe(7_000);
	});

	test("the last millisecond of the late window is accepted", async () => {
		const world = await makeWorld({ startAtT0: true });
		const result = await sentAt(world, at(LATE - 1));
		expect(result.kind).toBe("accepted");
		expect((await storedField(world))?.batches[0]?.lateMs).toBe(LATE - 1);
	});

	test("one millisecond after the late window the batch is closed by deadline and nothing is stored", async () => {
		const world = await makeWorld({ startAtT0: true });

		const result = await sentAt(world, at(LATE + 1));

		expect(result).toMatchObject({ kind: "closed", reason: "deadline" });
		expect(await historyOf(world)).toBeNull();
	});

	test("gap markers follow the same window", async () => {
		const world = await makeWorld({ startAtT0: true });
		const item = {
			question: world.slugs.text,
			field: "answer",
			gaps: [{ reason: "x" }],
		};

		const late = await send(world, [item], at(LATE + 1));
		expect(late.results[0]).toMatchObject({
			kind: "closed",
			reason: "deadline",
		});
		expect(await historyOf(world)).toBeNull();

		const inside = await send(world, [item], at(5));
		expect(inside.results[0]?.kind).not.toBe("closed");
		expect((await storedField(world))?.gaps).toHaveLength(1);
	});

	test("an exception with extra time moves the deadline of its student", async () => {
		const world = await makeWorld({ startAtT0: true });
		await db.examException.create(
			{
				course: world.course.id,
				exam: world.exam.slug,
				username: world.student.username,
				extraTime: { minutes: 30 },
			},
			FULL_ACCESS,
		);
		const extended = new Date(deadline.getTime() + 30 * MINUTE);

		const insideExtra = await sentAt(
			world,
			new Date(extended.getTime() - MINUTE),
		);
		expect(insideExtra.kind).toBe("accepted");
		expect((await storedField(world))?.batches[0]?.lateMs).toBeNull();

		const next = appendBatch("a", "b", {
			baseRevision: 1,
			firstSeq: 1,
			batchId: "s:1",
		});
		const lateInExtra = await sendBatch(world, next, {
			now: new Date(extended.getTime() + GRACE + 2_000),
		});
		expect(lateInExtra.kind).toBe("accepted");
		const rows = (await storedField(world))?.batches;
		expect(rows?.[1]?.lateMs).toBe(2_000);

		const after = appendBatch("ab", "c", {
			baseRevision: 2,
			firstSeq: 2,
			batchId: "s:2",
		});
		const past = await sendBatch(world, after, {
			now: new Date(extended.getTime() + GRACE + LATE + 1),
		});
		expect(past).toMatchObject({ kind: "closed", reason: "deadline" });
	});

	test("the same minute is closed for a student without the exception", async () => {
		const world = await makeWorld({ startAtT0: true });
		const result = await sentAt(
			world,
			new Date(deadline.getTime() + 5 * MINUTE),
		);
		expect(result).toMatchObject({ kind: "closed", reason: "deadline" });
	});

	test("an exam closed by status, with no deadline or delivery to measure from, is closed with no window", async () => {
		const world = await makeWorld({ status: "COMPLETED" });
		const result = await sendBatch(world, appendBatch("", "a"), {
			now: new Date(Date.now() + 1_000),
		});
		expect(result.kind).toBe("closed");
		expect(await historyOf(world)).toBeNull();
	});

	test("an idempotent retry of a stored batch still gets its receipt after the window", async () => {
		const world = await makeWorld({ startAtT0: true });
		const batch = appendBatch("", "abc");
		const first = await sendBatch(world, batch, {
			now: new Date(T0.getTime() + MINUTE),
		});
		const rows = await snapshotRows(world);

		const retry = await sendBatch(world, batch, { now: at(LATE * 10) });

		expect(retry.kind).toBe("accepted");
		expect(receiptOf(retry)).toEqual(receiptOf(first));
		expect(await snapshotRows(world)).toEqual(rows);
	});

	test("a different batch after the window is still closed", async () => {
		const world = await makeWorld({ startAtT0: true });
		await sentAt(world, new Date(T0.getTime() + MINUTE));
		const next = appendBatch("a", "b", {
			baseRevision: 1,
			firstSeq: 1,
			batchId: "s:1",
		});

		const result = await sendBatch(world, next, { now: at(LATE * 10) });

		expect(result).toMatchObject({ kind: "closed", reason: "deadline" });
		expect((await storedField(world))?.batches).toHaveLength(1);
	});

	test("inspect says whether the field can still be written", async () => {
		const world = await makeWorld({ startAtT0: true });
		await sentAt(world, new Date(T0.getTime() + MINUTE));

		const open = await inspect(world, new Date(T0.getTime() + 2 * MINUTE));
		const late = await inspect(world, at(5));
		const closed = await inspect(world, at(LATE + 1));

		expect(open.fields[0]?.canWrite).toBe(true);
		expect(late.fields[0]?.canWrite).toBe(true);
		expect(closed.fields[0]?.canWrite).toBe(false);
	});
});

test.describe("R14: a delivered attempt", () => {
	/// The moment the attempt was closed, as the database holds it.
	async function finish(world: World): Promise<Date> {
		await db.response.finish(
			{ course: world.course.id, exam: world.exam.slug },
			{ actor: world.student },
		);
		const row = await prisma.response.findUniqueOrThrow({
			where: { id: world.attempt.id },
		});
		expect(row.acceptingSubmissions).toBe(false);
		return row.updatedAt;
	}

	test("a batch that left in parallel with the delivery is accepted and recorded as late", async () => {
		const world = await makeWorld();
		const closedAt = await finish(world);

		const result = await sendBatch(world, appendBatch("", "last words"), {
			now: new Date(closedAt.getTime() + 2_000),
		});

		expect(result.kind).toBe("accepted");
		const lateMs = (await storedField(world))?.batches[0]?.lateMs;
		expect(lateMs).not.toBeNull();
		// The close instant is read from the row; allow for the few ms a separate field may differ.
		expect(Math.abs((lateMs ?? 0) - 2_000)).toBeLessThan(250);
	});

	test("well after the delivery the window is shut with reason finished", async () => {
		const world = await makeWorld();
		const closedAt = await finish(world);

		const result = await sendBatch(world, appendBatch("", "too late"), {
			now: new Date(closedAt.getTime() + LATE + 2_000),
		});

		expect(result).toMatchObject({ kind: "closed", reason: "finished" });
		expect(await historyOf(world)).toBeNull();
	});

	test("just inside the 30 seconds is still open", async () => {
		const world = await makeWorld();
		const closedAt = await finish(world);

		const result = await sendBatch(world, appendBatch("", "ok"), {
			now: new Date(closedAt.getTime() + LATE - 2_000),
		});

		expect(result.kind).toBe("accepted");
	});

	test("a retry of a stored batch after the delivery still gets its receipt", async () => {
		const world = await makeWorld();
		const batch = appendBatch("", "abc");
		const first = await sendBatch(world, batch);
		const closedAt = await finish(world);

		const retry = await sendBatch(world, batch, {
			now: new Date(closedAt.getTime() + 10 * LATE),
		});

		expect(receiptOf(retry)).toEqual(receiptOf(first));
	});

	test("an attempt the instructor reopened takes history again", async () => {
		const world = await makeWorld();
		const closedAt = await finish(world);
		await db.response.update(
			{ id: world.attempt.id },
			{ acceptingSubmissions: true },
			{ actor: world.instructor },
		);
		const later = new Date(closedAt.getTime() + 10 * LATE);

		const result = await sendBatch(world, appendBatch("", "again"), {
			now: later,
		});

		expect(result.kind).toBe("accepted");
		expect((await storedField(world))?.batches[0]?.lateMs).toBeNull();
	});
});

test.describe("R15: the exam switch", () => {
	function setSwitch(world: World, value: boolean | null) {
		return prisma.exam.update({
			where: { id: world.exam.id },
			data: { answerHistory: value },
		});
	}

	test("with the switch off nothing is stored and every item is closed as disabled", async () => {
		const world = await makeWorld();
		await setSwitch(world, false);

		const response = await send(world, [
			{
				question: world.slugs.text,
				field: "answer",
				batch: appendBatch("", "a"),
			},
			{
				question: world.slugs.code,
				field: "answer",
				gaps: [{ reason: "x" }],
			},
		]);

		expect(response.enabled).toBe(false);
		expect(response.results).toMatchObject([
			{ kind: "closed", reason: "disabled" },
			{ kind: "closed", reason: "disabled" },
		]);
		expect(await historyOf(world)).toBeNull();
	});

	test("a batch collected before the switch went off and sent after is refused; the history stops there", async () => {
		const world = await makeWorld();
		const first = appendBatch("", "before");
		const pending = appendBatch("before", " after", {
			baseRevision: 1,
			firstSeq: 6,
			batchId: "s:6",
		});
		await sendBatch(world, first);
		const rows = await snapshotRows(world);
		await setSwitch(world, false);

		const result = await sendBatch(world, pending);

		expect(result).toMatchObject({ kind: "closed", reason: "disabled" });
		expect(await snapshotRows(world)).toEqual(rows);
		expect((await storedField(world))?.text).toBe("before");
	});

	test("a batch with an old time origin is judged by the switch now, not by when it was collected", async () => {
		const world = await makeWorld();
		await setSwitch(world, false);
		const old = appendBatch("", "old", { timeOriginMs: 0 });

		expect(await sendBatch(world, old)).toMatchObject({
			kind: "closed",
			reason: "disabled",
		});
	});

	test("an identical retry of a batch stored before still gets its receipt", async () => {
		const world = await makeWorld();
		const batch = appendBatch("", "abc");
		const first = await sendBatch(world, batch);
		await setSwitch(world, false);
		const rows = await snapshotRows(world);

		const retry = await sendBatch(world, batch);

		expect(retry.kind).toBe("accepted");
		expect(receiptOf(retry)).toEqual(receiptOf(first));
		expect(await snapshotRows(world)).toEqual(rows);
	});

	test("the same id with other content after the switch went off is not a receipt", async () => {
		const world = await makeWorld();
		const batch = appendBatch("", "abc");
		await sendBatch(world, batch);
		await setSwitch(world, false);

		const result = await sendBatch(world, {
			...appendBatch("", "xyz"),
			batchId: batch.batchId,
		});

		expect(result.kind).not.toBe("accepted");
		expect((await storedField(world))?.text).toBe("abc");
	});

	test("inspect reports the switch and nothing can be written", async () => {
		const world = await makeWorld();
		await sendBatch(world, appendBatch("", "abc"));
		await setSwitch(world, false);

		const state = await inspect(world);

		expect(state.enabled).toBe(false);
		expect(state.fields).toHaveLength(1);
		expect(state.fields[0]).toMatchObject({ text: "abc", canWrite: false });
	});

	test("turning the switch on again lets the next batch in", async () => {
		const world = await makeWorld();
		await setSwitch(world, false);
		const batch = appendBatch("", "abc");
		expect((await sendBatch(world, batch)).kind).toBe("closed");

		await setSwitch(world, true);

		expect((await sendBatch(world, batch)).kind).toBe("accepted");
	});

	test("the default follows the exam type: on for EXAM and QUIZ, off for PRACTICE", async () => {
		for (const [type, enabled] of [
			["EXAM", true],
			["QUIZ", true],
			["PRACTICE", false],
		] as const) {
			const world = await makeWorld({ type });
			const state = await inspect(world);
			expect(state.enabled, type).toBe(enabled);

			const result = await sendBatch(world, appendBatch("", "a"));
			expect(result.kind, type).toBe(enabled ? "accepted" : "closed");
			if (!enabled) {
				expect(result).toMatchObject({ reason: "disabled" });
				expect(await historyOf(world)).toBeNull();
			}
		}
	});

	test("an explicit switch beats the type, both ways", async () => {
		const practice = await makeWorld({ type: "PRACTICE" });
		await setSwitch(practice, true);
		expect((await sendBatch(practice, appendBatch("", "a"))).kind).toBe(
			"accepted",
		);

		const exam = await makeWorld({ type: "EXAM" });
		await setSwitch(exam, false);
		expect((await inspect(exam)).enabled).toBe(false);
	});
});

test.describe("R5: inspect", () => {
	test("an attempt with no history has no fields and the switch value", async () => {
		const world = await makeWorld();
		expect(await inspect(world)).toEqual({ enabled: true, fields: [] });
	});

	test("each stored field comes back with its text, counters and receipts", async () => {
		const world = await makeWorld();
		await sendBatch(world, appendBatch("", "abc"));
		await sendBatch(
			world,
			appendBatch("abc", "de", {
				baseRevision: 1,
				firstSeq: 3,
				batchId: "s:3",
			}),
		);
		await sendBatch(world, appendBatch("", "code"), {
			question: world.slugs.code,
		});

		const state = await inspect(world);

		expect(state.enabled).toBe(true);
		const byQuestion = new Map(state.fields.map((f) => [f.question, f]));
		expect(byQuestion.size).toBe(2);
		expect(byQuestion.get(world.slugs.text)).toEqual({
			question: world.slugs.text,
			field: "answer",
			text: "abcde",
			revision: 2,
			nextSeq: 5,
			canWrite: true,
			receipts: [
				{ batchId: "session-1:0", revision: 1, lastSeq: 2 },
				{ batchId: "s:3", revision: 2, lastSeq: 4 },
			],
		});
		expect(byQuestion.get(world.slugs.code)).toMatchObject({
			text: "code",
			revision: 1,
			nextSeq: 4,
		});
	});

	test("only the 32 most recent receipts come back, in order of revision", async () => {
		const world = await makeWorld();
		let text = "";
		for (let i = 0; i < 40; i++) {
			const batch = appendBatch(text, "x", {
				baseRevision: i,
				firstSeq: i,
				batchId: `b:${i}`,
				base: i === 0 ? "start" : "none",
			});
			expect((await sendBatch(world, batch)).kind).toBe("accepted");
			text += "x";
		}

		const field = (await inspect(world)).fields[0];

		expect(field?.revision).toBe(40);
		expect(field?.receipts).toHaveLength(32);
		expect(field?.receipts.map((r) => r.revision)).toEqual(
			Array.from({ length: 32 }, (_, i) => i + 9),
		);
		expect(field?.receipts.at(-1)).toEqual({
			batchId: "b:39",
			revision: 40,
			lastSeq: 39,
		});
	});

	test("inspect reads only: it creates no rows", async () => {
		const world = await makeWorld();
		await inspect(world);
		expect(await historyOf(world)).toBeNull();
	});
});
