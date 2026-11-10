import { expect, test } from "@playwright/test";
import { AnswerEditMonitor } from "@/services/answer-edits/monitor";
import { deferred, drain, FIELD, rig } from "./helpers/answer-edit-coordinator";

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
