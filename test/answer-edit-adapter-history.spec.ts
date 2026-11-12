import { expect, test } from "@playwright/test";
import {
	AnswerEditAdapter,
	type CoordinatorPort,
} from "@/services/answer-edits/adapter";
import type { FieldResult } from "@/services/answer-edits/coordinator";
import { AnswerEditMonitor } from "@/services/answer-edits/monitor";
import {
	deferred,
	drain,
	EPOCH,
	FIELD,
	ManualScheduler,
	rig,
} from "./helpers/answer-edit-coordinator";

// R24, R26 and R28 (spec `historico-de-edicao-no-servidor`) as seen through
// the adapter.
//
// Assumed signatures, the spec names the methods only:
//
//   coordinator.reportGap(field, reason): void       // R24
//   coordinator.discard(): Promise<void>             // R28
//   adapter.discard(): Promise<void>                 // R28, never rejects, 2 s ceiling
//
// The adapter reaches the coordinator through `CoordinatorPort`, which gains
// `reportGap` and `discard`. The doubles below carry them as extra members.

const CEILING_MS = 1500;
const DISCARD_CEILING_MS = 2000;

interface Calls {
	gaps: { field: unknown; reason: string }[];
	discards: number;
	log: string[];
}

/// A coordinator double that records what the adapter reports and erases.
function double(overrides: Record<string, unknown> = {}) {
	const calls: Calls = { gaps: [], discards: 0, log: [] };
	const coordinator = {
		register: async (_field: unknown, handle: unknown) => ({ handle }),
		detach: async () => {},
		persist: async () => {},
		flush: async () => {},
		dispose: async () => {
			calls.log.push("dispose");
		},
		reportGap: (field: unknown, reason: string) => {
			calls.gaps.push({ field, reason });
			calls.log.push("reportGap");
		},
		discard: async () => {
			calls.discards++;
		},
		...overrides,
	} as unknown as CoordinatorPort;
	return { coordinator, calls };
}

function build(
	coordinator: CoordinatorPort,
	options: { monitorFails?: boolean; createFails?: boolean } = {},
) {
	const scheduler = new ManualScheduler();
	let clock = 0;
	const adapter = new AnswerEditAdapter({
		coordinator,
		scheduler,
		now: () => ++clock,
		flushCeilingMs: CEILING_MS,
		createMonitor: ({ initialText, sessionId }) => {
			if (options.createFails) throw new Error("cannot create");
			const monitor = new AnswerEditMonitor({
				initialText,
				sessionId,
				baseRevision: 0,
				firstSeq: 1,
				now: () => clock,
			});
			if (options.monitorFails)
				monitor.recordChange = () => {
					throw new Error("boom");
				};
			return monitor;
		},
	});
	return { adapter, scheduler };
}

async function ready(scheduler: ManualScheduler) {
	await scheduler.advance(0);
	await drain();
}

test.describe("every way a field stops being recorded reports a gap", () => {
	test("an exception while recording an edit", async () => {
		const { coordinator, calls } = double();
		const { adapter, scheduler } = build(coordinator, { monitorFails: true });
		adapter.attach(FIELD, "");
		await ready(scheduler);

		adapter.input(FIELD, "a");
		await scheduler.advance(0);

		expect(calls.gaps).toEqual([{ field: FIELD, reason: "boom" }]);
	});

	test("an exception while creating the monitor", async () => {
		const { coordinator, calls } = double();
		const { adapter, scheduler } = build(coordinator, { createFails: true });

		adapter.attach(FIELD, "");
		await ready(scheduler);

		expect(calls.gaps).toEqual([{ field: FIELD, reason: "cannot create" }]);
	});

	test("a registration the coordinator rejects", async () => {
		const { coordinator, calls } = double({
			register: async () => {
				throw new Error("denied");
			},
		});
		const { adapter, scheduler } = build(coordinator);

		adapter.attach(FIELD, "");
		await ready(scheduler);

		expect(calls.gaps).toEqual([{ field: FIELD, reason: "denied" }]);
	});

	test("the kill switch reports one gap per field still recorded, with its reason", async () => {
		const { coordinator, calls } = double();
		const { adapter, scheduler } = build(coordinator);
		adapter.attach(FIELD, "");
		adapter.attach({ questionId: "second", field: "answer" }, "");
		await ready(scheduler);

		adapter.disable("exam switch off");

		expect(calls.gaps).toHaveLength(2);
		expect(calls.gaps.map((gap) => gap.reason)).toEqual([
			"exam switch off",
			"exam switch off",
		]);
		expect(calls.gaps.map((gap) => gap.field)).toEqual([
			FIELD,
			{ questionId: "second", field: "answer" },
		]);
	});

	test("a field already stopped is not reported again by the kill switch", async () => {
		const { coordinator, calls } = double();
		const { adapter, scheduler } = build(coordinator, { monitorFails: true });
		adapter.attach(FIELD, "");
		await ready(scheduler);
		adapter.input(FIELD, "a");
		await scheduler.advance(0);

		adapter.disable("exam switch off");

		expect(calls.gaps).toEqual([{ field: FIELD, reason: "boom" }]);
	});

	test("a coordinator whose reportGap throws never makes an adapter call throw", async () => {
		const { coordinator } = double({
			reportGap: () => {
				throw new Error("report failed");
			},
		});
		const { adapter, scheduler } = build(coordinator, { monitorFails: true });
		adapter.attach(FIELD, "");
		await ready(scheduler);

		expect(() => adapter.input(FIELD, "a")).not.toThrow();
		await scheduler.advance(0);
		expect(() => adapter.input(FIELD, "ab")).not.toThrow();
		expect(() => adapter.disable("exam switch off")).not.toThrow();
		await expect(adapter.flushFinal()).resolves.toBeUndefined();
		expect(adapter.isActive(FIELD)).toBe(false);
	});
});

test.describe("discard", () => {
	test("asks the coordinator to erase the attempt's records, once", async () => {
		const { coordinator, calls } = double();
		const { adapter } = build(coordinator);

		await adapter.discard();

		expect(calls.discards).toBe(1);
	});

	test("never rejects, whether the coordinator throws or rejects", async () => {
		for (const failing of [
			async () => {
				throw new Error("rejected");
			},
			() => {
				throw new Error("thrown");
			},
		]) {
			const { coordinator } = double({ discard: failing });
			const { adapter } = build(coordinator);

			await expect(adapter.discard()).resolves.toBeUndefined();
		}
	});

	test("resolves at the two second ceiling when the erasure never settles", async () => {
		const { coordinator } = double({ discard: () => new Promise(() => {}) });
		const { adapter, scheduler } = build(coordinator);
		let settled = false;
		void adapter.discard().then(() => {
			settled = true;
		});

		await scheduler.advance(DISCARD_CEILING_MS - 1);
		await drain();
		expect(settled).toBe(false);
		await scheduler.advance(1);

		expect(settled).toBe(true);
	});

	test("an adapter killed before still resolves", async () => {
		const { coordinator } = double();
		const { adapter } = build(coordinator);
		adapter.disable("exam switch off");

		await expect(adapter.discard()).resolves.toBeUndefined();
	});
});

//
// R26: the final flush waits, inside its ceiling, for the reconciliations in progress.
//

/// A real coordinator over the adapter, with a transport that accepts what it is sent.
async function withRealCoordinator() {
	const scheduler = new ManualScheduler();
	const h = rig({ scheduler, now: () => EPOCH + scheduler.elapsedMs });
	h.transport.send = async (request) => {
		h.transport.requests.push(structuredClone(request));
		return request.fields.map(
			({ questionId, field, batch }): FieldResult => ({
				questionId,
				field,
				kind: "accepted",
				receipt: {
					batchId: batch.batchId,
					revision: batch.baseRevision + 1,
					lastSeq: batch.firstSeq + batch.edits.length - 1,
				},
			}),
		);
	};
	let clock = 100;
	const adapter = new AnswerEditAdapter({
		coordinator: h.coordinator,
		scheduler,
		now: () => ++clock,
		flushCeilingMs: CEILING_MS,
		createSessionId: () => "adapter-session",
	});
	return { h, adapter, scheduler };
}

/// Types into the adapter's field and lets the monitor see it.
async function typeInto(
	adapter: AnswerEditAdapter,
	scheduler: ManualScheduler,
	text: string,
) {
	adapter.attach(FIELD, "");
	await ready(scheduler);
	adapter.input(FIELD, text);
	await scheduler.advance(0);
}

/// Runs what is due and lets the promise chains behind it finish.
async function settle(scheduler: ManualScheduler) {
	await scheduler.advance(0);
	for (let turn = 0; turn < 3; turn++) await drain();
}

function track(promise: Promise<void>) {
	const state = { settled: false };
	void promise.then(() => {
		state.settled = true;
	});
	return state;
}

test.describe("flushFinal and reconciliation", () => {
	test("waits for a reconciliation in progress and then sends the text", async () => {
		const { h, adapter, scheduler } = await withRealCoordinator();
		const gate = deferred<(typeof h.transport)["server"]>();
		h.transport.inspectionGate = gate;
		await typeInto(adapter, scheduler, "typed words");

		const flushing = track(adapter.flushFinal());
		await drain();
		expect(h.transport.requests).toHaveLength(0);
		expect(flushing.settled).toBe(false);

		gate.resolve(h.transport.server);
		await settle(scheduler);

		expect(h.transport.requests).toHaveLength(1);
		const [item] = h.transport.requests[0]?.fields ?? [];
		expect(item?.batch.snapshot).toBe("typed words");
		expect(flushing.settled).toBe(true);
	});

	test("is released by its ceiling when the reconciliation never ends, with nothing sent", async () => {
		const { h, adapter, scheduler } = await withRealCoordinator();
		h.transport.inspectionGate = deferred();
		await typeInto(adapter, scheduler, "typed words");

		const flushing = track(adapter.flushFinal());
		await scheduler.advance(CEILING_MS - 1);
		expect(flushing.settled).toBe(false);
		await scheduler.advance(1);

		expect(flushing.settled).toBe(true);
		expect(h.transport.requests).toHaveLength(0);
	});

	test("does not throw when the reconciliation itself fails", async () => {
		const { h, adapter, scheduler } = await withRealCoordinator();
		const gate = deferred<(typeof h.transport)["server"]>();
		h.transport.inspectionGate = gate;
		await typeInto(adapter, scheduler, "typed words");
		const flushing = track(adapter.flushFinal());
		await drain();

		gate.reject(new Error("offline"));
		await scheduler.advance(CEILING_MS);

		expect(flushing.settled).toBe(true);
		expect(h.transport.requests).toHaveLength(0);
	});

	test("ends as soon as a reconciliation says the field is closed, without sending", async () => {
		const { h, adapter, scheduler } = await withRealCoordinator();
		const gate = deferred<(typeof h.transport)["server"]>();
		h.transport.inspectionGate = gate;
		await typeInto(adapter, scheduler, "typed words");
		const flushing = track(adapter.flushFinal());
		await drain();

		gate.resolve({ ...h.transport.server, canWrite: false });
		await settle(scheduler);

		expect(flushing.settled).toBe(true);
		expect(h.transport.requests).toHaveLength(0);
	});
});
