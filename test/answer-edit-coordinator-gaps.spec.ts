import { expect, test } from "@playwright/test";
import type {
	AttemptTransport,
	FieldResult,
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
	rig,
} from "./helpers/answer-edit-coordinator";

// R24 (spec `historico-de-edicao-no-servidor`): gap markers.
//
// Assumed signature, the spec gives the name and the arguments only:
//
//   coordinator.reportGap(field: AttemptField, reason: string): void
//
// and, in the request the coordinator hands to `transport.send`, each item
// carries `gaps?: { reason: string }[]` next to an optional `batch`. A field
// with a marker and no edits is an item with `gaps` only. The tests read the
// requests through `Sent`, so they do not depend on how the item is typed.

interface Sent {
	questionId: string;
	field: string;
	batch?: PendingEditBatch;
	gaps?: { reason: string; id: string }[];
}

type Rig = ReturnType<typeof rig>;

/// The coordinator's `reportGap`, as assumed above.
function report(h: Rig, field: typeof FIELD, reason: string): void {
	(
		h.coordinator as unknown as {
			reportGap(field: typeof FIELD, reason: string): void;
		}
	).reportGap(field, reason);
}

const SECOND_FIELD = { questionId: "second", field: "answer" };

/// Items of every request sent so far, flattened in order.
function items(h: Rig): Sent[] {
	return h.transport.requests.flatMap(
		(request) => request.fields as unknown as Sent[],
	);
}

/// Answers every item of every request as accepted; a gap-only item has no receipt.
function acceptAll(h: Rig) {
	h.transport.send = async (request) => {
		h.transport.requests.push(structuredClone(request));
		return (request.fields as unknown as Sent[]).map(
			({ questionId, field, batch }): FieldResult =>
				batch
					? {
							questionId,
							field,
							kind: "accepted",
							receipt: {
								batchId: batch.batchId,
								revision: batch.baseRevision + 1,
								lastSeq: batch.firstSeq + batch.edits.length - 1,
							},
						}
					: ({ questionId, field, kind: "accepted" } as FieldResult),
		);
	};
}

async function registered() {
	const scheduler = new ManualScheduler();
	const h = rig({ scheduler, now: () => EPOCH + scheduler.elapsedMs });
	await h.coordinator.register(FIELD, h.monitor);
	/// Let the baseline reconcile, which deliveries wait for.
	await drain();
	return h;
}

/// The longest wait before the next scheduled delivery (R26: 55 to 65 s).
const CADENCE_MS = 65_000;

test.describe("a reported gap travels with the next delivery", () => {
	test("a field with a marker and no edits is sent as an item with gaps only", async () => {
		const h = await registered();
		acceptAll(h);

		report(h, FIELD, "storage lost");
		await h.scheduler.advance(CADENCE_MS);

		expect(items(h)).toEqual([
			{ ...FIELD, gaps: [{ reason: "storage lost", id: expect.any(String) }] },
		]);
	});

	test("with pending edits the marker rides in the item of the batch", async () => {
		const h = await registered();
		acceptAll(h);
		h.append("typed");

		report(h, FIELD, "storage lost");
		await h.coordinator.flush();

		expect(items(h)).toHaveLength(1);
		expect(items(h)[0]?.batch?.snapshot).toBe("typed");
		expect(items(h)[0]?.gaps).toEqual([
			{ reason: "storage lost", id: expect.any(String) },
		]);
	});

	test("markers keep the order they were reported in", async () => {
		const h = await registered();
		acceptAll(h);

		report(h, FIELD, "first");
		report(h, FIELD, "second");
		await h.coordinator.flush();

		expect(items(h)[0]?.gaps).toEqual([
			{ reason: "first", id: expect.any(String) },
			{ reason: "second", id: expect.any(String) },
		]);
		const ids = items(h)[0]?.gaps?.map((gap) => gap.id);
		expect(new Set(ids).size).toBe(2);
	});

	test("an accepted item clears its markers: they are never sent twice", async () => {
		const h = await registered();
		acceptAll(h);
		report(h, FIELD, "storage lost");
		await h.coordinator.flush();

		await h.coordinator.flush();
		await h.scheduler.advance(2 * CADENCE_MS);

		expect(h.transport.requests).toHaveLength(1);
	});

	test("a marker reported while its field is in flight is not cleared by that answer", async () => {
		const h = await registered();
		h.append("typed");
		const gate = deferred<readonly FieldResult[]>();
		h.transport.sendGate = gate;
		report(h, FIELD, "before");
		const delivering = h.coordinator.flush();
		await drain();
		expect(h.transport.requests).toHaveLength(1);

		report(h, FIELD, "during");
		h.transport.sendGate = null;
		acceptAll(h);
		const [first] = items(h);
		gate.resolve([
			{
				...FIELD,
				kind: "accepted",
				receipt: {
					batchId: first?.batch?.batchId ?? "",
					revision: 1,
					lastSeq:
						(first?.batch?.firstSeq ?? 0) +
						(first?.batch?.edits.length ?? 1) -
						1,
				},
			},
		]);
		await delivering;
		await h.coordinator.flush();
		await h.scheduler.advance(CADENCE_MS);

		const sentReasons = items(h).flatMap((item) =>
			(item.gaps ?? []).map((gap) => gap.reason),
		);
		expect(sentReasons).toEqual(["before", "during"]);
	});
});

test.describe("a marker survives a delivery that did not land", () => {
	const failures: [string, AttemptTransport["send"]][] = [
		[
			"the request fails",
			async () => {
				throw new Error("offline");
			},
		],
		[
			"the server answers retry",
			async (request) =>
				request.fields.map(({ questionId, field }) => ({
					questionId,
					field,
					kind: "retry" as const,
				})),
		],
	];
	for (const [label, failing] of failures) {
		test(`when ${label}, the same markers go out again`, async () => {
			const h = await registered();
			h.transport.send = async (request) => {
				h.transport.requests.push(structuredClone(request));
				return failing(request);
			};
			report(h, FIELD, "storage lost");
			await h.coordinator.flush();
			expect(h.transport.requests).toHaveLength(1);

			acceptAll(h);
			/// The retry delay after one failure is a second, jittered by half at most.
			await h.scheduler.advance(1500);

			expect(h.transport.requests).toHaveLength(2);
			expect(items(h)[1]?.gaps).toEqual(items(h)[0]?.gaps);
			expect(items(h)[1]?.gaps).toEqual([
				{ reason: "storage lost", id: expect.any(String) },
			]);
		});
	}
});

test.describe("limits", () => {
	test("at most 50 markers per field are kept and sent", async () => {
		const h = await registered();
		acceptAll(h);

		for (let i = 0; i < 60; i++) report(h, FIELD, `gap ${i}`);
		await h.coordinator.flush();

		expect(items(h)[0]?.gaps).toHaveLength(50);
	});

	test("the limit is per field", async () => {
		const h = await registered();
		await h.coordinator.register(
			SECOND_FIELD,
			new AnswerEditMonitor({
				initialText: "",
				sessionId: "second-session",
				baseRevision: 0,
				firstSeq: 1,
				now: () => 10_000,
			}),
		);
		await drain();
		acceptAll(h);

		for (let i = 0; i < 60; i++) report(h, FIELD, `gap ${i}`);
		for (let i = 0; i < 3; i++) report(h, SECOND_FIELD, `other ${i}`);
		await h.coordinator.flush();

		const byField = new Map(
			items(h).map((item) => [item.questionId, item.gaps?.length]),
		);
		expect(byField.get(FIELD.questionId)).toBe(50);
		expect(byField.get(SECOND_FIELD.questionId)).toBe(3);
	});

	test("a reason longer than the server accepts is cut to 200 characters", async () => {
		const h = await registered();
		acceptAll(h);

		report(h, FIELD, "e".repeat(500));
		await h.coordinator.flush();

		const reason = items(h)[0]?.gaps?.[0]?.reason ?? "";
		expect(reason.length).toBeGreaterThan(0);
		expect(reason.length).toBeLessThanOrEqual(200);
	});
});

test.describe("reporting never throws", () => {
	test("for a field that was never registered", async () => {
		const h = await registered();

		expect(() => report(h, SECOND_FIELD, "unknown")).not.toThrow();
	});

	test("after dispose", async () => {
		const h = await registered();
		await h.coordinator.dispose();

		expect(() => report(h, FIELD, "late")).not.toThrow();
		await h.scheduler.advance(2 * CADENCE_MS);
		expect(h.transport.requests).toHaveLength(0);
	});

	test("after logout", async () => {
		const h = await registered();
		await h.coordinator.logout();

		expect(() => report(h, FIELD, "late")).not.toThrow();
	});
});
