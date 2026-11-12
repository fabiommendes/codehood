/**
 * Guards of the answer-edit history service the larger specs do not reach:
 * the clock override stays out of client requests, the size of a call, the
 * gap reasons, and the pure rules of the write window and of the tracked fields.
 */
import { expect, test } from "@playwright/test";
import { ANSWER_HISTORY_LATE_MS, EXAM_ANSWER_GRACE_MS } from "@/core/constants";
import { InvalidData } from "@/core/error";
import {
	answerEditAppendRequest,
	answerEditAttemptRequest,
} from "@/core/schemas/answer-edit";
import { db } from "@/db";
import { answerHistoryWindow, isHistoryField } from "@/services/answer-history";
import {
	appendBatch,
	makeWorld,
	ref,
	send,
	storedField,
} from "./answer-edit-service-support";

test.describe("the clock override is not a client field", () => {
	const request = {
		course: 1,
		exam: "final",
		attempt: "abc",
		now: new Date(0),
		fields: [],
	};

	test("the append request a client may send drops now", () => {
		const parsed = answerEditAppendRequest.parse(request);
		expect(parsed).not.toHaveProperty("now");
	});

	test("the inspect request a client may send drops now", () => {
		const parsed = answerEditAttemptRequest.parse(request);
		expect(parsed).not.toHaveProperty("now");
	});
});

test.describe("one call", () => {
	test("more than 128 items are refused as a whole", async () => {
		const world = await makeWorld();
		const fields = Array.from({ length: 129 }, () => ({
			question: world.slugs.text,
			field: "answer",
		}));

		await expect(
			db.answerEdit.append({ ...ref(world), fields }, { actor: world.student }),
		).rejects.toBeInstanceOf(InvalidData);
	});

	test("exactly 128 items are answered one by one", async () => {
		const world = await makeWorld();
		const fields = Array.from({ length: 128 }, () => ({
			question: world.slugs.text,
			field: "answer",
		}));

		const { results } = await send(world, fields);

		expect(results).toHaveLength(128);
	});

	test("a request that is not an envelope is refused", async () => {
		const world = await makeWorld();
		await expect(
			db.answerEdit.append(
				{ ...ref(world), fields: "nope" as never },
				{ actor: world.student },
			),
		).rejects.toBeInstanceOf(InvalidData);
	});
});

test.describe("gap reasons", () => {
	test("a reason over 200 characters makes the item invalid and stores nothing of it", async () => {
		const world = await makeWorld();

		const { results } = await send(world, [
			{
				question: world.slugs.text,
				field: "answer",
				batch: appendBatch("", "abc"),
				gaps: [{ reason: "x".repeat(201) }],
			},
		]);

		expect(results[0]).toMatchObject({ kind: "conflict", reason: "invalid" });
		expect(await storedField(world)).toBeNull();
	});

	test("gaps that are not a list make the item invalid", async () => {
		const world = await makeWorld();
		const { results } = await send(world, [
			{ question: world.slugs.text, field: "answer", gaps: "x" as never },
		]);
		expect(results[0]).toMatchObject({ kind: "conflict", reason: "invalid" });
	});
});

test.describe("answerHistoryWindow", () => {
	const deadline = new Date("2026-03-01T11:00:00.000Z");
	const graceEnd = deadline.getTime() + EXAM_ANSWER_GRACE_MS;
	const at = (ms: number) => new Date(ms);

	test("an attempt that takes answers is open and nothing is late", () => {
		expect(
			answerHistoryWindow({
				now: at(graceEnd - 1),
				accepting: true,
				deadline,
				closedAt: null,
			}),
		).toEqual({ open: true, lateMs: null });
	});

	test("the late window counts from the deadline plus grace and ends 30 s later", () => {
		const base = { accepting: false, deadline, closedAt: null };
		expect(answerHistoryWindow({ ...base, now: at(graceEnd) })).toEqual({
			open: true,
			lateMs: 0,
		});
		expect(
			answerHistoryWindow({
				...base,
				now: at(graceEnd + ANSWER_HISTORY_LATE_MS),
			}),
		).toEqual({ open: true, lateMs: ANSWER_HISTORY_LATE_MS });
		expect(
			answerHistoryWindow({
				...base,
				now: at(graceEnd + ANSWER_HISTORY_LATE_MS + 1),
			}),
		).toEqual({ open: false, reason: "deadline" });
	});

	test("a delivery before the deadline moves the start of the window to the delivery", () => {
		const closedAt = at(deadline.getTime() - 20 * 60_000);
		expect(
			answerHistoryWindow({
				now: at(closedAt.getTime() + 5_000),
				accepting: false,
				deadline,
				closedAt,
			}),
		).toEqual({ open: true, lateMs: 5_000 });
		expect(
			answerHistoryWindow({
				now: at(closedAt.getTime() + ANSWER_HISTORY_LATE_MS + 1),
				accepting: false,
				deadline,
				closedAt,
			}),
		).toEqual({ open: false, reason: "finished" });
	});

	test("a delivery after the deadline plus grace is measured from the deadline", () => {
		const closedAt = at(graceEnd + 60_000);
		expect(
			answerHistoryWindow({
				now: at(graceEnd + 10_000),
				accepting: false,
				deadline,
				closedAt,
			}),
		).toEqual({ open: true, lateMs: 10_000 });
	});

	test("with nothing to measure from, or before the start, the window is shut", () => {
		expect(
			answerHistoryWindow({
				now: at(graceEnd),
				accepting: false,
				deadline: null,
				closedAt: null,
			}),
		).toEqual({ open: false, reason: "deadline" });
		expect(
			answerHistoryWindow({
				now: at(graceEnd - 1),
				accepting: false,
				deadline,
				closedAt: null,
			}),
		).toEqual({ open: false, reason: "deadline" });
	});

	test("an untimed attempt that was delivered has a window from the delivery", () => {
		const closedAt = at(1_000_000);
		expect(
			answerHistoryWindow({
				now: at(1_000_000 + 1),
				accepting: false,
				deadline: null,
				closedAt,
			}),
		).toEqual({ open: true, lateMs: 1 });
	});
});

test.describe("isHistoryField", () => {
	test("only the answer of an essay has a history", () => {
		expect(isHistoryField("essay", "answer")).toBe(true);
		expect(isHistoryField("essay", "notes")).toBe(false);
		expect(isHistoryField("multiple-choice", "answer")).toBe(false);
		expect(isHistoryField(undefined, "answer")).toBe(false);
	});
});
