import { expect, test } from "@playwright/test";
import {
	canRun,
	type IdeEvent,
	type IdePhase,
	type IdeState,
	initialIdeState,
	isBusy,
	reduceIde,
} from "@/components/runner/ide-state";
import type { RunExit } from "@/runner/host";

const idle = initialIdeState({
	runnerOrigin: "http://127.0.0.1:1",
	runDisabled: false,
});

function run(events: IdeEvent[], from: IdeState = idle): IdeState {
	return events.reduce(reduceIde, from);
}

const exit = (
	reason: RunExit["reason"],
	code: number | null = null,
): IdeEvent => ({ type: "exit", exit: { reason, code }, elapsedMs: 120 });

const running: IdeEvent[] = [
	{ type: "run-requested" },
	{ type: "status", state: "running" },
];

test.describe("initial state", () => {
	test("idle with a runner", () => {
		expect(idle).toEqual({ phase: "idle", progress: null, lastExit: null });
	});

	test("unconfigured without a runner origin", () => {
		const state = initialIdeState({ runnerOrigin: null, runDisabled: false });
		expect(state.phase).toBe("unconfigured");
	});

	test("disabled when the exam turned running off", () => {
		const state = initialIdeState({
			runnerOrigin: "http://127.0.0.1:1",
			runDisabled: true,
		});
		expect(state.phase).toBe("disabled");
	});

	test("unconfigured wins over disabled", () => {
		const state = initialIdeState({ runnerOrigin: null, runDisabled: true });
		expect(state.phase).toBe("unconfigured");
	});
});

test.describe("phases, event by event", () => {
	test("run-requested moves to preparing", () => {
		expect(run([{ type: "run-requested" }]).phase).toBe("preparing");
	});

	test("loading status keeps preparing", () => {
		const state = run([
			{ type: "run-requested" },
			{ type: "status", state: "loading" },
		]);
		expect(state.phase).toBe("preparing");
	});

	test("progress is kept while preparing and cleared at running", () => {
		const preparing = run([
			{ type: "run-requested" },
			{ type: "progress", loaded: 10, total: 100 },
		]);
		expect(preparing.progress).toEqual({ loaded: 10, total: 100 });
		const unknown = run(
			[{ type: "progress", loaded: 20, total: null }],
			preparing,
		);
		expect(unknown.progress).toEqual({ loaded: 20, total: null });
		expect(run([{ type: "status", state: "running" }], unknown).progress).toBe(
			null,
		);
	});

	test("running and waiting-input follow status", () => {
		expect(run(running).phase).toBe("running");
		const waiting = run([
			...running,
			{ type: "status", state: "waiting-input" },
		]);
		expect(waiting.phase).toBe("waiting-input");
		expect(run([{ type: "status", state: "running" }], waiting).phase).toBe(
			"running",
		);
	});

	const exits: [string, IdeEvent, IdePhase][] = [
		["exited 0", exit("exited", 0), "done"],
		["exited 1", exit("exited", 1), "error"],
		["crashed", exit("crashed"), "error"],
		["stopped", exit("stopped"), "stopped"],
		["output-limit", exit("output-limit"), "truncated"],
		["load-failed", exit("load-failed"), "load-failed"],
		["stale-bundle", exit("stale-bundle"), "load-failed"],
		["reloaded", exit("reloaded"), "stopped"],
	];
	for (const [name, event, phase] of exits) {
		test(`exit ${name} leads to ${phase}`, () => {
			const state = run([...running, event]);
			expect(state.phase).toBe(phase);
			expect(state.lastExit).toMatchObject({ elapsedMs: 120 });
		});
	}

	test("exit while preparing is accepted", () => {
		const state = run([{ type: "run-requested" }, exit("load-failed")]);
		expect(state.phase).toBe("load-failed");
	});

	test("lastExit keeps the code and message", () => {
		const state = run([
			...running,
			{
				type: "exit",
				exit: { reason: "exited", code: 3, message: "boom" },
				elapsedMs: 5,
			},
		]);
		expect(state.lastExit).toEqual({
			reason: "exited",
			code: 3,
			message: "boom",
			elapsedMs: 5,
		});
		expect(state.progress).toBeNull();
	});

	test("unavailable maps unsupported and protocol to unsupported", () => {
		for (const reason of ["unsupported", "protocol"] as const) {
			const state = run([
				{ type: "run-requested" },
				{ type: "unavailable", reason },
			]);
			expect(state.phase).toBe("unsupported");
		}
	});

	test("unavailable timeout maps to load-failed", () => {
		const state = run([
			{ type: "run-requested" },
			{ type: "unavailable", reason: "timeout" },
		]);
		expect(state.phase).toBe("load-failed");
	});

	test("try again after load-failed starts preparing", () => {
		const failed = run([{ type: "run-requested" }, exit("load-failed")]);
		const state = run([{ type: "run-requested" }], failed);
		expect(state.phase).toBe("preparing");
		expect(state.lastExit).toMatchObject({ reason: "load-failed" });
	});

	test("Run again after a finished run", () => {
		for (const event of [
			exit("exited", 0),
			exit("exited", 2),
			exit("stopped"),
			exit("output-limit"),
		]) {
			const state = run([...running, event, { type: "run-requested" }]);
			expect(state.phase).toBe("preparing");
		}
	});
});

test.describe("events out of turn change nothing", () => {
	const finished = run([...running, exit("exited", 0)]);

	test("status and progress after exit", () => {
		expect(reduceIde(finished, { type: "status", state: "running" })).toBe(
			finished,
		);
		expect(reduceIde(finished, { type: "progress", loaded: 1, total: 2 })).toBe(
			finished,
		);
	});

	test("a second exit", () => {
		expect(reduceIde(finished, exit("crashed"))).toBe(finished);
	});

	test("events before the first run", () => {
		expect(reduceIde(idle, { type: "status", state: "running" })).toBe(idle);
		expect(reduceIde(idle, exit("exited", 0))).toBe(idle);
		expect(reduceIde(idle, { type: "progress", loaded: 1, total: null })).toBe(
			idle,
		);
	});

	test("run-requested while busy", () => {
		for (const events of [
			[{ type: "run-requested" } as IdeEvent],
			running,
			[...running, { type: "status", state: "waiting-input" } as IdeEvent],
		]) {
			const state = run(events);
			expect(reduceIde(state, { type: "run-requested" })).toBe(state);
		}
	});

	test("progress while running", () => {
		const state = run(running);
		expect(reduceIde(state, { type: "progress", loaded: 1, total: 2 })).toBe(
			state,
		);
	});

	test("loading status while running", () => {
		const state = run(running);
		expect(reduceIde(state, { type: "status", state: "loading" })).toBe(state);
	});

	test("unavailable while running or after exit", () => {
		const state = run(running);
		expect(reduceIde(state, { type: "unavailable", reason: "timeout" })).toBe(
			state,
		);
		expect(
			reduceIde(finished, { type: "unavailable", reason: "unsupported" }),
		).toBe(finished);
	});

	const events: IdeEvent[] = [
		{ type: "run-requested" },
		{ type: "status", state: "running" },
		{ type: "progress", loaded: 1, total: 2 },
		exit("exited", 0),
		{ type: "unavailable", reason: "timeout" },
	];
	for (const phase of ["disabled", "unsupported", "unconfigured"] as const) {
		test(`nothing leaves ${phase}`, () => {
			const state: IdeState = { phase, progress: null, lastExit: null };
			for (const event of events) {
				expect(reduceIde(state, event)).toBe(state);
			}
		});
	}
});

test.describe("canRun and isBusy", () => {
	const table: [IdePhase, boolean, boolean][] = [
		["idle", true, false],
		["preparing", false, true],
		["running", false, true],
		["waiting-input", false, true],
		["done", true, false],
		["error", true, false],
		["stopped", true, false],
		["truncated", true, false],
		["load-failed", true, false],
		["disabled", false, false],
		["unsupported", false, false],
		["unconfigured", false, false],
	];
	for (const [phase, runnable, busy] of table) {
		test(phase, () => {
			const state: IdeState = { phase, progress: null, lastExit: null };
			expect(canRun(state)).toBe(runnable);
			expect(isBusy(state)).toBe(busy);
		});
	}
});
