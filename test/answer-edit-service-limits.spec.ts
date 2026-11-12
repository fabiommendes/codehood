/**
 * `db.answerEdit.append`: the size limits, numbers the database cannot hold,
 * and the independence from the saved answer (spec
 * `dev/specs/to-review/historico-de-edicao-no-servidor.md`, R16 to R20).
 */
import { expect, test } from "@playwright/test";
import {
	MAX_ANSWER_HISTORY_ATTEMPT_BYTES,
	MAX_ANSWER_HISTORY_ATTEMPT_EDITS,
	MAX_ANSWER_HISTORY_BATCH_BYTES,
	MAX_ANSWER_HISTORY_BATCH_EDITS,
	MAX_ANSWER_HISTORY_REQUEST_BYTES,
	MAX_ANSWER_HISTORY_TEXT_BYTES,
} from "@/core/constants";
import { db } from "@/db";
import { prisma } from "@/db/client";
import {
	appendBatch,
	historyOf,
	inspect,
	itemBytes,
	itemOfBytes,
	makeBatch,
	makeWorld,
	receiptOf,
	send,
	sendBatch,
	snapshotRows,
	storedField,
	type World,
} from "./answer-edit-service-support";

/// `bytes` bytes of UTF-8 text made of two-byte characters (and one ASCII for an odd count).
function textOfBytes(bytes: number): string {
	return "é".repeat(Math.floor(bytes / 2)) + (bytes % 2 ? "a" : "");
}

/// One batch that inserts all of `text` into an empty field.
function inserting(text: string, batchId = "big:0") {
	return makeBatch({
		steps: [{ position: 0, deleteCount: 0, insertedText: text }],
		batchId,
	});
}

test.describe("R16: the text of one field", () => {
	const LIMIT = MAX_ANSWER_HISTORY_TEXT_BYTES;

	test("a snapshot of exactly 128 KiB is accepted", async () => {
		const world = await makeWorld();
		const text = textOfBytes(LIMIT);
		expect(Buffer.byteLength(text)).toBe(LIMIT);

		const result = await sendBatch(world, inserting(text));

		expect(result.kind).toBe("accepted");
		expect((await storedField(world))?.text).toBe(text);
		expect((await storedField(world))?.incompleteAt).toBeNull();
	});

	test("one byte more closes the field as limit: nothing stored, the field is marked incomplete", async () => {
		const world = await makeWorld();
		const text = textOfBytes(LIMIT + 1);

		const result = await sendBatch(world, inserting(text));

		expect(result).toMatchObject({ kind: "closed", reason: "limit" });
		const stored = await storedField(world);
		expect(stored?.batches ?? []).toEqual([]);
		expect(stored?.incompleteAt).not.toBeNull();
		expect(stored?.text).toBe("");
		expect((await historyOf(world))?.incompleteAt).toBeNull();
	});

	test("the limit counts bytes: 65537 two-byte characters are over, 131073 ASCII characters too", async () => {
		const multibyte = await makeWorld();
		const ascii = await makeWorld();

		const a = await sendBatch(multibyte, inserting("é".repeat(65_537)));
		const b = await sendBatch(ascii, inserting("a".repeat(LIMIT + 1)));

		expect(a).toMatchObject({ kind: "closed", reason: "limit" });
		expect(b).toMatchObject({ kind: "closed", reason: "limit" });
	});

	test("a text with fewer characters than the limit but more bytes is over", async () => {
		const world = await makeWorld();
		const text = "😀".repeat(LIMIT / 4 + 1);
		expect(text.length).toBeLessThan(LIMIT);

		const result = await sendBatch(world, inserting(text));

		expect(result).toMatchObject({ kind: "closed", reason: "limit" });
	});

	test("a field that outgrew the limit refuses its later batches, small or not, and keeps its anchor", async () => {
		const world = await makeWorld();
		const full = textOfBytes(LIMIT);
		await sendBatch(world, inserting(full, "a:0"));
		const grow = appendBatch(full, "a", {
			baseRevision: 1,
			firstSeq: 1,
			batchId: "a:1",
		});
		expect(await sendBatch(world, grow)).toMatchObject({
			kind: "closed",
			reason: "limit",
		});
		const rows = await snapshotRows(world);
		const small = makeBatch({
			start: full,
			steps: [{ position: 0, deleteCount: full.length, insertedText: "" }],
			baseRevision: 1,
			firstSeq: 1,
			batchId: "a:2",
		});

		const result = await sendBatch(world, small);

		expect(result).toMatchObject({ kind: "closed", reason: "limit" });
		expect(await snapshotRows(world)).toEqual(rows);
		const stored = await storedField(world);
		expect(stored?.text).toBe(full);
		expect(stored?.incompleteAt).not.toBeNull();
	});

	test("another field of the same attempt keeps taking batches", async () => {
		const world = await makeWorld();
		await sendBatch(world, inserting(textOfBytes(LIMIT + 1)));

		const other = await sendBatch(world, appendBatch("", "fine"), {
			question: world.slugs.code,
		});

		expect(other.kind).toBe("accepted");
	});

	test("a base text over the limit closes the field even when the snapshot is small", async () => {
		const world = await makeWorld();
		const base = textOfBytes(LIMIT + 1);
		const batch = makeBatch({
			start: base,
			steps: [{ position: 0, deleteCount: base.length, insertedText: "ok" }],
			base: { reason: "start", text: base },
		});

		const result = await sendBatch(world, batch);

		expect(result).toMatchObject({ kind: "closed", reason: "limit" });
		expect((await storedField(world))?.batches ?? []).toEqual([]);
	});

	test("the limit never surfaces as a thrown error", async () => {
		const world = await makeWorld();
		await expect(
			send(world, [
				{
					question: world.slugs.text,
					field: "answer",
					batch: inserting(textOfBytes(LIMIT * 3)),
				},
			]),
		).resolves.toMatchObject({
			results: [{ kind: "closed", reason: "limit" }],
		});
	});
});

test.describe("R17: one batch", () => {
	test("exactly 5000 edits are accepted, with multibyte text", async () => {
		const world = await makeWorld();
		const batch = appendBatch("", "é".repeat(MAX_ANSWER_HISTORY_BATCH_EDITS));
		expect(batch.edits).toHaveLength(MAX_ANSWER_HISTORY_BATCH_EDITS);

		const result = await sendBatch(world, batch);

		expect(result.kind).toBe("accepted");
		expect(receiptOf(result).lastSeq).toBe(MAX_ANSWER_HISTORY_BATCH_EDITS - 1);
	});

	test("5001 edits are a too-large conflict and leave a batch-too-large gap", async () => {
		const world = await makeWorld();
		const batch = appendBatch(
			"",
			"é".repeat(MAX_ANSWER_HISTORY_BATCH_EDITS + 1),
		);

		const result = await sendBatch(world, batch);

		expect(result).toMatchObject({ kind: "conflict", reason: "too-large" });
		const stored = await storedField(world);
		expect(stored?.batches ?? []).toEqual([]);
		expect(stored?.text).toBe("");
		expect(stored?.revision).toBe(0);
		expect(stored?.gaps.map((g) => g.reason)).toEqual(["batch-too-large"]);
		expect(stored?.incompleteAt).toBeNull();
	});

	test("after a too-large batch the client rebases and the history goes on", async () => {
		const world = await makeWorld();
		const text = "é".repeat(MAX_ANSWER_HISTORY_BATCH_EDITS + 1);
		await sendBatch(world, appendBatch("", text));
		const state = (await inspect(world)).fields[0];
		expect(state).toMatchObject({ revision: 0, nextSeq: 0 });

		const rebased = appendBatch(text, "!", {
			baseRevision: 0,
			firstSeq: 0,
			batchId: "rebased:0",
			base: { reason: "rebase", text },
		});
		const result = await sendBatch(world, rebased);

		expect(result.kind).toBe("accepted");
		expect((await storedField(world))?.text).toBe(`${text}!`);
	});

	const BATCH_LIMIT = MAX_ANSWER_HISTORY_BATCH_BYTES;
	const shape = { chunks: 13, chunkSize: 30_000 };

	test("an item of exactly 512 KiB of JSON is accepted", async () => {
		const world = await makeWorld();
		const item = itemOfBytes(world.slugs.text, BATCH_LIMIT, {
			...shape,
			batchId: "fat:0",
		});
		expect(itemBytes(item)).toBe(BATCH_LIMIT);

		const { results } = await send(world, [item]);

		expect(results[0]?.kind).toBe("accepted");
	});

	test("an item one byte over is a too-large conflict with a batch-too-large gap", async () => {
		const world = await makeWorld();
		const item = itemOfBytes(world.slugs.text, BATCH_LIMIT + 1, {
			...shape,
			batchId: "fat:0",
		});
		expect(itemBytes(item)).toBe(BATCH_LIMIT + 1);

		const { results } = await send(world, [item]);

		expect(results[0]).toMatchObject({ kind: "conflict", reason: "too-large" });
		const stored = await storedField(world);
		expect(stored?.batches ?? []).toEqual([]);
		expect(stored?.gaps.map((g) => g.reason)).toEqual(["batch-too-large"]);
	});

	test("the stored byteCount of a batch is the JSON of its item", async () => {
		const world = await makeWorld();
		const batch = appendBatch("", "héllo 😀");
		const item = { question: world.slugs.text, field: "answer", batch };

		await send(world, [item]);

		expect((await storedField(world))?.batches[0]?.byteCount).toBe(
			itemBytes(item),
		);
	});
});

test.describe("R18: one attempt", () => {
	/// An attempt whose history already holds one three-edit batch.
	async function seeded() {
		const world = await makeWorld();
		await sendBatch(world, appendBatch("", "abc"));
		return world;
	}

	function next(world: World, edits = 3, id = "n:3") {
		return {
			question: world.slugs.text,
			field: "answer",
			batch: appendBatch("abc", "d".repeat(edits), {
				baseRevision: 1,
				firstSeq: 3,
				batchId: id,
			}),
		};
	}

	function setTotals(
		world: World,
		data: { editCount?: number; byteCount?: number },
	) {
		return prisma.answerEditHistory.update({
			where: { responseId: world.attempt.id },
			data,
		});
	}

	test("a batch that brings the edits exactly to 100000 is accepted", async () => {
		const world = await seeded();
		await setTotals(world, {
			editCount: MAX_ANSWER_HISTORY_ATTEMPT_EDITS - 3,
		});

		const { results } = await send(world, [next(world)]);

		expect(results[0]?.kind).toBe("accepted");
		expect((await historyOf(world))?.editCount).toBe(
			MAX_ANSWER_HISTORY_ATTEMPT_EDITS,
		);
		expect((await historyOf(world))?.incompleteAt).toBeNull();
	});

	test("one edit over marks the attempt incomplete and the batch is not stored", async () => {
		const world = await seeded();
		await setTotals(world, {
			editCount: MAX_ANSWER_HISTORY_ATTEMPT_EDITS - 2,
		});

		const { results } = await send(world, [next(world)]);

		expect(results[0]).toMatchObject({ kind: "closed", reason: "limit" });
		const history = await historyOf(world);
		expect(history?.incompleteAt).not.toBeNull();
		expect(history?.editCount).toBe(MAX_ANSWER_HISTORY_ATTEMPT_EDITS - 2);
		expect((await storedField(world))?.batches).toHaveLength(1);
	});

	test("a batch that brings the bytes exactly to 4 MiB is accepted", async () => {
		const world = await seeded();
		const item = next(world);
		await setTotals(world, {
			byteCount: MAX_ANSWER_HISTORY_ATTEMPT_BYTES - itemBytes(item),
		});

		const { results } = await send(world, [item]);

		expect(results[0]?.kind).toBe("accepted");
		expect((await historyOf(world))?.byteCount).toBe(
			MAX_ANSWER_HISTORY_ATTEMPT_BYTES,
		);
	});

	test("one byte over is closed as limit and marks the attempt incomplete", async () => {
		const world = await seeded();
		const item = next(world);
		await setTotals(world, {
			byteCount: MAX_ANSWER_HISTORY_ATTEMPT_BYTES - itemBytes(item) + 1,
		});

		const { results } = await send(world, [item]);

		expect(results[0]).toMatchObject({ kind: "closed", reason: "limit" });
		expect((await historyOf(world))?.incompleteAt).not.toBeNull();
		expect((await storedField(world))?.batches).toHaveLength(1);
	});

	test("once incomplete, every item of this and of later calls is closed as limit, on any field", async () => {
		const world = await seeded();
		await setTotals(world, {
			editCount: MAX_ANSWER_HISTORY_ATTEMPT_EDITS - 1,
		});
		await send(world, [next(world)]);
		const rows = await snapshotRows(world);
		const items = [
			next(world, 1, "again:3"),
			{
				question: world.slugs.code,
				field: "answer",
				batch: appendBatch("", "x"),
			},
			{ question: world.slugs.text, field: "answer", gaps: [{ reason: "g" }] },
		];

		const first = await send(world, items);
		const second = await send(world, items);

		for (const { results } of [first, second]) {
			expect(results).toMatchObject([
				{ kind: "closed", reason: "limit" },
				{ kind: "closed", reason: "limit" },
				{ kind: "closed", reason: "limit" },
			]);
		}
		expect(await snapshotRows(world)).toEqual(rows);
	});

	test("the answer path is not touched: the call resolves", async () => {
		const world = await seeded();
		await setTotals(world, { editCount: MAX_ANSWER_HISTORY_ATTEMPT_EDITS });
		await expect(send(world, [next(world)])).resolves.toMatchObject({
			results: [{ kind: "closed", reason: "limit" }],
		});
	});
});

test.describe("R19: one call", () => {
	test("after the items processed pass 2 MiB, the rest come back as retry and store nothing", async () => {
		const world = await makeWorld({ extraEssays: 8 });
		const each = 450_000;
		expect(4 * each).toBeLessThan(MAX_ANSWER_HISTORY_REQUEST_BYTES);
		expect(5 * each).toBeGreaterThan(MAX_ANSWER_HISTORY_REQUEST_BYTES);
		const items = world.slugs.extra.map((slug, i) =>
			itemOfBytes(slug, each, {
				chunks: 12,
				chunkSize: 30_000,
				batchId: `bulk${i}:0`,
			}),
		);

		const { results } = await send(world, items);

		expect(results.map((r) => r.kind)).toEqual([
			"accepted",
			"accepted",
			"accepted",
			"accepted",
			"accepted",
			"retry",
			"retry",
			"retry",
		]);
		for (const slug of world.slugs.extra.slice(5)) {
			expect(await storedField(world, slug)).toBeNull();
		}

		const again = await send(world, items.slice(5));
		expect(again.results.map((r) => r.kind)).toEqual([
			"accepted",
			"accepted",
			"accepted",
		]);
	});

	test("results keep the order and the names of the items", async () => {
		const world = await makeWorld({ extraEssays: 2 });
		const { results } = await send(
			world,
			world.slugs.extra.map((question, i) => ({
				question,
				field: "answer",
				batch: appendBatch("", `t${i}`, { batchId: `o${i}:0` }),
			})),
		);
		expect(results.map((r) => r.question)).toEqual(world.slugs.extra);
	});
});

test.describe("numbers the database cannot hold", () => {
	const unsafe: [string, unknown][] = [
		["one past 32 bits", 2_147_483_648],
		["a safe integer far past 32 bits", Number.MAX_SAFE_INTEGER],
		["a negative number", -1],
		["a fraction", 1.5],
		["not a number", Number.NaN],
		["infinity", Number.POSITIVE_INFINITY],
		["a numeric string", "5"],
		["null", null],
	];

	for (const [label, value] of unsafe) {
		test(`a timeOriginMs of ${label} is refused for that item and stores nothing`, async () => {
			const world = await makeWorld();
			const batch = { ...appendBatch("", "abc"), timeOriginMs: value };

			const result = await sendBatch(world, batch as never);

			expect(result.kind).toBe("conflict");
			expect(await snapshotRows(world)).toBeNull();
		});
	}

	test("the largest 32-bit timeOriginMs is accepted and stored whole", async () => {
		const world = await makeWorld();
		const batch = appendBatch("", "abc", { timeOriginMs: 2_147_483_647 });

		const result = await sendBatch(world, batch);

		expect(result.kind).toBe("accepted");
		expect((await storedField(world))?.batches[0]?.timeOriginMs).toBe(
			2_147_483_647,
		);
	});

	test("a refused timeOriginMs does not stop the next item", async () => {
		const world = await makeWorld();
		const { results } = await send(world, [
			{
				question: world.slugs.text,
				field: "answer",
				batch: { ...appendBatch("", "a"), timeOriginMs: 2 ** 40 },
			},
			{
				question: world.slugs.code,
				field: "answer",
				batch: appendBatch("", "b"),
			},
		]);
		expect(results.map((r) => r.kind)).toEqual(["conflict", "accepted"]);
	});

	const counters: [string, "baseRevision" | "firstSeq", unknown][] = [
		["a baseRevision past 32 bits", "baseRevision", 2 ** 40],
		["a negative baseRevision", "baseRevision", -1],
		["a fractional baseRevision", "baseRevision", 0.5],
		["a firstSeq past 32 bits", "firstSeq", 2 ** 40],
		["a negative firstSeq", "firstSeq", -1],
		["a fractional firstSeq", "firstSeq", 0.5],
	];

	for (const [label, key, value] of counters) {
		test(`${label} is a conflict, not a database error`, async () => {
			const world = await makeWorld();
			const batch = { ...appendBatch("", "abc"), [key]: value };

			const result = await sendBatch(world, batch as never);

			expect(result.kind).toBe("conflict");
			expect(await snapshotRows(world)).toBeNull();
		});
	}

	test("a sequence that would pass 32 bits is refused without a database error", async () => {
		const world = await makeWorld();
		await send(world, [
			{ question: world.slugs.text, field: "answer", gaps: [{ reason: "x" }] },
		]);
		const field = await storedField(world);
		await prisma.answerEditField.update({
			where: { id: field?.id },
			data: { nextSeq: 2_147_483_646 },
		});
		const batch = appendBatch("", "ab", {
			baseRevision: 0,
			firstSeq: 2_147_483_646,
			batchId: "edge:1",
			base: { reason: "rebase", text: "" },
		});

		const result = await sendBatch(world, batch);

		expect(["conflict", "closed"]).toContain(result.kind);
		expect((await storedField(world))?.batches ?? []).toEqual([]);
		expect((await storedField(world))?.nextSeq).toBe(2_147_483_646);
	});

	test("a revision that would pass 32 bits is refused without a database error", async () => {
		const world = await makeWorld();
		await send(world, [
			{ question: world.slugs.text, field: "answer", gaps: [{ reason: "x" }] },
		]);
		const field = await storedField(world);
		await prisma.answerEditField.update({
			where: { id: field?.id },
			data: { revision: 2_147_483_647 },
		});
		const batch = appendBatch("", "a", {
			baseRevision: 2_147_483_647,
			firstSeq: 0,
			batchId: "edge:2",
			base: { reason: "rebase", text: "" },
		});

		const result = await sendBatch(world, batch);

		expect(["conflict", "closed"]).toContain(result.kind);
		expect((await storedField(world))?.revision).toBe(2_147_483_647);
	});
});

test.describe("independence from the saved answer", () => {
	async function answered() {
		const world = await makeWorld({ extraEssays: 1 });
		await db.submission.create(
			{
				response: { publicId: world.attempt.publicId },
				question: world.slugs.text,
				payload: null,
			},
			{ actor: world.student },
		);
		return world;
	}

	function answerRows(world: World) {
		return Promise.all([
			prisma.response
				.findUnique({ where: { id: world.attempt.id } })
				.then((row) => JSON.parse(JSON.stringify(row))),
			prisma.submission
				.findMany({
					where: { responseId: world.attempt.id },
					orderBy: { id: "asc" },
				})
				.then((rows) => JSON.parse(JSON.stringify(rows))),
		]);
	}

	test("accepting, conflicting and closing batches leave Response and Submission as they were", async () => {
		const world = await answered();
		const before = await answerRows(world);
		expect(before[1]).toHaveLength(1);

		await sendBatch(world, appendBatch("", "stored"));
		await sendBatch(world, { ...appendBatch("", "bad"), snapshot: "nope" });
		await sendBatch(world, appendBatch("", "x"), {
			question: world.slugs.choice,
		});
		await sendBatch(
			world,
			inserting(textOfBytes(MAX_ANSWER_HISTORY_TEXT_BYTES + 1)),
			{
				question: world.slugs.extra[0],
			},
		);
		await send(world, [
			{ question: world.slugs.text, field: "answer", gaps: [{ reason: "g" }] },
		]);

		expect(await answerRows(world)).toEqual(before);
	});

	test("a switched-off exam leaves them alone too", async () => {
		const world = await answered();
		await prisma.exam.update({
			where: { id: world.exam.id },
			data: { answerHistory: false },
		});
		const before = await answerRows(world);

		await sendBatch(world, appendBatch("", "stored"));

		expect(await answerRows(world)).toEqual(before);
	});

	test("the history does not depend on there being a submission, and storing it creates none", async () => {
		const world = await makeWorld();

		await sendBatch(world, appendBatch("", "typed but never saved"));

		expect(
			await prisma.submission.count({
				where: { responseId: world.attempt.id },
			}),
		).toBe(0);
		expect((await storedField(world))?.text).toBe("typed but never saved");
	});
});
