import { expect, test } from "@playwright/test";
import {
	AnswerEditAdapter,
	type CoordinatorPort,
} from "@/services/answer-edits/adapter";
import { AnswerEditMonitor } from "@/services/answer-edits/monitor";
import {
	drain,
	FIELD,
	ManualScheduler,
} from "./helpers/answer-edit-coordinator";

// Typing that starts before the monitor exists must not disable the field: the
// monitor's clock starts when it is created, later than the keystroke.

test("a field typed in before its monitor was created keeps recording, not rejected as older than its origin", async () => {
	const scheduler = new ManualScheduler();
	let clock = 100;
	const coordinator = {
		register: async (_field: unknown, handle: unknown) => ({ handle }),
		detach: async () => {},
		persist: async () => {},
		flush: async () => {},
		dispose: async () => {},
		reportGap: () => {},
		discard: async () => {},
	} as unknown as CoordinatorPort;
	const adapter = new AnswerEditAdapter({
		coordinator,
		scheduler,
		now: () => clock,
		createMonitor: ({ initialText, sessionId }) =>
			new AnswerEditMonitor({
				initialText,
				sessionId,
				baseRevision: 0,
				firstSeq: 1,
				now: () => clock,
			}),
	});

	adapter.attach(FIELD, "");
	adapter.input(FIELD, "a");
	/// The monitor is created later than the keystroke.
	clock = 500;
	await scheduler.advance(0);
	await drain();
	clock = 600;
	adapter.input(FIELD, "ab");
	await scheduler.advance(0);
	await drain();

	expect(adapter.gaps()).toEqual([]);
	expect(adapter.isActive(FIELD)).toBe(true);
});
