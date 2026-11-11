import { expect, test } from "@playwright/test";
import {
	AnswerEditAdapter,
	type CoordinatorPort,
} from "@/services/answer-edits/adapter";
import { AnswerEditMonitor } from "@/services/answer-edits/monitor";
import {
	deferred,
	drain,
	ManualScheduler,
} from "./helpers/answer-edit-coordinator";

const FIELD = { questionId: "q", field: "answer" };

function setup(
	overrides: Partial<CoordinatorPort> = {},
	options: { monitorFails?: boolean; ceilingMs?: number } = {},
) {
	const scheduler = new ManualScheduler();
	const calls: string[] = [];
	const monitors: AnswerEditMonitor[] = [];
	const coordinator: CoordinatorPort = {
		register: async (_field, handle) => {
			calls.push("register");
			return { handle } as never;
		},
		detach: async () => {
			calls.push("detach");
		},
		persist: async () => {
			calls.push("persist");
		},
		flush: async () => {
			calls.push("flush");
		},
		dispose: async () => {
			calls.push("dispose");
		},
		...overrides,
	};
	let clock = 0;
	const adapter = new AnswerEditAdapter({
		coordinator,
		scheduler,
		now: () => ++clock,
		flushCeilingMs: options.ceilingMs ?? 2000,
		createMonitor: ({ initialText, sessionId }) => {
			const monitor = new AnswerEditMonitor({
				initialText,
				sessionId,
				baseRevision: 0,
				firstSeq: 1,
				now: () => clock,
			});
			monitors.push(monitor);
			if (options.monitorFails)
				monitor.recordChange = () => {
					calls.push("recordChange");
					throw new Error("boom");
				};
			return monitor;
		},
	});
	return { adapter, scheduler, calls, monitors };
}

/// Let the deferred open and its promise continuations run.
async function ready(scheduler: ManualScheduler) {
	await scheduler.advance(0);
	await drain();
}

test("input only stores the text: the monitor works after the deferral", async () => {
	const { adapter, scheduler, monitors } = setup();
	adapter.attach(FIELD, "");
	await ready(scheduler);
	adapter.input(FIELD, "a");
	adapter.input(FIELD, "ab");
	expect(monitors[0]?.getState().text).toBe("");
	await scheduler.advance(0);
	expect(monitors[0]?.getState().text).toBe("ab");
	expect(monitors[0]?.collect()?.edits).toHaveLength(1);
});

test("edits before the monitor is ready arrive as one edit from the current text", async () => {
	const gate = deferred<never>();
	const { adapter, scheduler, monitors } = setup({
		register: () => gate.promise,
	});
	adapter.attach(FIELD, "x");
	await scheduler.advance(0);
	adapter.input(FIELD, "xy");
	adapter.input(FIELD, "xyz");
	await scheduler.advance(0);
	expect(monitors[0]?.getState().text).toBe("x");
	gate.resolve({ handle: monitors[0] } as never);
	await ready(scheduler);
	await scheduler.advance(0);
	expect(monitors[0]?.getState().text).toBe("xyz");
});

test("the first failure disables the field and no later call reaches the monitor", async () => {
	const { adapter, scheduler, calls } = setup({}, { monitorFails: true });
	adapter.attach(FIELD, "");
	await ready(scheduler);
	adapter.input(FIELD, "a");
	await scheduler.advance(0);
	expect(adapter.isActive(FIELD)).toBe(false);
	expect(adapter.gaps()).toEqual([{ field: FIELD, reason: "boom" }]);
	adapter.input(FIELD, "ab");
	adapter.input(FIELD, "abc");
	await scheduler.advance(10);
	expect(calls.filter((call) => call === "recordChange")).toHaveLength(1);
	expect(calls).toContain("detach");
});

test("rejected and synchronously thrown opens are swallowed and disable the field", async () => {
	for (const register of [
		() => Promise.reject(new Error("no")),
		() => {
			throw new Error("sync");
		},
	]) {
		const { adapter, scheduler } = setup({ register: register as never });
		adapter.attach(FIELD, "");
		await ready(scheduler);
		expect(adapter.isActive(FIELD)).toBe(false);
		adapter.input(FIELD, "a");
		await scheduler.advance(0);
	}
});

test("a field attached twice is ignored the second time", async () => {
	const { adapter, scheduler, calls } = setup();
	adapter.attach(FIELD, "");
	adapter.attach(FIELD, "");
	await ready(scheduler);
	expect(calls.filter((call) => call === "register")).toHaveLength(1);
	expect(adapter.isActive(FIELD)).toBe(true);
});

test("flushFinal resolves at the ceiling when persistence and delivery hang", async () => {
	const never = () => new Promise<void>(() => {});
	const { adapter, scheduler } = setup(
		{ persist: never, flush: never },
		{ ceilingMs: 2000 },
	);
	adapter.attach(FIELD, "");
	await ready(scheduler);
	let resolved = false;
	void adapter.flushFinal().then(() => {
		resolved = true;
	});
	await scheduler.advance(1999);
	expect(resolved).toBe(false);
	await scheduler.advance(1);
	expect(resolved).toBe(true);
});

test("flushFinal resolves early when the work completes, and never rejects", async () => {
	const { adapter, scheduler, calls } = setup({
		flush: () => Promise.reject(new Error("transport")),
	});
	adapter.attach(FIELD, "");
	await ready(scheduler);
	await adapter.flushFinal();
	expect(calls).toContain("persist");
	expect(adapter.gaps().map((gap) => gap.reason)).toContain("transport");
});

test("flushFinal sends the text typed since the last deferral", async () => {
	const { adapter, scheduler, monitors } = setup();
	adapter.attach(FIELD, "");
	await ready(scheduler);
	adapter.input(FIELD, "last words");
	await adapter.flushFinal();
	expect(monitors[0]?.getState().text).toBe("last words");
});

test("notifying before the answer is saved, or about unknown fields, is harmless", async () => {
	const { adapter, scheduler } = setup();
	adapter.input(FIELD, "early");
	adapter.detach(FIELD);
	adapter.attach(FIELD, "early");
	adapter.input({ questionId: "other", field: "answer" }, "x");
	adapter.input(FIELD, 3 as never);
	await ready(scheduler);
	expect(adapter.isActive(FIELD)).toBe(false);
	expect(adapter.gaps()).toHaveLength(1);
});

test("the kill switch disables everything and later calls do nothing", async () => {
	const { adapter, scheduler, calls } = setup();
	adapter.attach(FIELD, "");
	await ready(scheduler);
	adapter.disable();
	expect(adapter.isActive()).toBe(false);
	const before = calls.length;
	adapter.attach({ questionId: "b", field: "answer" }, "");
	adapter.input(FIELD, "a");
	await scheduler.advance(0);
	await adapter.flushFinal();
	adapter.detach(FIELD);
	await drain();
	expect(calls.slice(before)).toEqual([]);
});

test("an adapter created disabled never touches the coordinator", async () => {
	const { adapter, scheduler, calls } = setup();
	const inert = new AnswerEditAdapter({
		coordinator: {
			register: async () => {
				calls.push("register");
				return {} as never;
			},
		} as never,
		now: () => 0,
		scheduler,
		enabled: false,
	});
	inert.attach(FIELD, "");
	inert.input(FIELD, "a");
	await inert.flushFinal();
	await scheduler.advance(0);
	expect(calls).toEqual([]);
	expect(adapter.isActive()).toBe(true);
});

test("the diff does not split surrogate pairs", async () => {
	const { adapter, scheduler, monitors } = setup();
	adapter.attach(FIELD, "a\u{1F642}b");
	await ready(scheduler);
	adapter.input(FIELD, "a\u{1F643}b");
	await scheduler.advance(0);
	expect(adapter.isActive(FIELD)).toBe(true);
	expect(monitors[0]?.getState().text).toBe("a\u{1F643}b");
});
