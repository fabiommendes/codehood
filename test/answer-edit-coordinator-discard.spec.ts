import { expect, test } from "@playwright/test";
import { parseCheckpoint } from "@/services/answer-edits/checkpoint";
import type { FieldResult } from "@/services/answer-edits/coordinator";
import { AnswerEditMonitor } from "@/services/answer-edits/monitor";
import {
	drain,
	EPOCH,
	FIELD,
	ManualScheduler,
	REF,
	rig,
} from "./helpers/answer-edit-coordinator";

// R28 (spec `historico-de-edicao-no-servidor`): the local copy is erased.
//
// Assumed signature, the spec names the method on the adapter and says it
// "removes the records of every field of the attempt":
//
//   coordinator.discard(): Promise<void>
//
// It removes (`store.remove`) the record of every field the coordinator knows,
// never rejects, and leaves the coordinator stopped: nothing it does later
// writes a record again, so the erasure cannot be undone by the page's own
// cleanup. The adapter's `discard()` is tested in
// `answer-edit-adapter-history.spec.ts`.

type Rig = ReturnType<typeof rig>;

const SECOND_FIELD = { questionId: "second", field: "answer" };
const SECOND_REF = { ...REF, ...SECOND_FIELD };

function discard(h: Rig): Promise<void> {
	return (h.coordinator as unknown as { discard(): Promise<void> }).discard();
}

function acceptAll(h: Rig) {
	h.transport.send = async (request) => {
		h.transport.requests.push(structuredClone(request));
		return request.fields.map(
			({ questionId, field, batch }): FieldResult => ({
				questionId,
				field,
				kind: "accepted",
				receipt: {
					batchId: batch?.batchId ?? "",
					revision: (batch?.baseRevision ?? 0) + 1,
					lastSeq: (batch?.firstSeq ?? 0) + (batch?.edits.length ?? 1) - 1,
				},
			}),
		);
	};
}

async function registered() {
	const scheduler = new ManualScheduler();
	const h = rig({ scheduler, now: () => EPOCH + scheduler.elapsedMs });
	await h.coordinator.register(FIELD, h.monitor);
	await drain();
	return h;
}

function secondMonitor() {
	return new AnswerEditMonitor({
		initialText: "",
		sessionId: "second-session",
		baseRevision: 0,
		firstSeq: 1,
		now: () => 10_000,
	});
}

test("after a receipt the local record holds only the confirmed text and the receipts", async () => {
	const h = await registered();
	acceptAll(h);
	h.append("confirmed words");

	await h.coordinator.flush();
	await h.coordinator.persist();

	const record = await h.store.read(REF, EPOCH);
	if (!record) throw new Error("Expected a local record");
	const state = parseCheckpoint(record.checkpoint);
	expect(state.confirmedText).toBe("confirmed words");
	expect(state.receipts).toHaveLength(1);
	expect(state.inFlight).toBeNull();
	expect(state.queue).toEqual([]);
	expect(state.active.edits).toEqual([]);
	expect(state.active.openEdit).toBeNull();
	expect(record.outbox).toBeNull();
});

test.describe("discard", () => {
	test("removes the record of every field of the attempt", async () => {
		const h = await registered();
		await h.coordinator.register(SECOND_FIELD, secondMonitor());
		h.append("first field text");
		await h.coordinator.persist();
		expect(await h.store.read(REF, EPOCH)).not.toBeNull();
		expect(await h.store.read(SECOND_REF, EPOCH)).not.toBeNull();

		await discard(h);

		expect(await h.store.read(REF, EPOCH)).toBeNull();
		expect(await h.store.read(SECOND_REF, EPOCH)).toBeNull();
	});

	test("leaves the records of other attempts alone", async () => {
		const h = await registered();
		h.append("text");
		await h.coordinator.persist();
		const record = await h.store.read(REF, EPOCH);
		if (!record) throw new Error("Expected a local record");
		const foreign = { ...REF, attemptId: "another-attempt" };
		await h.store.commit(foreign, structuredClone(record), null);

		await discard(h);

		expect(await h.store.read(foreign, EPOCH)).not.toBeNull();
	});

	test("nothing writes a record again: not typing, not the periodic save, not dispose", async () => {
		const h = await registered();
		h.append("text");
		await h.coordinator.persist();
		await discard(h);
		const commits = h.store.commits.length;

		h.append(" typed after");
		await h.scheduler.advance(130_000);
		await h.coordinator.persist();
		await h.coordinator.dispose();

		expect(h.store.commits).toHaveLength(commits);
		expect(await h.store.read(REF, EPOCH)).toBeNull();
	});

	test("sends nothing afterwards", async () => {
		const h = await registered();
		acceptAll(h);
		h.append("text");
		await discard(h);

		h.append(" more");
		await h.scheduler.advance(130_000);
		await h.coordinator.flush();

		expect(h.transport.requests).toHaveLength(0);
	});

	test("ignores a store that fails to remove: the TTL covers it", async () => {
		const h = await registered();
		h.append("text");
		await h.coordinator.persist();
		h.store.remove = async () => {
			throw new Error("IndexedDB unavailable");
		};

		await expect(discard(h)).resolves.toBeUndefined();
	});

	test("with no field registered it resolves and touches nothing", async () => {
		const h = rig();

		await expect(discard(h)).resolves.toBeUndefined();
		expect(h.store.commits).toHaveLength(0);
	});
});
