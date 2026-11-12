import { expect, test } from "@playwright/test";
import { replayEdits } from "@/services/answer-edits/codec";
import { AnswerEditMonitor } from "@/services/answer-edits/monitor";
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

async function saved(h: Rig) {
	const record = await h.store.read(REF, EPOCH);
	expect(record).not.toBeNull();
	if (!record) throw new Error("Expected a completed local commit");
	return record;
}

async function registered() {
	const h = rig();
	await h.coordinator.register(FIELD, h.monitor);
	await h.coordinator.persist();
	return h;
}

test.describe("answer edit coordinator local: durability", () => {
	for (const mode of ["register", "recover"] as const) {
		test(`${mode} opens without waiting for the authenticated inspection`, async () => {
			const h = rig();
			const inspection = deferred<typeof h.transport.server>();
			h.transport.inspectionGate = inspection;
			const result = await (mode === "register"
				? h.coordinator.register(FIELD, h.monitor)
				: h.coordinator.recover(FIELD, ""));
			expect(result.handle.getState().text).toBe("");
			await drain();
			expect(h.transport.inspections).toEqual([REF]);
			inspection.resolve(h.transport.server);
			await drain();
			expect(h.coordinator.getStatus(FIELD)).toMatchObject({
				historyGap: false,
			});
			await h.coordinator.dispose();
		});
	}

	test("reports pending until the current generation commits, retaining the last completed text", async () => {
		const h = await registered();
		h.append("saved");
		await h.coordinator.persist();
		const previous = await saved(h);
		const gate = h.store.holdNextCommit();
		h.append(" plus pending");
		const persist = h.coordinator.persist();
		await drain();
		expect(h.coordinator.getStatus(FIELD)).toMatchObject({
			durability: "pending",
			savedText: "saved",
		});
		expect(await saved(h)).toEqual(previous);
		gate.resolve();
		await persist;
		expect(h.coordinator.getStatus(FIELD)).toMatchObject({
			durability: "durable",
			savedText: "saved plus pending",
			historyGap: false,
		});
		expect(restoreRecord(await saved(h)).getState().text).toBe(
			"saved plus pending",
		);
		await h.coordinator.dispose();
	});

	test("coalesces continuous typing within 1000ms of first dirty without closing the edit or altering cadence", async () => {
		const h = await registered();
		const baseline = h.store.commits.length;
		h.append("a");
		for (const letter of ["b", "c", "d", "e"]) {
			await h.scheduler.advance(200);
			h.append(letter, 200);
		}
		await h.scheduler.advance(200);
		const first = await saved(h);
		expect(first.text).toBe("abcde");
		expect(h.store.commits.length - baseline).toBeGreaterThanOrEqual(1);
		expect(h.store.commits.length - baseline).toBeLessThan(5);
		expect(first.savedAt).toBe(EPOCH);
		expect(first.expiresAt).toBeGreaterThan(EPOCH);
		expect(h.transport.requests).toHaveLength(0);
		h.append("f", 200);
		await h.coordinator.persist();
		const batch = h.monitor.collect();
		expect(batch).not.toBeNull();
		if (!batch) throw new Error("Expected typing batch");
		expect(batch.edits).toHaveLength(1);
		expect(batch.edits[0]?.[4]).toBe("abcdef");
		expect(batch.edits[0]?.[6]).toEqual([5, 200, 0]);
		expect(replayEdits("", batch)).toBe("abcdef");
		await h.coordinator.dispose();
	});

	test("serializes commits and makes persist wait for edits made while an older commit is pending", async () => {
		const h = await registered();
		const baseline = h.store.commits.length;
		const old = await saved(h);
		const gate = h.store.holdNextCommit();
		h.append("old");
		let complete = false;
		const persist = h.coordinator.persist().then(() => {
			complete = true;
		});
		await drain();
		h.append(" new");
		await h.scheduler.advance(1000);
		expect(h.store.commits).toHaveLength(baseline + 1);
		expect(await saved(h)).toEqual(old);
		expect(complete).toBe(false);
		gate.resolve();
		await persist;
		expect(complete).toBe(true);
		expect(h.store.commits.length).toBeGreaterThanOrEqual(baseline + 2);
		const latest = await saved(h);
		expect(latest.text).toBe("old new");
		expect(restoreRecord(latest).getState().text).toBe("old new");
		expect(h.coordinator.getStatus(FIELD)).toMatchObject({
			durability: "durable",
			savedText: "old new",
		});
		await h.coordinator.dispose();
	});

	test("failed atomic outbox commit retains the previous checkpoint and still sends the frozen batch without claiming durability", async () => {
		const h = await registered();
		h.append("before");
		await h.coordinator.persist();
		const previous = await saved(h);
		h.append(" after");
		h.store.failCommit = true;
		await h.coordinator.flush();
		expect(h.transport.requests).toHaveLength(1);
		expect(h.transport.requests[0]?.fields[0]?.batch?.snapshot).toBe(
			"before after",
		);
		expect(h.coordinator.getStatus(FIELD)).toMatchObject({
			durability: "unavailable",
			historyGap: true,
		});
		expect(await saved(h)).toEqual(previous);
		expect(restoreRecord(previous).getState().text).toBe("before");
		h.store.failCommit = false;
		await h.coordinator.persist();
		const committed = await saved(h);
		expect(committed.text).toBe("before after");
		expect(committed.outbox?.snapshot).toBe("before after");
		const restored = restoreRecord(committed);
		expect(restored.getState().text).toBe(committed.text);
		expect(restored.collect()).toEqual(committed.outbox);
		await h.coordinator.dispose();
	});
});

test.describe("answer edit coordinator local: persistence cost", () => {
	test("an idle delivery loop does not export checkpoints to measure progress", async () => {
		const h = await registered();
		let exports = 0;
		const exported = h.monitor.exportCheckpoint.bind(h.monitor);
		h.monitor.exportCheckpoint = () => {
			exports++;
			return exported();
		};
		await h.coordinator.flushDelivery();
		expect(exports).toBe(0);
		await h.coordinator.dispose();
	});
});

test.describe("answer edit coordinator local: storage degradation", () => {
	for (const previous of [null, "earlier"] as const) {
		test(`a failing store never claims the current text was saved, with ${previous === null ? "no" : "a prior"} successful save`, async () => {
			const h = rig();
			if (previous === null) {
				h.store.failCommit = true;
			}
			await h.coordinator.register(FIELD, h.monitor);
			if (previous !== null) {
				h.append(previous);
				await h.coordinator.persist();
			}
			h.store.failCommit = true;
			expect(() => h.append(" unsaved")).not.toThrow();
			await h.coordinator.persist();
			expect(h.coordinator.getStatus(FIELD)).toMatchObject({
				durability: "unavailable",
				savedText: previous,
			});
			expect(h.coordinator.getStatus(FIELD)?.error).toBeTruthy();
			expect(() => h.append(" still editable")).not.toThrow();
			await h.scheduler.advance(1000);
			expect(h.monitor.getState().text).toBe(
				`${previous ?? ""} unsaved still editable`,
			);
			await h.coordinator.flush();
			expect(h.transport.requests).toHaveLength(1);
			expect(h.coordinator.getStatus(FIELD)?.durability).toBe("unavailable");
			await h.coordinator.dispose();
		});
	}
});

test.describe("answer edit coordinator local: ownership", () => {
	test("accepts 128 distinct fields and rejects one more without losing registered work", async () => {
		const h = rig();
		for (let index = 0; index < 128; index++) {
			const field = { questionId: `question-${index}`, field: "answer" };
			await h.coordinator.recover(field, "");
		}
		await expect(
			Promise.resolve().then(() =>
				h.coordinator.recover({ questionId: "overflow", field: "answer" }, ""),
			),
		).rejects.toThrow();
		expect(
			h.coordinator.getStatus({ questionId: "question-0", field: "answer" }),
		).not.toBeNull();
		expect(
			h.coordinator.getStatus({ questionId: "question-127", field: "answer" }),
		).not.toBeNull();
		await h.coordinator.dispose();
	});

	test("rejects a duplicate active field without replacing its owner", async () => {
		const h = await registered();
		const duplicate = new AnswerEditMonitor({
			initialText: "",
			sessionId: "duplicate",
			baseRevision: 0,
			firstSeq: 1,
			now: () => 10_000,
		});
		await expect(
			Promise.resolve().then(() => h.coordinator.register(FIELD, duplicate)),
		).rejects.toThrow();
		h.append("original owner");
		await h.coordinator.persist();
		expect((await saved(h)).text).toBe("original owner");
		await h.coordinator.dispose();
	});

	test("detach transfers a closed clone before the caller disposes and retains its unsent edits", async () => {
		const h = await registered();
		h.append("detached");
		await h.coordinator.detach(FIELD);
		h.monitor.dispose();
		await h.coordinator.persist();
		const record = await saved(h);
		expect(record.text).toBe("detached");
		const replay = restoreRecord(record).collect();
		expect(replay?.snapshot).toBe("detached");
		await h.coordinator.flush();
		expect(h.transport.requests).toHaveLength(1);
		const batch = h.transport.requests[0]?.fields[0]?.batch;
		expect(batch?.snapshot).toBe("detached");
		if (!batch) throw new Error("Expected detached batch");
		expect(replayEdits("", batch)).toBe("detached");
		expect((await saved(h)).outbox).toEqual(batch);
		await h.coordinator.dispose();
	});

	test("dispose performs a final save, cancels timers and unsubscribes without erasing storage", async () => {
		const h = await registered();
		h.append("final");
		await h.coordinator.dispose();
		const record = await saved(h);
		expect(record.text).toBe("final");
		expect(h.store.revoked).toBe(false);
		expect(h.scheduler.pendingCount).toBe(0);
		const commits = h.store.commits.length;
		const statuses = h.statuses.length;
		h.append(" after dispose");
		await h.scheduler.advance(120_000);
		await h.coordinator.dispose();
		expect(h.store.commits).toHaveLength(commits);
		expect(h.statuses).toHaveLength(statuses);
		expect(await saved(h)).toEqual(record);
		expect(h.transport.requests).toHaveLength(0);
	});

	test("logout revokes the owner store and fences a commit completing after revocation", async () => {
		const h = await registered();
		const gate = h.store.holdNextCommit();
		h.append("in flight");
		const persist = h.coordinator.persist();
		await drain();
		const logout = h.coordinator.logout();
		await drain();
		expect(h.store.revoked).toBe(true);
		const statuses = h.statuses.length;
		gate.resolve();
		await Promise.all([persist, logout]);
		h.append(" ignored");
		await h.scheduler.advance(120_000);
		expect(await h.store.read(REF, EPOCH)).toBeNull();
		expect(h.statuses).toHaveLength(statuses);
		expect(h.scheduler.pendingCount).toBe(0);
		expect(h.transport.requests).toHaveLength(0);
	});

	test("ignores a transport receipt returned after logout instead of recreating local state", async () => {
		const h = await registered();
		h.append("sent");
		const response =
			deferred<
				readonly import("@/services/answer-edits/coordinator").FieldResult[]
			>();
		h.transport.sendGate = response;
		const flush = h.coordinator.flush();
		await drain();
		expect(h.transport.requests).toHaveLength(1);
		const batch = h.transport.requests[0]?.fields[0]?.batch;
		if (!batch) throw new Error("Expected a sent batch");
		const logout = h.coordinator.logout();
		await drain();
		expect(h.store.revoked).toBe(true);
		const statuses = h.statuses.length;
		const commits = h.store.commits.length;
		response.resolve([
			{
				...FIELD,
				kind: "accepted",
				receipt: {
					batchId: batch.batchId,
					revision: batch.baseRevision + 1,
					lastSeq: batch.firstSeq + batch.edits.length - 1,
				},
			},
		]);
		await Promise.all([flush, logout]);
		await h.scheduler.advance(120_000);
		expect(h.store.commits).toHaveLength(commits);
		expect(h.statuses).toHaveLength(statuses);
		expect(await h.store.read(REF, EPOCH)).toBeNull();
	});
});
