import { expect, test } from "@playwright/test";
import { replayEdits } from "@/services/answer-edits/codec";
import type {
	AttemptTransport,
	FieldResult,
	ServerFieldState,
} from "@/services/answer-edits/coordinator";
import { AnswerEditMonitor } from "@/services/answer-edits/monitor";
import {
	deferred,
	drain,
	EPOCH,
	FIELD,
	ManualScheduler,
	REF,
	restoreRecord,
	rig,
} from "./helpers/answer-edit-coordinator";

type Request = Parameters<AttemptTransport["send"]>[0];
type PartialFailure = "retry" | "missing" | "invalid receipt";

function editor(sessionId: string) {
	return new AnswerEditMonitor({
		initialText: "",
		sessionId,
		baseRevision: 0,
		firstSeq: 1,
		now: () => 10_000,
	});
}

function append(handle: AnswerEditMonitor, text: string) {
	handle.recordChange({
		atMs: 10_100,
		kind: "paste",
		replacements: [
			{
				position: handle.getState().text.length,
				deleteCount: 0,
				insertedText: text,
			},
		],
	});
}

function accepted(request: Request): FieldResult[] {
	return request.fields.map(({ questionId, field, batch }) => ({
		questionId,
		field,
		kind: "accepted",
		receipt: {
			batchId: batch.batchId,
			revision: batch.baseRevision + 1,
			lastSeq: batch.firstSeq + batch.edits.length - 1,
		},
	}));
}

function partial(request: Request, failure: PartialFailure): FieldResult[] {
	return accepted(request).flatMap((result): FieldResult[] => {
		if (result.questionId === FIELD.questionId) return [result];
		switch (failure) {
			case "missing":
				return [];
			case "retry":
				return [
					{ questionId: result.questionId, field: result.field, kind: "retry" },
				];
			case "invalid receipt":
				if (result.kind !== "accepted")
					throw new Error("Expected fixture receipt");
				return [
					{
						...result,
						receipt: { ...result.receipt, batchId: "unrelated-batch" },
					},
				];
		}
		throw new Error(`Unknown partial failure: ${failure}`);
	});
}

test.describe("answer edit coordinator races: detach handoff", () => {
	test("recovery does not wait for a held detach commit and its new editor can persist and deliver", async () => {
		const h = rig();
		await h.coordinator.register(FIELD, h.monitor);
		await h.coordinator.persist();
		h.append("before handoff");
		const commits = h.store.commits.length;
		const gate = h.store.holdNextCommit();
		const detach = h.coordinator.detach(FIELD);
		await drain();
		expect(h.store.commits).toHaveLength(commits + 1);
		let recovered = false;
		const recovery = h.coordinator.recover(FIELD, "").then((result) => {
			recovered = true;
			return result;
		});
		await drain();
		const finishedBeforeCommit = recovered;
		// Release before awaiting recovery so the handoff can finish.
		gate.resolve();
		const [, result] = await Promise.all([detach, recovery]);
		expect(finishedBeforeCommit).toBe(true);
		h.monitor.dispose();
		if (!(result.handle instanceof AnswerEditMonitor))
			throw new Error("Expected editable recovered monitor");
		expect(result.handle.getState().text).toBe("before handoff");
		append(result.handle, " after handoff");
		await h.coordinator.persist();
		expect(h.coordinator.getStatus(FIELD)).toMatchObject({
			durability: "durable",
			savedText: "before handoff after handoff",
		});
		h.transport.send = async (request) => {
			h.transport.requests.push(structuredClone(request));
			return accepted(request);
		};
		await h.coordinator.flushDelivery();
		const batches = h.transport.requests.flatMap((request) =>
			request.fields.map(({ batch }) => batch),
		);
		expect(batches.length).toBeGreaterThan(0);
		expect(batches.reduce((text, batch) => replayEdits(text, batch), "")).toBe(
			"before handoff after handoff",
		);
		const saved = await h.store.read(REF, EPOCH);
		expect(saved?.text).toBe("before handoff after handoff");
		if (!saved) throw new Error("Expected durable recovered editor");
		expect(restoreRecord(saved).collect()).toBeNull();
		await h.coordinator.dispose();
	});
});

test.describe("answer edit coordinator races: partial failure backoff", () => {
	/// Jitter bounds are covered by the delivery spec; a fixed midpoint is enough here.
	const random = 0.5;
	for (const failure of ["retry", "missing", "invalid receipt"] as const) {
		test(`${failure} uses jittered backoff despite another field succeeding`, async () => {
			const scheduler = new ManualScheduler();
			const h = rig({
				scheduler,
				random: () => random,
				now: () => EPOCH + scheduler.elapsedMs,
			});
			const pendingField = { questionId: "pending", field: "answer" };
			const pendingEditor = editor("pending-editor-session");
			await h.coordinator.register(FIELD, h.monitor);
			await h.coordinator.register(pendingField, pendingEditor);
			h.append("confirmed");
			append(pendingEditor, "retry unchanged");
			h.transport.send = async (request) => {
				h.transport.requests.push(structuredClone(request));
				return partial(request, failure);
			};
			await h.coordinator.flush();
			expect(h.transport.requests).toHaveLength(1);
			const pendingBatch = h.transport.requests[0]?.fields.find(
				(item) => item.questionId === pendingField.questionId,
			)?.batch;
			expect(pendingBatch).toBeDefined();
			expect(h.coordinator.getStatus(FIELD)?.delivery).toBe("idle");
			h.transport.send = async (request) => {
				h.transport.requests.push(structuredClone(request));
				return accepted(request);
			};

			// Base 1000ms, multiplied by jitter in [0.5, 1.5].
			const retryDelay = 1000 * (0.5 + random);
			await scheduler.advance(Math.floor(retryDelay) - 1);
			expect(h.transport.requests).toHaveLength(1);
			await scheduler.advance(2);
			expect(h.transport.requests).toHaveLength(2);
			expect(h.transport.requests[1]?.fields).toEqual([
				{ ...pendingField, batch: pendingBatch },
			]);
			expect(h.coordinator.getStatus(pendingField)?.delivery).toBe("idle");
			await scheduler.advance(130_000);
			expect(h.transport.requests).toHaveLength(2);
			await h.coordinator.dispose();
		});
	}
});

test.describe("answer edit coordinator races: remount during an acknowledgement", () => {
	test("a remounted editor can durably edit and deliver after an overlapping accepted ACK commit", async () => {
		const h = rig();
		const send = deferred<readonly FieldResult[]>();
		h.transport.sendGate = send;
		await h.coordinator.register(FIELD, h.monitor);
		h.append("A");
		const flush = h.coordinator.flush();
		await drain();
		expect(h.transport.requests).toHaveLength(1);
		const request = h.transport.requests[0];
		if (!request) throw new Error("Expected held delivery");
		const results = accepted(request);
		const result = results[0];
		if (result?.kind !== "accepted") throw new Error("Expected ACK fixture");

		await h.coordinator.detach(FIELD);
		h.monitor.dispose();
		const recovery = h.coordinator.recover(FIELD, "");
		await drain();

		const commits = h.store.commits.length;
		const ackCommit = h.store.holdNextCommit();
		send.resolve(results);
		await drain();
		expect(h.store.commits).toHaveLength(commits + 1);
		await drain();
		ackCommit.resolve();
		const [recovered] = await Promise.all([recovery, flush]);
		if (!(recovered.handle instanceof AnswerEditMonitor))
			throw new Error("Expected recovered editable monitor");
		expect(recovered.handle.getState().text).toBe("A");
		recovered.handle.recordChange({
			atMs: 10_200,
			kind: "paste",
			replacements: [{ position: 1, deleteCount: 0, insertedText: "B" }],
		});
		await h.coordinator.persist();
		expect.soft(h.coordinator.getStatus(FIELD)).toMatchObject({
			durability: "durable",
			savedText: "AB",
		});
		expect.soft((await h.store.read(REF, EPOCH))?.text).toBe("AB");

		h.transport.send = async (next) => {
			h.transport.requests.push(structuredClone(next));
			return accepted(next);
		};
		await h.coordinator.flushDelivery();
		const laterBatches = h.transport.requests
			.slice(1)
			.flatMap((next) => next.fields.map(({ batch }) => batch));
		expect.soft(laterBatches.length).toBeGreaterThan(0);
		expect
			.soft(laterBatches.reduce((text, batch) => replayEdits(text, batch), "A"))
			.toBe("AB");
		const saved = await h.store.read(REF, EPOCH);
		expect.soft(saved?.text).toBe("AB");
		if (!saved) throw new Error("Expected durable post-remount record");
		expect.soft(restoreRecord(saved).collect()).toBeNull();
		await h.coordinator.dispose();
	});

	test("recovery of a detached field does not wait for its in-flight delivery and sees its ACK", async () => {
		const h = rig();
		const send = deferred<readonly FieldResult[]>();
		h.transport.sendGate = send;
		await h.coordinator.register(FIELD, h.monitor);
		h.append("A");
		const flush = h.coordinator.flush();
		await drain();
		const request = h.transport.requests[0];
		if (!request) throw new Error("Expected held delivery");
		const results = accepted(request);
		const result = results[0];
		if (result?.kind !== "accepted") throw new Error("Expected ACK fixture");
		await h.coordinator.detach(FIELD);
		h.monitor.dispose();
		/// The server already applied the batch, but its response is still in transit.
		h.transport.server = {
			text: "A",
			revision: result.receipt.revision,
			nextSeq: result.receipt.lastSeq + 1,
			canWrite: true,
			receipts: [result.receipt],
		};
		const recovered = await h.coordinator.recover(FIELD, "");
		send.resolve(results);
		await flush;
		expect(recovered.handle.getState()).toEqual({
			text: "A",
			hasPendingChanges: false,
			hasUnacknowledgedBatch: false,
		});
		await h.coordinator.persist();
		expect(h.coordinator.getStatus(FIELD)).toMatchObject({
			durability: "durable",
			savedText: "A",
		});
		await h.coordinator.flushDelivery();
		expect(h.transport.requests).toHaveLength(1);
		await h.coordinator.dispose();
	});

	test("remounting during an in-flight delivery stays ready without recording a gap", async () => {
		const h = rig();
		const send = deferred<readonly FieldResult[]>();
		h.transport.sendGate = send;
		await h.coordinator.register(FIELD, h.monitor);
		h.append("A");
		const flush = h.coordinator.flush();
		await drain();
		const request = h.transport.requests[0];
		if (!request) throw new Error("Expected held delivery");
		const results = accepted(request);
		const result = results[0];
		if (result?.kind !== "accepted") throw new Error("Expected ACK fixture");
		await h.coordinator.detach(FIELD);
		h.monitor.dispose();
		const recovery = h.coordinator.recover(FIELD, "");
		await drain();
		h.transport.server = {
			text: "A",
			revision: result.receipt.revision,
			nextSeq: result.receipt.lastSeq + 1,
			canWrite: true,
			receipts: [result.receipt],
		};
		send.resolve(results);
		const [recovered] = await Promise.all([recovery, flush]);
		await drain();
		expect(recovered.handle.getState().hasUnacknowledgedBatch).toBe(false);
		expect(h.coordinator.getStatus(FIELD)).toMatchObject({
			historyGap: false,
			delivery: "idle",
		});
		await h.coordinator.dispose();
	});
});

test.describe("answer edit coordinator races: logout", () => {
	for (const cleanupFails of [false, true]) {
		test(`an inspection returned after ${cleanupFails ? "failed cleanup at" : "successful"} logout cannot change the field or its status`, async () => {
			const h = rig();
			const inspection = deferred<ServerFieldState>();
			const entered = deferred<void>();
			h.transport.inspect = async () => {
				entered.resolve();
				return inspection.promise;
			};
			const cleanupError = new DOMException("Cleanup denied", "SecurityError");
			if (cleanupFails) {
				const revoke = h.store.revoke.bind(h.store);
				h.store.revoke = async () => {
					await revoke();
					throw cleanupError;
				};
			}
			await h.coordinator.recover(FIELD, "");
			await entered.promise;
			const logout = h.coordinator.logout();
			if (cleanupFails) await expect(logout).rejects.toBe(cleanupError);
			else await logout;
			const statuses = structuredClone(h.statuses);
			const commits = h.store.commits.length;
			inspection.resolve(h.transport.server);
			await drain();
			expect.soft(h.statuses).toEqual(statuses);
			await h.coordinator.persist();
			await h.coordinator.flushDelivery();
			await h.scheduler.advance(120_000);
			expect.soft(h.store.revoked).toBe(true);
			expect.soft(h.store.commits).toHaveLength(commits);
			expect.soft(h.transport.requests).toHaveLength(0);
			expect.soft(h.scheduler.pendingCount).toBe(0);
			await h.coordinator.dispose();
		});
	}

	test("repeating a rejected coordinator logout retries the store cleanup", async () => {
		const h = rig();
		const failure = new DOMException("Cleanup denied", "SecurityError");
		let cleanupCalls = 0;
		h.store.revoke = async () => {
			cleanupCalls++;
			if (cleanupCalls === 1) throw failure;
		};
		await expect(h.coordinator.logout()).rejects.toBe(failure);
		await h.coordinator.logout();
		expect(cleanupCalls).toBe(2);
		await h.coordinator.dispose();
	});
});
