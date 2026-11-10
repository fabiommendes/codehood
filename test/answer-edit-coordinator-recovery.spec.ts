import { expect, test } from "@playwright/test";
import { replayEdits } from "@/services/answer-edits/codec";
import {
	AnswerEditCoordinator,
	type AttemptTransport,
	type FieldRecovery,
	type ServerFieldState,
} from "@/services/answer-edits/coordinator";
import {
	AnswerEditMonitor,
	type PendingEditBatch,
} from "@/services/answer-edits/monitor";
import {
	deferred,
	drain,
	EPOCH,
	FIELD,
	REF,
	restoreRecord,
	rig,
} from "./helpers/answer-edit-coordinator";

type Rig = ReturnType<typeof rig>;

function receipt(batch: PendingEditBatch) {
	return {
		batchId: batch.batchId,
		revision: batch.baseRevision + 1,
		lastSeq: batch.firstSeq + batch.edits.length - 1,
	};
}

function acceptRequests(h: Rig) {
	h.transport.send = async (
		request: Parameters<AttemptTransport["send"]>[0],
	) => {
		h.transport.requests.push(structuredClone(request));
		return request.fields.map(({ questionId, field, batch }) => ({
			questionId,
			field,
			kind: "accepted" as const,
			receipt: receipt(batch),
		}));
	};
}

function ready(result: FieldRecovery) {
	expect(result.kind).toBe("ready");
	if (result.kind !== "ready") throw new Error("Expected recoverable history");
	return result;
}

async function seed(
	options: {
		queue?: boolean;
		empty?: boolean;
		savedAt?: number;
		expiresAt?: number;
	} = {},
) {
	const h = rig();
	h.append("old");
	if (options.empty) h.clear();
	const batch = h.monitor.collect();
	if (!batch) throw new Error("Expected fixture batch");
	if (options.queue) h.append(" queued");
	await h.store.commit(
		REF,
		{
			version: 1,
			generation: 1,
			savedAt: options.savedAt ?? EPOCH,
			expiresAt: options.expiresAt ?? (options.savedAt ?? EPOCH) + 60_000,
			text: h.monitor.getState().text,
			checkpoint: h.monitor.exportCheckpoint(),
			outbox: batch,
		},
		null,
	);
	return { h, batch };
}

async function record(h: Rig) {
	const stored = await h.store.read(REF, EPOCH);
	if (!stored) throw new Error("Expected retained local history");
	return stored;
}

test.describe("answer edit coordinator recovery: server authority and history", () => {
	test("recovery waits for authenticated inspection before resending an existing outbox", async () => {
		const { h, batch } = await seed();
		const inspection = deferred<ServerFieldState>();
		h.transport.inspectionGate = inspection;
		const reopened = new AnswerEditCoordinator(h.options);
		const recovery = reopened.recover(FIELD);
		await drain();
		const flush = reopened.flushDelivery();
		await h.scheduler.advance(130_000);
		expect(h.transport.inspections).toEqual([REF]);
		expect(h.transport.requests).toHaveLength(0);
		expect((await record(h)).outbox).toEqual(batch);
		inspection.resolve(h.transport.server);
		ready(await recovery);
		await flush;
		await reopened.flush();
		expect(h.transport.requests.length).toBeGreaterThanOrEqual(1);
		expect(h.transport.requests[0]?.fields[0]?.batch).toEqual(batch);
		await reopened.dispose();
	});

	test("server still at the compatible base permits byte-for-byte retry of the stored batch", async () => {
		const { h, batch } = await seed();
		const reopened = new AnswerEditCoordinator(h.options);
		const result = ready(await reopened.recover(FIELD));
		expect(result.handle.getState().text).toBe("old");
		await reopened.flush();
		expect(h.transport.requests).toHaveLength(1);
		expect(h.transport.requests[0]?.fields[0]?.batch).toEqual(batch);
		expect((await record(h)).outbox).toEqual(batch);
		await reopened.dispose();
	});

	test("equal local and remote text does not acknowledge unreceipted insert-and-delete history", async () => {
		const { h, batch } = await seed({ empty: true });
		expect(batch.snapshot).toBe("");
		const reopened = new AnswerEditCoordinator(h.options);
		ready(await reopened.recover(FIELD));
		await reopened.flush();
		expect(h.transport.requests[0]?.fields[0]?.batch).toEqual(batch);
		expect((await record(h)).outbox).toEqual(batch);
		await reopened.dispose();
	});

	test("flushDelivery drains inflight and queued old-session work before new-origin work", async () => {
		const { h, batch } = await seed({ queue: true });
		acceptRequests(h);
		const reopened = new AnswerEditCoordinator({
			...h.options,
			monotonicNow: () => 7,
		});
		const result = ready(await reopened.recover(FIELD));
		const handle = result.handle;
		if (!(handle instanceof AnswerEditMonitor))
			throw new Error("Expected editable monitor");
		handle.recordChange({
			atMs: 8,
			kind: "paste",
			replacements: [
				{ position: "old queued".length, deleteCount: 0, insertedText: " new" },
			],
		});
		await reopened.flushDelivery();
		const batches = h.transport.requests.flatMap((request) =>
			request.fields.map((field) => field.batch),
		);
		expect(batches).toHaveLength(3);
		expect(batches[0]).toEqual(batch);
		expect(batches.map((item) => item.sessionId)).toEqual([
			"editor-session",
			"editor-session",
			"restored-1",
		]);
		expect(batches.map((item) => item.timeOriginMs)).toEqual([
			10_000, 10_000, 7,
		]);
		expect(batches.map((item) => item.snapshot)).toEqual([
			"old",
			"old queued",
			"old queued new",
		]);
		let text = "";
		for (const item of batches) text = replayEdits(text, item);
		expect(text).toBe("old queued new");
		expect(restoreRecord(await record(h)).collect()).toBeNull();
		await reopened.dispose();
	});

	test("lost ACK is recovered only from an exact receipt and snapshot, retaining edits typed after that batch", async () => {
		const { h, batch } = await seed({ queue: true });
		h.transport.server = {
			text: batch.snapshot,
			revision: 1,
			nextSeq: receipt(batch).lastSeq + 1,
			canWrite: true,
			receipts: [receipt(batch)],
		};
		acceptRequests(h);
		const reopened = new AnswerEditCoordinator(h.options);
		const result = ready(await reopened.recover(FIELD));
		expect(result.handle.getState().text).toBe("old queued");
		await reopened.flushDelivery();
		expect(h.transport.requests).toHaveLength(1);
		const next = h.transport.requests[0]?.fields[0]?.batch;
		expect(next?.batchId).not.toBe(batch.batchId);
		expect(next?.baseRevision).toBe(1);
		expect(next?.snapshot).toBe("old queued");
		expect(restoreRecord(await record(h)).collect()).toBeNull();
		await reopened.dispose();
	});

	for (const mismatch of [
		"missing receipt",
		"wrong batch",
		"wrong receipt revision",
		"wrong receipt sequence",
		"different snapshot",
		"ahead two revisions",
		"wrong next sequence",
		"divergent base text",
	] as const) {
		test(`${mismatch} produces explicit conflict without replacing either version`, async () => {
			const { h, batch } = await seed({ savedAt: EPOCH + 10_000_000 });
			const exact = receipt(batch);
			let server: ServerFieldState = {
				text: "old",
				revision: 1,
				nextSeq: exact.lastSeq + 1,
				canWrite: true,
				receipts: [exact],
			};
			switch (mismatch) {
				case "missing receipt":
					server = { ...server, receipts: [] };
					break;
				case "wrong batch":
					server = {
						...server,
						receipts: [{ ...exact, batchId: "another-batch" }],
					};
					break;
				case "wrong receipt revision":
					server = { ...server, receipts: [{ ...exact, revision: 9 }] };
					break;
				case "wrong receipt sequence":
					server = { ...server, receipts: [{ ...exact, lastSeq: 99 }] };
					break;
				case "different snapshot":
					server = { ...server, text: "other device" };
					break;
				case "ahead two revisions":
					server = { ...server, revision: 2 };
					break;
				case "wrong next sequence":
					server = { ...server, nextSeq: 99 };
					break;
				case "divergent base text":
					server = {
						...server,
						text: "another base",
						revision: 0,
						nextSeq: 1,
						receipts: [],
					};
					break;
			}
			h.transport.server = structuredClone(server);
			const before = await record(h);
			const reopened = new AnswerEditCoordinator(h.options);
			const result = await reopened.recover(FIELD);
			expect(result).toMatchObject({
				kind: "conflict",
				localText: "old",
				server,
			});
			if (result.kind !== "conflict")
				throw new Error("Expected explicit conflict");
			expect(result.reason).toBeTruthy();
			expect(reopened.getStatus(FIELD)?.delivery).toBe("blocked");
			await reopened.flushDelivery();
			expect(h.transport.requests).toHaveLength(0);
			expect(await record(h)).toMatchObject({
				text: before.text,
				checkpoint: before.checkpoint,
				outbox: before.outbox,
			});
			expect(h.transport.server).toEqual(server);
			await reopened.dispose();
		});
	}
});

test.describe("answer edit coordinator recovery: fallback, expiry and deadline", () => {
	for (const text of ["newer fallback", ""]) {
		test(`newer ${text === "" ? "empty" : "nonempty"} text fallback takes precedence over an older readable checkpoint with an explicit gap`, async () => {
			const { h } = await seed();
			h.fallback.write(REF, {
				version: 1,
				savedAt: EPOCH + 1,
				expiresAt: EPOCH + 60_000,
				text,
				historyGap: true,
			});
			const reopened = new AnswerEditCoordinator({
				...h.options,
				now: () => EPOCH + 2,
			});
			const result = await reopened.recover(FIELD);
			expect(result).toMatchObject({
				kind: "text-only",
				localText: text,
				historyGap: true,
				server: h.transport.server,
			});
			expect("handle" in result).toBe(false);
			expect(reopened.getStatus(FIELD)).toMatchObject({
				durability: "text-only",
				savedText: text,
				historyGap: true,
			});
			await reopened.flushDelivery();
			expect(h.transport.requests).toHaveLength(0);
			// Choosing a text-only recovery must not rewrite old evidence as invented keystrokes.
			expect((await record(h)).text).toBe("old");
			await reopened.dispose();
		});
	}

	test("an older matching fallback permits recovery of a newer coherent checkpoint", async () => {
		const { h } = await seed({ savedAt: EPOCH + 2 });
		h.fallback.write(REF, {
			version: 1,
			savedAt: EPOCH,
			expiresAt: EPOCH + 60_000,
			text: "old",
			historyGap: true,
		});
		const reopened = new AnswerEditCoordinator({
			...h.options,
			now: () => EPOCH + 3,
		});
		expect(ready(await reopened.recover(FIELD)).handle.getState().text).toBe(
			"old",
		);
		await reopened.dispose();
	});

	test("custom TTL is written to the committed record and expires exactly at expiresAt", async () => {
		const h = rig({ ttlMs: 2000 });
		await h.coordinator.register(FIELD, h.monitor);
		h.append("expires");
		await h.coordinator.persist();
		const saved = await record(h);
		expect(saved.savedAt).toBe(EPOCH);
		expect(saved.expiresAt).toBe(EPOCH + 2000);
		expect((await h.store.read(REF, EPOCH + 1999))?.text).toBe("expires");
		expect(await h.store.read(REF, EPOCH + 2000)).toBeNull();
		await h.coordinator.dispose();
		const reopened = new AnswerEditCoordinator({
			...h.options,
			now: () => EPOCH + 2000,
		});
		expect(ready(await reopened.recover(FIELD)).handle.getState().text).toBe(
			"",
		);
		await reopened.flushDelivery();
		expect(h.transport.requests).toHaveLength(0);
		await reopened.dispose();
	});

	test("expired fallback is ignored even when the principal store is unavailable", async () => {
		const h = rig();
		h.store.failRead = true;
		h.fallback.write(REF, {
			version: 1,
			savedAt: EPOCH - 1000,
			expiresAt: EPOCH,
			text: "expired",
			historyGap: true,
		});
		const result = await h.coordinator.recover(FIELD);
		expect(result).toMatchObject({
			kind: "unavailable",
			server: h.transport.server,
		});
		expect("handle" in result).toBe(false);
		expect(h.coordinator.getStatus(FIELD)).toMatchObject({
			durability: "unavailable",
			savedText: null,
		});
		await h.coordinator.flushDelivery();
		expect(h.transport.requests).toHaveLength(0);
		expect(h.store.commits).toHaveLength(0);
		await h.coordinator.dispose();
	});

	test("post-deadline recovery preserves local history but returns canWrite false and blocks every send", async () => {
		const { h, batch } = await seed({ queue: true });
		h.transport.server = { ...h.transport.server, canWrite: false };
		const reopened = new AnswerEditCoordinator(h.options);
		const result = ready(await reopened.recover(FIELD));
		expect(result.canWrite).toBe(false);
		expect(result.handle.getState().text).toBe("old queued");
		expect(reopened.getStatus(FIELD)?.delivery).toBe("blocked");
		await reopened.flush();
		await reopened.flushDelivery();
		await h.scheduler.advance(130_000);
		expect(h.transport.requests).toHaveLength(0);
		expect((await record(h)).outbox).toEqual(batch);
		expect((await record(h)).text).toBe("old queued");
		await reopened.dispose();
	});

	test("canWrite false on registration still saves local typing without starting delivery", async () => {
		const h = rig();
		h.transport.server = { ...h.transport.server, canWrite: false };
		expect(ready(await h.coordinator.register(FIELD, h.monitor)).canWrite).toBe(
			false,
		);
		h.append("local only");
		await h.coordinator.flushDelivery();
		await h.scheduler.advance(130_000);
		expect((await record(h)).text).toBe("local only");
		expect(h.transport.requests).toHaveLength(0);
		expect(h.coordinator.getStatus(FIELD)?.delivery).toBe("blocked");
		await h.coordinator.dispose();
	});
});
