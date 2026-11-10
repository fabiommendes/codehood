import { expect, test } from "@playwright/test";
import type { ServerFieldState } from "@/services/answer-edits/coordinator";
import { AnswerEditMonitor } from "@/services/answer-edits/monitor";
import { deferred, drain, FIELD, rig } from "./helpers/answer-edit-coordinator";

type Rig = ReturnType<typeof rig>;

function acceptAll(h: Rig) {
	h.transport.send = async (request) => {
		h.transport.requests.push(structuredClone(request));
		return request.fields.map(({ questionId, field, batch }) => ({
			questionId,
			field,
			kind: "accepted" as const,
			receipt: {
				batchId: batch.batchId,
				revision: batch.baseRevision + 1,
				lastSeq: batch.firstSeq + batch.edits.length - 1,
			},
		}));
	};
}

function type(handle: unknown, atMs: number, at: number, text: string) {
	if (!(handle instanceof AnswerEditMonitor))
		throw new Error("Expected coordinator-owned monitor");
	handle.recordChange({
		atMs,
		kind: "paste",
		replacements: [{ position: at, deleteCount: 0, insertedText: text }],
	});
}

test.describe("answer edit coordinator rebase: the monitor never blocks the field", () => {
	test("real divergence yields a working handle, a recorded gap and a new baseline", async () => {
		const h = rig();
		h.transport.server = {
			text: "server text",
			revision: 5,
			nextSeq: 9,
			canWrite: true,
			receipts: [],
		};
		h.append("typed");
		const opened = await h.coordinator.register(FIELD, h.monitor);
		expect(opened.handle).toBe(h.monitor);
		await drain();
		expect(h.coordinator.getStatus(FIELD)).toMatchObject({ historyGap: true });
		expect(h.monitor.getState().text).toBe("typed");
		expect(h.monitor.getState().hasPendingChanges).toBe(false);

		h.append("!");
		h.transport.send = async (request) => {
			h.transport.requests.push(structuredClone(request));
			return request.fields.map(({ questionId, field, batch }) => ({
				questionId,
				field,
				kind: "accepted" as const,
				receipt: {
					batchId: batch.batchId,
					revision: batch.baseRevision + 1,
					lastSeq: batch.firstSeq + batch.edits.length - 1,
				},
			}));
		};
		await h.coordinator.flushDelivery();
		const batch = h.transport.requests[0]?.fields[0]?.batch;
		expect(batch).toMatchObject({ baseRevision: 5, firstSeq: 9 });
		await h.coordinator.dispose();
	});

	test("a compatible server does not record a gap", async () => {
		const h = rig();
		await h.coordinator.register(FIELD, h.monitor);
		await drain();
		expect(h.coordinator.getStatus(FIELD)).toMatchObject({ historyGap: false });
		await h.coordinator.dispose();
	});

	test("open resolves and accepts typing while inspect never resolves", async () => {
		const h = rig();
		h.transport.inspectionGate = deferred();
		const opened = await h.coordinator.recover(FIELD, "draft");
		expect(opened.handle.getState().text).toBe("draft");
		const editor = opened.handle;
		if (!(editor instanceof AnswerEditMonitor))
			throw new Error("Expected coordinator-owned monitor");
		editor.recordChange({
			atMs: 20_000,
			kind: "paste",
			replacements: [{ position: 5, deleteCount: 0, insertedText: "!" }],
		});
		await h.coordinator.persist();
		expect(h.coordinator.getStatus(FIELD)).toMatchObject({
			durability: "durable",
			savedText: "draft!",
		});
		await h.coordinator.flush();
		expect(h.transport.requests).toHaveLength(0);
		await h.coordinator.dispose();
	});

	test("an inspection that rejects leaves the handle usable and is retried on the next delivery", async () => {
		const h = rig();
		let calls = 0;
		h.transport.inspect = async () => {
			calls++;
			if (calls === 1) throw new Error("offline");
			return structuredClone(h.transport.server);
		};
		const opened = await h.coordinator.register(FIELD, h.monitor);
		expect(opened.handle).toBe(h.monitor);
		await drain();
		h.append("A");
		await h.scheduler.advance(140_000);
		expect(calls).toBeGreaterThan(1);
		expect(h.transport.requests.length).toBeGreaterThan(0);
		await h.coordinator.dispose();
	});

	test("a server conflict result rebases with a gap instead of blocking the field", async () => {
		const h = rig();
		await h.coordinator.register(FIELD, h.monitor);
		await drain();
		h.append("A");
		h.transport.send = async (request) => {
			h.transport.requests.push(structuredClone(request));
			return request.fields.map(({ questionId, field }) => ({
				questionId,
				field,
				kind: "conflict" as const,
			}));
		};
		h.transport.server = {
			text: "other",
			revision: 3,
			nextSeq: 4,
			canWrite: true,
			receipts: [],
		};
		await h.coordinator.flush();
		await drain();
		expect(h.coordinator.getStatus(FIELD)).toMatchObject({ historyGap: true });
		expect(h.monitor.getState().text).toBe("A");
		h.append("B");
		await h.coordinator.dispose();
	});
});

test.describe("answer edit coordinator rebase: storage failure", () => {
	test("unreadable stores still yield a handle that accepts edits without throwing", async () => {
		const h = rig();
		h.store.failRead = true;
		h.store.failCommit = true;
		h.fallback.failWrite = true;
		h.fallback.read = () => {
			throw new Error("localStorage unavailable");
		};
		const opened = await h.coordinator.recover(FIELD, "draft");
		expect(opened.handle.getState().text).toBe("draft");
		const editor = opened.handle;
		if (!(editor instanceof AnswerEditMonitor))
			throw new Error("Expected coordinator-owned monitor");
		editor.recordChange({
			atMs: 20_000,
			kind: "paste",
			replacements: [{ position: 5, deleteCount: 0, insertedText: "!" }],
		});
		await h.coordinator.persist();
		expect(editor.getState().text).toBe("draft!");
		expect(h.coordinator.getStatus(FIELD)).toMatchObject({
			durability: "unavailable",
			historyGap: true,
		});
		await h.coordinator.dispose();
	});
});

test.describe("answer edit coordinator rebase: normal path keeps history", () => {
	for (const [name, server, text] of [
		[
			"a server that holds the starting text",
			{ text: "draft", revision: 3, nextSeq: 7 },
			"draft",
		],
		[
			"a fresh field the server knows nothing about",
			{ text: "", revision: 0, nextSeq: 1 },
			"",
		],
	] as const) {
		test(`edits typed during a slow inspection survive ${name}`, async () => {
			const h = rig();
			const inspection = deferred<ServerFieldState>();
			h.transport.inspectionGate = inspection;
			acceptAll(h);
			const { handle } = await h.coordinator.recover(FIELD, text);
			type(handle, 20_000, text.length, "A");
			type(handle, 20_500, text.length + 1, "B");
			inspection.resolve({ ...server, canWrite: true, receipts: [] });
			await drain();
			expect(h.coordinator.getStatus(FIELD)).toMatchObject({
				historyGap: false,
			});
			await h.coordinator.flushDelivery();
			const batches = h.transport.requests.flatMap((request) =>
				request.fields.map(({ batch }) => batch),
			);
			expect(batches).toHaveLength(1);
			expect(batches[0]).toMatchObject({
				baseRevision: server.revision,
				firstSeq: server.nextSeq,
				snapshot: `${text}AB`,
			});
			expect(h.coordinator.getStatus(FIELD)).toMatchObject({
				historyGap: false,
				delivery: "idle",
			});
			await h.coordinator.dispose();
		});
	}

	test("registering an editor over a detached field with a delivery in flight records no gap", async () => {
		const h = rig();
		const send = deferred<Awaited<ReturnType<(typeof h.transport)["send"]>>>();
		h.transport.sendGate = send;
		await h.coordinator.register(FIELD, h.monitor);
		await drain();
		h.append("A");
		const flush = h.coordinator.flush();
		await drain();
		const request = h.transport.requests[0];
		const sent = request?.fields[0]?.batch;
		if (!sent) throw new Error("Expected held delivery");
		await h.coordinator.detach(FIELD);
		h.monitor.dispose();
		const editor = new AnswerEditMonitor({
			initialText: "",
			sessionId: "second-editor",
			baseRevision: 0,
			firstSeq: 1,
			now: () => 30_000,
		});
		editor.recordChange({
			atMs: 30_100,
			kind: "paste",
			replacements: [{ position: 0, deleteCount: 0, insertedText: "A" }],
		});
		await h.coordinator.register(FIELD, editor);
		const receipt = {
			batchId: sent.batchId,
			revision: 1,
			lastSeq: sent.firstSeq + sent.edits.length - 1,
		};
		h.transport.server = {
			text: "A",
			revision: 1,
			nextSeq: receipt.lastSeq + 1,
			canWrite: true,
			receipts: [receipt],
		};
		send.resolve(
			request?.fields.map(({ questionId, field }) => ({
				questionId,
				field,
				kind: "accepted" as const,
				receipt,
			})) ?? [],
		);
		await flush;
		await drain();
		expect(h.coordinator.getStatus(FIELD)).toMatchObject({
			historyGap: false,
		});
		expect(editor.getState().text).toBe("A");
		await h.coordinator.dispose();
	});
});

test.describe("answer edit coordinator rebase: hung storage", () => {
	test("a read that never resolves delays open only by the timeout", async () => {
		const h = rig();
		h.store.read = () => new Promise(() => {});
		let opened = false;
		const pending = h.coordinator.recover(FIELD, "draft").then((result) => {
			opened = true;
			return result;
		});
		await drain();
		expect(opened).toBe(false);
		await h.scheduler.advance(5000);
		const { handle } = await pending;
		expect(handle.getState().text).toBe("draft");
		expect(h.coordinator.getStatus(FIELD)).toMatchObject({ historyGap: true });
		await h.coordinator.dispose();
	});

	test("a commit that never resolves does not stall later persists or deliveries", async () => {
		const h = rig();
		acceptAll(h);
		await h.coordinator.register(FIELD, h.monitor);
		await drain();
		h.store.commit = () => new Promise(() => {});
		h.append("A");
		const first = h.coordinator.persist();
		await h.scheduler.advance(5000);
		await first;
		expect(h.coordinator.getStatus(FIELD)).toMatchObject({
			durability: "text-only",
			savedText: "A",
		});
		h.append("B");
		const second = h.coordinator.persist();
		await h.scheduler.advance(5000);
		await second;
		expect(
			h.fallback.read({ attemptId: "attempt", ...FIELD }, 1_800_000_000_000)
				?.text,
		).toBe("AB");
		let delivered = false;
		const delivery = h.coordinator.flushDelivery().then(() => {
			delivered = true;
		});
		/// Each round of delivery commits again, so each round waits out one timeout.
		for (let round = 0; round < 6 && !delivered; round++)
			await h.scheduler.advance(5000);
		await delivery;
		expect(h.transport.requests.length).toBeGreaterThan(0);
		const disposal = h.coordinator.dispose();
		await h.scheduler.advance(5000);
		await disposal;
	});
});
