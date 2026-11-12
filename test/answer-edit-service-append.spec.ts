/**
 * `db.answerEdit.append`: which batches are stored, and what comes back
 * (spec `dev/specs/to-do/historico-de-edicao-no-servidor.md`, R3, R6 to R9,
 * R11 to R13).
 */
import { expect, test } from "@playwright/test";
import {
	appendBatch,
	collectBatch,
	fromMonitor,
	historyOf,
	inspect,
	type makeBatch,
	makeWorld,
	newMonitor,
	receiptOf,
	send,
	sendBatch,
	snapshotRows,
	storedField,
	typeInto,
} from "./answer-edit-service-support";

test.describe("R7: accepting a batch", () => {
	test("a real first batch is stored, moves the anchor and returns its receipt", async () => {
		const world = await makeWorld();
		const monitor = newMonitor("");
		typeInto(monitor, "olá 😀 ñ");
		const batch = collectBatch(monitor);

		const result = await sendBatch(world, batch);

		expect(result).toMatchObject({
			question: world.slugs.text,
			field: "answer",
			kind: "accepted",
			receipt: { batchId: batch.batchId, revision: 1, lastSeq: 0 },
		});
		const stored = await storedField(world);
		expect(stored).toMatchObject({ text: "olá 😀 ñ", revision: 1, nextSeq: 1 });
		expect(stored?.batches).toHaveLength(1);
		expect(stored?.batches[0]).toMatchObject({
			batchId: batch.batchId,
			revision: 1,
			firstSeq: 0,
			editCount: 1,
			sessionId: batch.sessionId,
			version: 1,
			baseReason: "start",
			baseText: "",
			gapBefore: null,
			lateMs: null,
		});
	});

	test("the receipt is one the monitor accepts, and the chain of batches goes on", async () => {
		const world = await makeWorld();
		const monitor = newMonitor("");
		let expected = "";
		for (const piece of ["a", "😀", "é\n", "end"]) {
			typeInto(monitor, piece);
			expected += piece;
			const batch = collectBatch(monitor);
			const result = await sendBatch(world, batch);
			monitor.acknowledge(receiptOf(result));
		}

		const state = await inspect(world);
		expect(state.fields).toHaveLength(1);
		expect(state.fields[0]).toMatchObject({
			question: world.slugs.text,
			field: "answer",
			text: expected,
			revision: 4,
			nextSeq: 4,
		});
	});

	test("a batch with several edits advances the sequence by its edit count", async () => {
		const world = await makeWorld();
		const first = appendBatch("", "abc");
		expect(first.edits).toHaveLength(3);

		const result = await sendBatch(world, first);

		expect(receiptOf(result)).toEqual({
			batchId: first.batchId,
			revision: 1,
			lastSeq: 2,
		});
		const second = appendBatch("abc", "de", {
			baseRevision: 1,
			firstSeq: 3,
			batchId: "s:3",
		});
		expect(receiptOf(await sendBatch(world, second))).toEqual({
			batchId: "s:3",
			revision: 2,
			lastSeq: 4,
		});
		expect((await storedField(world))?.nextSeq).toBe(5);
	});

	test("the totals of the attempt follow the stored batches", async () => {
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

		const stored = await storedField(world);
		const history = await historyOf(world);
		expect(history?.editCount).toBe(5);
		expect(history?.byteCount).toBeGreaterThan(0);
		expect(history?.byteCount).toBe(
			stored?.batches.reduce((sum, b) => sum + b.byteCount, 0),
		);
		expect(history?.incompleteAt).toBeNull();
	});

	test("a start base that is not empty is the text the first edits run on", async () => {
		const world = await makeWorld();
		const batch = appendBatch("draft", "!", { base: "start" });
		expect(batch.base).toEqual({ reason: "start", text: "draft" });

		expect(receiptOf(await sendBatch(world, batch)).revision).toBe(1);

		const stored = await storedField(world);
		expect(stored?.text).toBe("draft!");
		expect(stored?.batches[0]).toMatchObject({
			baseReason: "start",
			baseText: "draft",
			gapBefore: null,
		});
	});

	test("items for the text and the code essay of one call are independent fields", async () => {
		const world = await makeWorld();
		const { results } = await send(world, [
			{
				question: world.slugs.text,
				field: "answer",
				batch: appendBatch("", "prose"),
			},
			{
				question: world.slugs.code,
				field: "answer",
				batch: appendBatch("", "let x"),
			},
		]);

		expect(results.map((r) => r.kind)).toEqual(["accepted", "accepted"]);
		expect(results.map((r) => r.question)).toEqual([
			world.slugs.text,
			world.slugs.code,
		]);
		expect((await storedField(world, world.slugs.text))?.text).toBe("prose");
		expect((await storedField(world, world.slugs.code))?.text).toBe("let x");
	});

	test("append answers enabled: true for a switched-on exam", async () => {
		const world = await makeWorld();
		const response = await send(world, [
			{
				question: world.slugs.text,
				field: "answer",
				batch: appendBatch("", "a"),
			},
		]);
		expect(response.enabled).toBe(true);
	});
});

test.describe("R7: batches that must be refused without touching the anchor", () => {
	/// A field already at revision 1 with the text "abc".
	async function withAnchor() {
		const world = await makeWorld();
		await sendBatch(world, appendBatch("", "abc"));
		return world;
	}

	const cases: {
		label: string;
		reason?: "base" | "replay" | "invalid";
		batch: () => ReturnType<typeof makeBatch>;
	}[] = [
		{
			label: "a base revision behind the anchor",
			reason: "base",
			batch: () =>
				appendBatch("abc", "d", {
					baseRevision: 0,
					firstSeq: 3,
					batchId: "x:3",
					base: "start",
				}),
		},
		{
			label: "a base revision ahead of the anchor",
			reason: "base",
			batch: () =>
				appendBatch("abc", "d", {
					baseRevision: 5,
					firstSeq: 3,
					batchId: "x:3",
				}),
		},
		{
			label: "a first sequence ahead of the anchor",
			reason: "base",
			batch: () =>
				appendBatch("abc", "d", {
					baseRevision: 1,
					firstSeq: 4,
					batchId: "x:4",
				}),
		},
		{
			label: "a first sequence behind the anchor",
			reason: "base",
			batch: () =>
				appendBatch("abc", "d", {
					baseRevision: 1,
					firstSeq: 2,
					batchId: "x:2",
				}),
		},
		{
			label: "a snapshot the edits do not produce",
			reason: "replay",
			batch: () => ({
				...appendBatch("abc", "d", {
					baseRevision: 1,
					firstSeq: 3,
					batchId: "x:3",
				}),
				snapshot: "abcX",
			}),
		},
		{
			label: "a snapshot that differs by a single code unit of an emoji",
			reason: "replay",
			batch: () => ({
				...appendBatch("abc", "😀", {
					baseRevision: 1,
					firstSeq: 3,
					batchId: "x:3",
				}),
				snapshot: "abc😁",
			}),
		},
		{
			label: "a position past the end of the text",
			reason: "replay",
			batch: () => {
				const good = appendBatch("abc", "d", {
					baseRevision: 1,
					firstSeq: 3,
					batchId: "x:3",
				});
				return {
					...good,
					edits: [[0, 1, 99, 0, "d", 0, null]],
					snapshot: "abcd",
				};
			},
		},
		{
			label: "a delete count that runs past the end of the text",
			reason: "replay",
			batch: () => {
				const good = appendBatch("abc", "d", {
					baseRevision: 1,
					firstSeq: 3,
					batchId: "x:3",
				});
				return {
					...good,
					edits: [[0, 1, 1, 50, "", 0, null]],
					snapshot: "a",
				};
			},
		},
		{
			label:
				"edits that run on the snapshot of a different text than the anchor",
			reason: "replay",
			batch: () =>
				appendBatch("abcdef", "g", {
					baseRevision: 1,
					firstSeq: 3,
					batchId: "x:3",
				}),
		},
		{
			label: "no edits at all",
			reason: "invalid",
			batch: () => ({
				...appendBatch("abc", "d", {
					baseRevision: 1,
					firstSeq: 3,
					batchId: "x:3",
				}),
				edits: [],
				snapshot: "abc",
			}),
		},
		{
			label: "an unsupported codec version",
			reason: "invalid",
			batch: () =>
				({
					...appendBatch("abc", "d", {
						baseRevision: 1,
						firstSeq: 3,
						batchId: "x:3",
					}),
					version: 2,
				}) as never,
		},
		{
			label: "an edit tuple of the wrong length",
			reason: "invalid",
			batch: () =>
				({
					...appendBatch("abc", "d", {
						baseRevision: 1,
						firstSeq: 3,
						batchId: "x:3",
					}),
					edits: [[0, 1, 3, 0]],
				}) as never,
		},
		{
			label: "a missing batch id",
			reason: "invalid",
			batch: () =>
				({
					...appendBatch("abc", "d", {
						baseRevision: 1,
						firstSeq: 3,
					}),
					batchId: undefined,
				}) as never,
		},
		{
			label: "a start base on a field that already has an anchor",
			batch: () =>
				appendBatch("abc", "d", {
					baseRevision: 1,
					firstSeq: 3,
					batchId: "x:3",
					base: { reason: "start", text: "abc" },
				}),
		},
		{
			label: "an edit start time that regresses",
			batch: () => {
				const good = appendBatch("abc", "de", {
					baseRevision: 1,
					firstSeq: 3,
					batchId: "x:3",
				});
				return {
					...good,
					edits: [good.edits[0], [-5, 1, 4, 0, "e", 0, null]],
				} as never;
			},
		},
	];

	for (const { label, reason, batch } of cases) {
		test(`${label} is a conflict, nothing changes`, async () => {
			const world = await withAnchor();
			const before = await snapshotRows(world);

			const result = await sendBatch(world, batch());

			expect(result.kind).toBe("conflict");
			if (reason && result.kind === "conflict") {
				expect(result.reason).toBe(reason);
			}
			expect(await snapshotRows(world)).toEqual(before);
			expect((await inspect(world)).fields[0]).toMatchObject({
				text: "abc",
				revision: 1,
				nextSeq: 3,
			});
		});
	}

	test("a first batch without the start base is a conflict", async () => {
		const world = await makeWorld();
		const result = await sendBatch(
			world,
			appendBatch("", "a", { base: "none" }),
		);
		expect(result.kind).toBe("conflict");
		expect(await storedField(world)).toBeNull();
	});

	test("a start base whose text the edits do not replay on is a conflict", async () => {
		const world = await makeWorld();
		const batch = {
			...appendBatch("draft", "!", { base: "start" }),
			base: { reason: "start" as const, text: "other" },
		};
		const result = await sendBatch(world, batch);
		expect(result).toMatchObject({ kind: "conflict", reason: "replay" });
		expect(await storedField(world)).toBeNull();
	});

	test("a refused first batch leaves no anchor behind", async () => {
		const world = await makeWorld();
		const bad = { ...appendBatch("", "ab"), snapshot: "zz" };

		expect((await sendBatch(world, bad)).kind).toBe("conflict");

		expect((await inspect(world)).fields).toEqual([]);
		expect((await storedField(world))?.batches ?? []).toEqual([]);
	});
});

test.describe("R6: a bad item does not take the others down", () => {
	test("a malformed item is a conflict with reason invalid and the neighbours are stored, in order", async () => {
		const world = await makeWorld();

		const { results } = await send(world, [
			{
				question: world.slugs.text,
				field: "answer",
				batch: appendBatch("", "good"),
			},
			{ question: world.slugs.code, field: "answer", batch: 42 as never },
			{
				question: world.slugs.code,
				field: "answer",
				batch: appendBatch("", "also good", { batchId: "c:0" }),
			},
		]);

		expect(results.map((r) => r.kind)).toEqual([
			"accepted",
			"conflict",
			"accepted",
		]);
		expect(results[1]).toMatchObject({ reason: "invalid" });
		expect((await storedField(world, world.slugs.text))?.text).toBe("good");
		expect((await storedField(world, world.slugs.code))?.text).toBe(
			"also good",
		);
	});

	test("an item that is not even an object is answered, not thrown", async () => {
		const world = await makeWorld();
		const { results } = await send(world, [
			"nonsense" as never,
			{
				question: world.slugs.text,
				field: "answer",
				batch: appendBatch("", "ok"),
			},
		]);
		expect(results).toHaveLength(2);
		expect(results[0]?.kind).toBe("conflict");
		expect(results[1]?.kind).toBe("accepted");
	});

	test("an item with neither batch nor gaps stores nothing and does not break the call", async () => {
		const world = await makeWorld();
		const { results } = await send(world, [
			{ question: world.slugs.text, field: "answer" },
		]);
		expect(results).toHaveLength(1);
		expect(results[0]?.kind).not.toBe("closed");
		expect(await storedField(world)).toBeNull();
	});
});

test.describe("R8: idempotency", () => {
	test("the same batch sent twice gets the same receipt and is stored once", async () => {
		const world = await makeWorld();
		const batch = appendBatch("", "abc");

		const first = await sendBatch(world, batch);
		const rowsAfterFirst = await snapshotRows(world);
		const second = await sendBatch(world, batch);

		expect(second.kind).toBe("accepted");
		expect(receiptOf(second)).toEqual(receiptOf(first));
		expect(await snapshotRows(world)).toEqual(rowsAfterFirst);
	});

	test("a retry of an earlier batch still gets its receipt after later batches", async () => {
		const world = await makeWorld();
		const first = appendBatch("", "abc");
		const receipt = receiptOf(await sendBatch(world, first));
		await sendBatch(
			world,
			appendBatch("abc", "d", { baseRevision: 1, firstSeq: 3, batchId: "s:3" }),
		);
		const rows = await snapshotRows(world);

		const retry = await sendBatch(world, first);

		expect(retry.kind).toBe("accepted");
		expect(receiptOf(retry)).toEqual(receipt);
		expect(await snapshotRows(world)).toEqual(rows);
	});

	test("the content is compared, not the order of the keys in the request", async () => {
		const world = await makeWorld();
		const batch = appendBatch("", "abc");
		const receipt = receiptOf(await sendBatch(world, batch));
		const shuffled = JSON.parse(
			JSON.stringify(Object.fromEntries(Object.entries(batch).reverse())),
		);

		const retry = await sendBatch(world, shuffled);

		expect(receiptOf(retry)).toEqual(receipt);
	});

	test("the same id with other content is a reused-id conflict and stores nothing", async () => {
		const world = await makeWorld();
		const batch = appendBatch("", "abc");
		await sendBatch(world, batch);
		const rows = await snapshotRows(world);

		const reused = {
			...appendBatch("", "xyz"),
			batchId: batch.batchId,
		};
		const result = await sendBatch(world, reused);

		expect(result).toMatchObject({ kind: "conflict", reason: "reused-id" });
		expect(await snapshotRows(world)).toEqual(rows);
	});

	test("the same id with a different session or time origin is also a reused id", async () => {
		const world = await makeWorld();
		const batch = appendBatch("", "abc");
		await sendBatch(world, batch);

		const otherSession = { ...batch, sessionId: "another" };
		const otherOrigin = { ...batch, timeOriginMs: 5 };

		expect(await sendBatch(world, otherSession)).toMatchObject({
			kind: "conflict",
			reason: "reused-id",
		});
		expect(await sendBatch(world, otherOrigin)).toMatchObject({
			kind: "conflict",
			reason: "reused-id",
		});
	});

	test("the same batch id on another field is a different batch", async () => {
		const world = await makeWorld();
		const batch = appendBatch("", "abc");
		await sendBatch(world, batch);

		const other = await sendBatch(world, batch, {
			question: world.slugs.code,
		});

		expect(other.kind).toBe("accepted");
		expect((await storedField(world, world.slugs.code))?.text).toBe("abc");
	});
});

test.describe("R9: concurrency on one revision", () => {
	test("two tabs sending on the same base revision cannot both win", async () => {
		for (let round = 0; round < 5; round++) {
			const world = await makeWorld();
			const tabA = appendBatch("", "from tab A", {
				sessionId: "tab-a",
				batchId: "tab-a:0",
			});
			const tabB = appendBatch("", "from tab B", {
				sessionId: "tab-b",
				batchId: "tab-b:0",
			});

			const [a, b] = await Promise.all([
				sendBatch(world, tabA),
				sendBatch(world, tabB),
			]);

			const kinds = [a.kind, b.kind].sort();
			expect(kinds).toEqual(["accepted", "conflict"]);
			const loser = a.kind === "conflict" ? a : b;
			expect(loser).toMatchObject({ kind: "conflict", reason: "base" });
			const stored = await storedField(world);
			expect(stored?.batches).toHaveLength(1);
			expect(stored?.revision).toBe(1);
			expect(stored?.nextSeq).toBe(stored?.batches[0]?.editCount);
			expect(stored?.text).toBe(
				a.kind === "accepted" ? tabA.snapshot : tabB.snapshot,
			);
		}
	});

	test("the same batch sent twice at once is stored once", async () => {
		const world = await makeWorld();
		const batch = appendBatch("", "abc");

		const [a, b] = await Promise.all([
			sendBatch(world, batch),
			sendBatch(world, batch),
		]);

		// Whichever lost the race either sees the stored batch (a receipt) or the moved base.
		expect([a.kind, b.kind]).toContain("accepted");
		expect((await storedField(world))?.batches).toHaveLength(1);
	});
});

test.describe("R13: a rebase", () => {
	/// The server holds "hello"; a second monitor, started from another text, rebases onto it.
	async function rebased(rebaseText: string) {
		const world = await makeWorld();
		await sendBatch(world, appendBatch("", "hello"));
		const monitor = newMonitor(rebaseText);
		typeInto(monitor, "?");
		const stale = await sendBatch(world, collectBatch(monitor));
		expect(stale.kind).toBe("conflict");

		const state = (await inspect(world)).fields[0];
		if (!state) throw new Error("expected the field");
		monitor.rebase({ baseRevision: state.revision, firstSeq: state.nextSeq });
		typeInto(monitor, "!", 20);
		const batch = collectBatch(monitor);
		return { world, monitor, batch, state };
	}

	test("a rebase that lost text records the anchor it replaced, and no synthetic edit", async () => {
		const { world, batch } = await rebased("hello there");
		expect(batch.base).toEqual({ reason: "rebase", text: "hello there?" });

		const result = await sendBatch(world, batch);

		expect(result.kind).toBe("accepted");
		const stored = await storedField(world);
		expect(stored?.text).toBe("hello there?!");
		const row = stored?.batches[1];
		expect(row).toMatchObject({
			baseReason: "rebase",
			baseText: "hello there?",
			gapBefore: "hello",
			revision: 2,
			firstSeq: 5,
			editCount: batch.edits.length,
		});
		// Only the real edits are stored: five for "hello" and one for "!".
		expect(stored?.nextSeq).toBe(5 + batch.edits.length);
	});

	test("a rebase onto the very text the anchor holds keeps no gapBefore", async () => {
		const world = await makeWorld();
		await sendBatch(world, appendBatch("", "hello"));
		const batch = appendBatch("hello", "!", {
			baseRevision: 1,
			firstSeq: 5,
			batchId: "r:5",
			base: { reason: "rebase", text: "hello" },
		});

		const result = await sendBatch(world, batch);

		expect(result.kind).toBe("accepted");
		const row = (await storedField(world))?.batches[1];
		expect(row).toMatchObject({
			baseReason: "rebase",
			baseText: "hello",
			gapBefore: null,
		});
	});

	test("a rebase base whose text the edits do not replay on is refused", async () => {
		const { world, batch } = await rebased("hello there");
		const forged = {
			...batch,
			base: { reason: "rebase" as const, text: "not the text" },
		};
		const before = await snapshotRows(world);

		const result = await sendBatch(world, forged);

		expect(result).toMatchObject({ kind: "conflict", reason: "replay" });
		expect(await snapshotRows(world)).toEqual(before);
	});

	test("a rebase to a field that was never stored is accepted at revision 0", async () => {
		const world = await makeWorld();
		const monitor = newMonitor("draft", { baseRevision: 3, firstSeq: 9 });
		monitor.rebase({ baseRevision: 0, firstSeq: 0 });
		typeInto(monitor, "!");
		const batch = collectBatch(monitor);
		expect(batch.base?.reason).toBe("rebase");

		const result = await sendBatch(world, batch);

		expect(result.kind).toBe("accepted");
		expect((await storedField(world))?.text).toBe("draft!");
	});

	test("after the rebase the monitor takes the receipt and the next plain batch is accepted", async () => {
		const { world, monitor, batch } = await rebased("hello there");
		monitor.acknowledge(receiptOf(await sendBatch(world, batch)));
		typeInto(monitor, "?", 40);
		const next = collectBatch(monitor);
		expect(next.base).toBeUndefined();

		expect((await sendBatch(world, next)).kind).toBe("accepted");
	});
});

test.describe("R3: no full text in every batch", () => {
	test("ten ordinary batches keep full text only in the anchor and in the start base", async () => {
		const world = await makeWorld();
		const monitor = newMonitor("draft");
		let text = "draft";
		for (let i = 0; i < 10; i++) {
			const piece = ` word${i} and some more words`;
			for (const char of piece) {
				typeInto(monitor, char, 10 + i * 100);
				text += char;
			}
			const result = await sendBatch(world, collectBatch(monitor));
			monitor.acknowledge(receiptOf(result));
		}

		const stored = await storedField(world);
		expect(stored?.text).toBe(text);
		expect(stored?.batches).toHaveLength(10);
		stored?.batches.forEach((row, i) => {
			expect(row.gapBefore).toBeNull();
			expect(row.baseText).toBe(i === 0 ? "draft" : null);
			// The full text starts with "draft word0"; a batch holds only its own edits.
			expect(JSON.stringify(row)).not.toContain("draft word0");
		});
		// The snapshot of the last batch would show up as a long run of text if it were stored.
		const last = stored?.batches[9];
		expect(JSON.stringify({ ...last, edits: undefined })).not.toContain(
			"word8",
		);
	});
});

test.describe("R12: gaps", () => {
	test("a gap marker is stored with its reason and carries no text", async () => {
		const world = await makeWorld();

		const { results } = await send(world, [
			{
				question: world.slugs.text,
				field: "answer",
				gaps: [{ reason: "editor crashed" }],
			},
		]);

		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({
			question: world.slugs.text,
			field: "answer",
		});
		expect(["closed", "conflict"]).not.toContain(results[0]?.kind);
		const stored = await storedField(world);
		expect(stored).toMatchObject({ text: "", revision: 0, nextSeq: 0 });
		expect(stored?.gaps).toHaveLength(1);
		const gap = stored?.gaps[0];
		expect(gap?.reason).toBe("editor crashed");
		expect(Object.keys(gap ?? {}).sort()).toEqual([
			"clientId",
			"fieldId",
			"id",
			"reason",
			"receivedAt",
		]);
		expect(gap?.receivedAt).toBeInstanceOf(Date);
	});

	test("a gap creates the empty anchor, which the page then reads as revision 0", async () => {
		const world = await makeWorld();
		await send(world, [
			{ question: world.slugs.text, field: "answer", gaps: [{ reason: "x" }] },
		]);

		const state = await inspect(world);

		expect(state.fields).toHaveLength(1);
		expect(state.fields[0]).toMatchObject({
			text: "",
			revision: 0,
			nextSeq: 0,
			receipts: [],
		});
	});

	test("a batch and gaps in one item are both kept", async () => {
		const world = await makeWorld();
		const { results } = await send(world, [
			{
				question: world.slugs.text,
				field: "answer",
				batch: appendBatch("", "abc"),
				gaps: [{ reason: "first" }, { reason: "second" }],
			},
		]);

		expect(results[0]?.kind).toBe("accepted");
		const stored = await storedField(world);
		expect(stored?.batches).toHaveLength(1);
		expect(stored?.gaps.map((g) => g.reason)).toEqual(["first", "second"]);
	});

	test("a reason of exactly 200 characters is kept whole", async () => {
		const world = await makeWorld();
		const reason = "é".repeat(200);
		await send(world, [
			{ question: world.slugs.text, field: "answer", gaps: [{ reason }] },
		]);
		expect((await storedField(world))?.gaps[0]?.reason).toBe(reason);
	});

	test("at most 50 gaps per field are stored; the rest are dropped without an error", async () => {
		const world = await makeWorld();
		const gaps = Array.from({ length: 60 }, (_, i) => ({ reason: `gap ${i}` }));

		const { results } = await send(world, [
			{ question: world.slugs.text, field: "answer", gaps },
		]);

		expect(results[0]?.kind).not.toBe("conflict");
		const stored = await storedField(world);
		expect(stored?.gaps).toHaveLength(50);
		expect(stored?.gaps[0]?.reason).toBe("gap 0");
	});

	test("the cap of 50 counts the gaps of earlier calls", async () => {
		const world = await makeWorld();
		const item = (n: number) => ({
			question: world.slugs.text,
			field: "answer",
			gaps: Array.from({ length: n }, (_, i) => ({ reason: `g${i}` })),
		});
		await send(world, [item(30)]);
		await send(world, [item(30)]);

		expect((await storedField(world))?.gaps).toHaveLength(50);
	});
});

test.describe("R11: only essay answers are tracked", () => {
	test("a question the exam does not carry is closed as not-tracked and nothing is stored", async () => {
		const world = await makeWorld();
		const before = await snapshotRows(world);

		const result = await sendBatch(world, appendBatch("", "a"), {
			question: world.slugs.outside,
		});

		expect(result).toMatchObject({ kind: "closed", reason: "not-tracked" });
		expect(await snapshotRows(world)).toEqual(before);
	});

	test("a slug that exists nowhere is not-tracked too", async () => {
		const world = await makeWorld();
		const result = await sendBatch(world, appendBatch("", "a"), {
			question: "no-such-question",
		});
		expect(result).toMatchObject({ kind: "closed", reason: "not-tracked" });
	});

	test("a question of another type is not-tracked", async () => {
		const world = await makeWorld();
		const result = await sendBatch(world, appendBatch("", "a"), {
			question: world.slugs.choice,
		});
		expect(result).toMatchObject({ kind: "closed", reason: "not-tracked" });
		expect(await snapshotRows(world)).toBeNull();
	});

	test("a field other than answer is not-tracked, for batches and for gaps", async () => {
		const world = await makeWorld();
		const { results } = await send(world, [
			{
				question: world.slugs.text,
				field: "notes",
				batch: appendBatch("", "a"),
			},
			{
				question: world.slugs.text,
				field: "notes",
				gaps: [{ reason: "x" }],
			},
		]);
		expect(results).toMatchObject([
			{ kind: "closed", reason: "not-tracked" },
			{ kind: "closed", reason: "not-tracked" },
		]);
		expect(await snapshotRows(world)).toBeNull();
	});

	test("the code essay is tracked", async () => {
		const world = await makeWorld();
		const result = await sendBatch(world, appendBatch("", "let x"), {
			question: world.slugs.code,
		});
		expect(result.kind).toBe("accepted");
	});

	test("a not-tracked item does not stop the tracked one next to it", async () => {
		const world = await makeWorld();
		const { results } = await send(world, [
			{
				question: world.slugs.choice,
				field: "answer",
				batch: appendBatch("", "a"),
			},
			{
				question: world.slugs.text,
				field: "answer",
				batch: appendBatch("", "b"),
			},
		]);
		expect(results.map((r) => r.kind)).toEqual(["closed", "accepted"]);
	});
});

test("fromMonitor keeps a monitor batch intact through the service", async () => {
	const world = await makeWorld();
	const monitor = newMonitor("seed");
	typeInto(monitor, " 🎉");
	const raw = monitor.collect();
	if (!raw) throw new Error("batch expected");

	const result = await sendBatch(world, fromMonitor(raw));

	expect(result.kind).toBe("accepted");
	expect((await storedField(world))?.text).toBe("seed 🎉");
});
