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
	REF,
	restoreRecord,
	rig,
} from "./helpers/answer-edit-coordinator";

type Request = Parameters<AttemptTransport["send"]>[0];

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

test("a remounted editor can durably edit and deliver after an overlapping accepted ACK commit", async () => {
	const h = rig();
	const send = deferred<readonly FieldResult[]>();
	const inspection = deferred<ServerFieldState>();
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
	h.transport.inspectionGate = inspection;
	const inspections = h.transport.inspections.length;
	const recovery = h.coordinator.recover(FIELD);
	await drain();
	expect(h.transport.inspections).toHaveLength(inspections + 1);

	const commits = h.store.commits.length;
	const ackCommit = h.store.holdNextCommit();
	send.resolve(results);
	await drain();
	expect(h.store.commits).toHaveLength(commits + 1);
	inspection.resolve({
		text: "A",
		revision: result.receipt.revision,
		nextSeq: result.receipt.lastSeq + 1,
		canWrite: true,
		receipts: [result.receipt],
	});
	await drain();
	// Recovery may wait for the commit or return an editor before it finishes.
	ackCommit.resolve();
	const [recovered] = await Promise.all([recovery, flush]);
	expect(recovered.kind).toBe("ready");
	if (
		recovered.kind !== "ready" ||
		!(recovered.handle instanceof AnswerEditMonitor)
	)
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

test("an unreadable fallback is unavailable even when the primary has no record", async () => {
	const h = rig();
	let fallbackWrites = 0;
	h.fallback.read = () => {
		throw new Error("Fallback read denied");
	};
	h.fallback.write = () => {
		fallbackWrites++;
	};
	try {
		expect(await h.store.read(REF, EPOCH)).toBeNull();
		const result = await h.coordinator.recover(FIELD);
		expect.soft(result).toMatchObject({ kind: "unavailable" });
		expect.soft("handle" in result).toBe(false);
		expect.soft(h.coordinator.getStatus(FIELD)).toMatchObject({
			durability: "unavailable",
			savedText: null,
		});
		await h.coordinator.persist();
		await h.coordinator.flushDelivery();
		expect.soft(h.store.commits).toHaveLength(0);
		expect.soft(fallbackWrites).toBe(0);
		expect.soft(h.transport.requests).toHaveLength(0);
	} finally {
		await h.coordinator.dispose();
	}
});
