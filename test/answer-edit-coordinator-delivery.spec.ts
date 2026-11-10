import { expect, test } from "@playwright/test";
import { replayEdits } from "@/services/answer-edits/codec";
import {
	AnswerEditCoordinator,
	type AttemptTransport,
	type FieldResult,
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
	ManualScheduler,
	REF,
	restoreRecord,
	rig,
} from "./helpers/answer-edit-coordinator";

type Rig = ReturnType<typeof rig>;
type Request = Parameters<AttemptTransport["send"]>[0];

function receipt(batch: PendingEditBatch) {
	return {
		batchId: batch.batchId,
		revision: batch.baseRevision + 1,
		lastSeq: batch.firstSeq + batch.edits.length - 1,
	};
}

function accepted(request: Request): FieldResult[] {
	return request.fields.map(({ questionId, field, batch }) => ({
		questionId,
		field,
		kind: "accepted",
		receipt: receipt(batch),
	}));
}

function respond(h: Rig, send: AttemptTransport["send"]) {
	h.transport.send = async (request) => {
		h.transport.requests.push(structuredClone(request));
		return send(request);
	};
}

async function registered(random = 0.5) {
	const scheduler = new ManualScheduler();
	const h = rig({
		random: () => random,
		scheduler,
		now: () => EPOCH + scheduler.elapsedMs,
	});
	await h.coordinator.register(FIELD, h.monitor);
	return h;
}

function sentBatch(h: Rig, requestIndex = 0, fieldIndex = 0) {
	const batch = h.transport.requests[requestIndex]?.fields[fieldIndex]?.batch;
	if (!batch) throw new Error("Expected an outgoing batch");
	return batch;
}

async function saved(h: Rig) {
	const record = await h.store.read(REF, EPOCH);
	if (!record) throw new Error("Expected durable checkpoint");
	return record;
}

test.describe("answer edit coordinator delivery: scheduling and retry", () => {
	for (const random of [0, 0.5, 0.999999]) {
		test(`periodic delivery stays within 55–65 seconds with injected random ${random}`, async () => {
			const h = await registered(random);
			respond(h, async (request) => accepted(request));
			h.append("draft");
			await h.scheduler.advance(54_999);
			expect(h.transport.requests).toHaveLength(0);
			await h.scheduler.advance(10_001);
			expect(h.transport.requests).toHaveLength(1);
			expect(sentBatch(h).snapshot).toBe("draft");
			await h.scheduler.advance(130_000);
			expect(h.transport.requests).toHaveLength(1);
			await h.coordinator.dispose();
		});
	}

	test("randomness changes the network deadline rather than the persistence deadline", async () => {
		const early = await registered(0);
		const late = await registered(0.999999);
		respond(early, async (request) => accepted(request));
		respond(late, async (request) => accepted(request));
		early.append("early");
		late.append("late");
		await early.scheduler.advance(1000);
		await late.scheduler.advance(1000);
		expect((await saved(early)).text).toBe("early");
		expect((await saved(late)).text).toBe("late");
		await early.scheduler.advance(59_000);
		await late.scheduler.advance(59_000);
		expect(early.transport.requests).toHaveLength(1);
		expect(late.transport.requests).toHaveLength(0);
		await Promise.all([
			early.coordinator.dispose(),
			late.coordinator.dispose(),
		]);
	});

	test("one request aggregates dirty fields and omits registered clean fields", async () => {
		const h = await registered();
		respond(h, async (request) => accepted(request));
		const second = { questionId: "second", field: "code" };
		const other = new AnswerEditMonitor({
			initialText: "",
			sessionId: "second-session",
			baseRevision: 0,
			firstSeq: 1,
			now: () => 10_000,
		});
		const clean = new AnswerEditMonitor({
			initialText: "",
			sessionId: "clean-session",
			baseRevision: 0,
			firstSeq: 1,
			now: () => 10_000,
		});
		await h.coordinator.register(second, other);
		await h.coordinator.register(
			{ questionId: "clean", field: "answer" },
			clean,
		);
		h.append("answer");
		other.recordChange({
			atMs: 10_100,
			kind: "paste",
			replacements: [{ position: 0, deleteCount: 0, insertedText: "code" }],
		});
		await h.scheduler.advance(65_000);
		expect(h.transport.requests).toHaveLength(1);
		expect(h.transport.requests[0]).toMatchObject({ attemptId: REF.attemptId });
		expect(h.transport.requests[0]?.fields).toHaveLength(2);
		expect(h.transport.requests[0]?.fields).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					...FIELD,
					batch: expect.objectContaining({ snapshot: "answer" }),
				}),
				expect.objectContaining({
					...second,
					batch: expect.objectContaining({ snapshot: "code" }),
				}),
			]),
		);
		await h.coordinator.dispose();
	});

	test("concurrent flush and periodic delivery do not resend inflight work or lose newly typed text", async () => {
		const h = await registered();
		const response = deferred<readonly FieldResult[]>();
		respond(h, async () => response.promise);
		h.append("first");
		const first = h.coordinator.flush();
		await drain();
		const frozen = structuredClone(sentBatch(h));
		h.append(" second");
		const concurrent = h.coordinator.flush();
		await h.scheduler.advance(65_000);
		expect(h.transport.requests).toHaveLength(1);
		expect(sentBatch(h)).toEqual(frozen);
		expect((await saved(h)).text).toBe("first second");
		response.resolve(accepted(h.transport.requests[0]!));
		await Promise.all([first, concurrent]);
		respond(h, async (request) => accepted(request));
		await h.coordinator.flushDelivery();
		expect(h.transport.requests).toHaveLength(2);
		const next = sentBatch(h, 1);
		expect(next.batchId).not.toBe(frozen.batchId);
		expect(replayEdits("first", next)).toBe("first second");
		expect(restoreRecord(await saved(h)).collect()).toBeNull();
		await h.coordinator.dispose();
	});

	for (const failure of ["network error", "lost acknowledgement"] as const) {
		test(`retry after ${failure} preserves the exact batch and identifier`, async () => {
			const h = await registered();
			let attempt = 0;
			respond(h, async (request) => {
				attempt++;
				if (attempt === 1) {
					if (failure === "network error") throw new Error("Offline");
					return [];
				}
				return accepted(request);
			});
			h.append("sent");
			await h.coordinator.flush();
			const frozen = structuredClone(sentBatch(h));
			h.append(" queued");
			await h.coordinator.flush();
			expect(sentBatch(h, 1)).toEqual(frozen);
			expect((await saved(h)).text).toBe("sent queued");
			await h.coordinator.flushDelivery();
			expect(sentBatch(h, 2).snapshot).toBe("sent queued");
			expect(restoreRecord(await saved(h)).collect()).toBeNull();
			await h.coordinator.dispose();
		});
	}

	test("retry delay doubles to a capped base, then successful delivery restores the minute cadence", async () => {
		const h = await registered();
		let gate = deferred<readonly FieldResult[]>();
		respond(h, async () => gate.promise);
		h.append("retry");
		const initial = h.coordinator.flush();
		await drain();
		for (const [index, delay] of [
			1000, 2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000,
		].entries()) {
			const failed = gate;
			gate = deferred<readonly FieldResult[]>();
			failed.reject(new Error("Offline"));
			await drain();
			await h.scheduler.advance(delay - 1);
			expect(h.transport.requests).toHaveLength(index + 1);
			await h.scheduler.advance(1);
			expect(h.transport.requests).toHaveLength(index + 2);
			expect(sentBatch(h, index + 1)).toEqual(sentBatch(h));
		}
		gate.resolve(accepted(h.transport.requests.at(-1)!));
		await initial;
		await drain();
		gate = deferred<readonly FieldResult[]>();
		h.append(" after success");
		await h.scheduler.advance(54_999);
		expect(h.transport.requests).toHaveLength(9);
		await h.scheduler.advance(10_001);
		expect(h.transport.requests).toHaveLength(10);
		// A new failure after success must restart at the initial backoff.
		const failed = gate;
		gate = deferred<readonly FieldResult[]>();
		failed.reject(new Error("Offline again"));
		await drain();
		await h.scheduler.advance(999);
		expect(h.transport.requests).toHaveLength(10);
		await h.scheduler.advance(1);
		expect(h.transport.requests).toHaveLength(11);
		gate.resolve(accepted(h.transport.requests[10]!));
		await drain();
		await h.coordinator.dispose();
	});

	for (const random of [0, 0.999999]) {
		test(`initial retry jitter stays in 500–1500ms for random ${random}`, async () => {
			const h = await registered(random);
			let fail = true;
			const hold = deferred<readonly FieldResult[]>();
			respond(h, async () => {
				if (fail) throw new Error("Offline");
				return hold.promise;
			});
			h.append("retry");
			await h.coordinator.flush();
			fail = false;
			await h.scheduler.advance(499);
			expect(h.transport.requests).toHaveLength(1);
			await h.scheduler.advance(501);
			expect(h.transport.requests).toHaveLength(random === 0 ? 2 : 1);
			await h.scheduler.advance(500);
			expect(h.transport.requests).toHaveLength(2);
			hold.resolve(accepted(h.transport.requests[1]!));
			await drain();
			await h.coordinator.dispose();
		});
	}
});

test.describe("answer edit coordinator delivery: independent acknowledgements", () => {
	for (const response of [
		"omitted",
		"duplicate",
		"wrong batch",
		"wrong revision",
		"wrong sequence",
	] as const) {
		test(`${response} result does not discard pending history`, async () => {
			const h = await registered();
			respond(h, async (request) => {
				const results = accepted(request);
				const result = results[0];
				if (!result || result.kind !== "accepted")
					throw new Error("Missing fixture receipt");
				switch (response) {
					case "omitted":
						return [];
					case "duplicate":
						return [result, result];
					case "wrong batch":
						return [
							{
								...result,
								receipt: { ...result.receipt, batchId: "unrelated" },
							},
						];
					case "wrong revision":
						return [{ ...result, receipt: { ...result.receipt, revision: 8 } }];
					case "wrong sequence":
						return [{ ...result, receipt: { ...result.receipt, lastSeq: 99 } }];
				}
			});
			h.append("keep history");
			await h.coordinator.flush();
			const original = sentBatch(h);
			expect(restoreRecord(await saved(h)).collect()).toEqual(original);
			expect(h.coordinator.getStatus(FIELD)?.delivery).not.toBe("idle");
			await h.coordinator.dispose();
		});
	}

	test("a conflict blocks only that field while another field is durably acknowledged and omitted from retry", async () => {
		const h = await registered();
		const blocked = { questionId: "blocked", field: "code" };
		const other = new AnswerEditMonitor({
			initialText: "",
			sessionId: "blocked-session",
			baseRevision: 0,
			firstSeq: 1,
			now: () => 10_000,
		});
		await h.coordinator.register(blocked, other);
		other.recordChange({
			atMs: 10_100,
			kind: "paste",
			replacements: [
				{ position: 0, deleteCount: 0, insertedText: "conflicting" },
			],
		});
		h.append("accepted");
		respond(h, async (request) =>
			accepted(request).map((result) =>
				result.questionId === blocked.questionId
					? {
							...blocked,
							kind: "conflict" as const,
							message: "Remote revision changed",
						}
					: result,
			),
		);
		await h.coordinator.flush();
		expect(restoreRecord(await saved(h)).collect()).toBeNull();
		expect(h.coordinator.getStatus(FIELD)?.delivery).toBe("idle");
		expect(h.coordinator.getStatus(blocked)?.delivery).toBe("blocked");
		const conflict = await h.store.read({ ...REF, ...blocked }, EPOCH);
		expect(conflict?.text).toBe("conflicting");
		expect(conflict?.outbox?.snapshot).toBe("conflicting");
		await h.coordinator.flushDelivery();
		expect(h.transport.requests).toHaveLength(1);
		h.append(" more");
		await h.coordinator.flush();
		expect(h.transport.requests[1]?.fields).toHaveLength(1);
		expect(h.transport.requests[1]?.fields[0]).toMatchObject(FIELD);
		await h.coordinator.dispose();
	});

	test("a partial response acknowledges its successful field and retries only the omitted field", async () => {
		const h = await registered();
		const missing = { questionId: "missing", field: "answer" };
		const other = new AnswerEditMonitor({
			initialText: "",
			sessionId: "missing-session",
			baseRevision: 0,
			firstSeq: 1,
			now: () => 10_000,
		});
		await h.coordinator.register(missing, other);
		h.append("confirmed");
		other.recordChange({
			atMs: 10_100,
			kind: "paste",
			replacements: [
				{ position: 0, deleteCount: 0, insertedText: "unconfirmed" },
			],
		});
		respond(h, async (request) =>
			accepted(request).filter(
				(result) => result.questionId === FIELD.questionId,
			),
		);
		await h.coordinator.flush();
		expect(restoreRecord(await saved(h)).collect()).toBeNull();
		const unconfirmed = h.transport.requests[0]?.fields.find(
			(field) => field.questionId === missing.questionId,
		)?.batch;
		expect(unconfirmed).toBeDefined();
		respond(h, async (request) => accepted(request));
		await h.coordinator.flushDelivery();
		expect(h.transport.requests[1]?.fields).toEqual([
			{ ...missing, batch: unconfirmed },
		]);
		expect(h.coordinator.getStatus(missing)?.delivery).toBe("idle");
		await h.coordinator.dispose();
	});

	test("flushDelivery stops after a retry result instead of spinning indefinitely", async () => {
		const h = await registered();
		h.append("offline");
		await h.coordinator.flushDelivery();
		expect(h.transport.requests).toHaveLength(1);
		expect((await saved(h)).outbox).toEqual(sentBatch(h));
		await h.coordinator.dispose();
	});

	test("a late response from a disposed coordinator cannot overwrite its successor's completed work", async () => {
		const h = await registered();
		const response = deferred<readonly FieldResult[]>();
		respond(h, async () => response.promise);
		h.append("sent");
		const oldFlush = h.coordinator.flush();
		await drain();
		const oldRequest = h.transport.requests[0];
		if (!oldRequest) throw new Error("Expected outgoing request");
		await h.coordinator.dispose();
		const replacement = new AnswerEditCoordinator({
			...h.options,
			monotonicNow: () => 0,
			onStatus: () => {},
		});
		const recovered = await replacement.recover(FIELD);
		if (
			recovered.kind !== "ready" ||
			!(recovered.handle instanceof AnswerEditMonitor)
		)
			throw new Error("Expected restored editor");
		recovered.handle.recordChange({
			atMs: 1,
			kind: "paste",
			replacements: [
				{ position: 4, deleteCount: 0, insertedText: " from successor" },
			],
		});
		respond(h, async (request) => accepted(request));
		await replacement.flushDelivery();
		const completed = await saved(h);
		expect(completed.text).toBe("sent from successor");
		expect(restoreRecord(completed).collect()).toBeNull();
		const commits = h.store.commits.length;
		const callbacks = h.statuses.length;
		response.resolve(accepted(oldRequest));
		await oldFlush;
		await drain();
		expect(await saved(h)).toEqual(completed);
		expect(h.store.commits).toHaveLength(commits);
		expect(h.statuses).toHaveLength(callbacks);
		await replacement.dispose();
	});

	test("unmount during a request acknowledges the detached clone and keeps post-send edits", async () => {
		const h = await registered();
		const response = deferred<readonly FieldResult[]>();
		respond(h, async () => response.promise);
		h.append("sent");
		const flush = h.coordinator.flush();
		await drain();
		h.append(" after send");
		await h.coordinator.detach(FIELD);
		h.monitor.dispose();
		response.resolve(accepted(h.transport.requests[0]!));
		await flush;
		respond(h, async (request) => accepted(request));
		await h.coordinator.flushDelivery();
		expect(h.transport.requests).toHaveLength(2);
		expect(replayEdits("sent", sentBatch(h, 1))).toBe("sent after send");
		expect((await saved(h)).text).toBe("sent after send");
		expect(restoreRecord(await saved(h)).collect()).toBeNull();
		await h.coordinator.dispose();
	});
});
