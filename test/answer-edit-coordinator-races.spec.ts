import { expect, test } from "@playwright/test";
import { replayEdits } from "@/services/answer-edits/codec";
import {
	AnswerEditCoordinator,
	type AttemptTransport,
	type FieldResult,
} from "@/services/answer-edits/coordinator";
import { AnswerEditMonitor } from "@/services/answer-edits/monitor";
import {
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

test.describe("answer edit coordinator races: divergent fallback ownership", () => {
	test("a successful writer preserves another coordinator's divergent fallback and requires explicit recovery", async () => {
		let now = EPOCH;
		const h = rig({ now: () => now });
		const other = new AnswerEditCoordinator({
			...h.options,
			createSessionId: () => "other-restored-session",
		});
		const otherEditor = editor("other-editor-session");
		await h.coordinator.register(FIELD, h.monitor);
		await other.register(FIELD, otherEditor);

		h.append("A");
		await h.coordinator.persist();
		now++;
		append(otherEditor, "B-unique");
		await other.persist();
		expect(other.getStatus(FIELD)).toMatchObject({
			durability: "text-only",
			savedText: "B-unique",
			historyGap: true,
		});
		const fallback = h.fallback.read(REF, now);
		expect(fallback).toMatchObject({ text: "B-unique", historyGap: true });

		// A later timestamp does not establish ownership of another tab's draft.
		now++;
		h.append("2");
		await h.coordinator.persist();
		expect(h.coordinator.getStatus(FIELD)?.durability).toBe("durable");
		expect((await h.store.read(REF, now))?.text).toBe("A2");
		expect(h.fallback.read(REF, now)).toEqual(fallback);

		const reopened = new AnswerEditCoordinator({
			...h.options,
			createSessionId: () => "reopened-session",
		});
		const server = structuredClone(h.transport.server);
		const recovery = await reopened.recover(FIELD);
		expect(["conflict", "text-only"]).toContain(recovery.kind);
		expect("handle" in recovery).toBe(false);
		await reopened.persist();
		await reopened.flushDelivery();
		expect(h.transport.requests).toHaveLength(0);
		expect(h.transport.server).toEqual(server);
		expect((await h.store.read(REF, now))?.text).toBe("A2");
		expect(h.fallback.read(REF, now)).toEqual(fallback);
		await reopened.dispose();
		await other.dispose();
		await h.coordinator.dispose();
	});
});

test.describe("answer edit coordinator races: detach handoff", () => {
	test("recovery waits for a held detach commit and its new editor can persist and deliver", async () => {
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
		const recovery = h.coordinator.recover(FIELD).then((result) => {
			recovered = true;
			return result;
		});
		await drain();
		const finishedBeforeCommit = recovered;
		// Release before awaiting recovery so the handoff can finish.
		gate.resolve();
		const [, result] = await Promise.all([detach, recovery]);
		expect(finishedBeforeCommit).toBe(false);
		h.monitor.dispose();
		expect(result.kind).toBe("ready");
		if (
			result.kind !== "ready" ||
			!(result.handle instanceof AnswerEditMonitor)
		)
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
	for (const failure of ["retry", "missing", "invalid receipt"] as const) {
		for (const random of [0, 0.5, 0.999999]) {
			test(`${failure} uses jittered backoff despite another field succeeding, random ${random}`, async () => {
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
	}
});
