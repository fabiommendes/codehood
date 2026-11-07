import { expect, test } from "@playwright/test";
import {
	collect,
	loadFrame,
	run,
	send,
	start,
	waitFor,
} from "../runner-harness";

/**
 * The Prolog driver with the real swipl-wasm runtime. Slow: not part of the
 * default suite; run with `pnpm exec tsx test/run.ts test/runtimes`.
 */

const FACTORIAL = [
	"factorial(0, 1).",
	"factorial(N, F) :- N > 0, M is N - 1, factorial(M, G), F is N * G.",
].join("\n");

/// Starts a Prolog run, queues `input` lines and then end of input.
async function runWithInput(
	page: Parameters<typeof loadFrame>[0],
	code: string,
	input: string[],
	eof = true,
) {
	const h = await loadFrame(page);
	const id = await start(h, code, "prolog", { mode: "repl" });
	for (const line of input) {
		await send(h, { type: "stdin", runId: id, line });
	}
	if (eof) await send(h, { type: "stdin-eof", runId: id });
	return { h, id, result: await collect(h, id, 60_000) };
}

test.describe("prolog driver", () => {
	test("consult plus a query at the toplevel", async ({ page }) => {
		const { result } = await runWithInput(page, FACTORIAL, [
			"factorial(5, F).",
			".",
		]);
		expect(result.stdout).toContain("F = 120");
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
	});

	test("a syntax error is reported as main.pl:line", async ({ page }) => {
		const { result } = await runWithInput(
			page,
			"ok(1).\nok(2).\nbroken( :- .\nok(3).\n",
			["ok(X)."],
		);
		expect(result.stderr).toMatch(/main\.pl:3:\d+/);
		expect(result.stderr).not.toContain("/work/");
		expect(result.stdout).toContain("X = 1");
	});

	test("read/1 reads from the terminal", async ({ page }) => {
		const { result } = await runWithInput(
			page,
			":- read(X), format('got ~w~n', [X]).\n",
			["hello."],
		);
		expect(result.stdout).toContain("got hello");
	});

	test("halt. ends the run with code 0", async ({ page }) => {
		const { result } = await runWithInput(page, FACTORIAL, ["halt."], false);
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
	});

	test("halt(N) gives the exit code N", async ({ page }) => {
		const { result } = await runWithInput(page, "", ["halt(3)."], false);
		expect(result.exit).toMatchObject({ reason: "exited", code: 3 });
	});

	test("end of input ends the run with code 0", async ({ page }) => {
		const { result } = await runWithInput(page, FACTORIAL, []);
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
	});

	test("stop interrupts infinite recursion and the next run works", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const id = await start(h, "spin :- spin.\n:- spin.\n", "prolog", {
			mode: "repl",
		});
		await waitFor(h, id, "status", "running");
		await page.waitForTimeout(500);
		const before = Date.now();
		await send(h, { type: "stop", runId: id });
		const result = await collect(h, id, 3000);
		expect(Date.now() - before).toBeLessThan(3000);
		expect(result.exit).toMatchObject({ reason: "stopped", code: null });

		const next = await start(h, "", "prolog", { mode: "repl" });
		await send(h, { type: "stdin", runId: next, line: "X is 6 * 7." });
		await send(h, { type: "stdin-eof", runId: next });
		expect((await collect(h, next, 60_000)).stdout).toContain("X = 42");
	});

	test("a program has no way to reach the persistent file systems", async ({
		page,
	}) => {
		// The only door from Prolog to the JavaScript side is the `:=` bridge of
		// library(wasm). Its `eval` starts from `window`, which a Worker does not
		// have, so every call fails before it can touch `indexedDB`. This test
		// pins that; whether `indexedDB` itself is blocked is settled by the
		// Python test, where the program reaches the same Emscripten `FS`.
		const { result } = await runWithInput(
			page,
			[
				":- use_module(library(wasm)).",
				":- _ := eval(\"Module.FS.mount(Module.FS.filesystems.IDBFS, {}, '/work')\"),",
				"   write(mounted).",
			].join("\n"),
			[],
		);
		expect(result.stderr).toContain("window is not defined");
		expect(result.stdout).not.toContain("mounted");
	});

	test("a run after another starts from a clean file system", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const write = await run(
			h,
			":- open('leak.txt', write, S), write(S, secret), close(S).\n:- halt.\n",
			"prolog",
			{ mode: "repl" },
		);
		expect(write.exit.reason).toBe("exited");
		const read = await run(
			h,
			":- ( exists_file('leak.txt') -> write(leaked) ; write(clean) ).\n:- halt.\n",
			"prolog",
			{ mode: "repl" },
		);
		expect(read.stdout).toContain("clean");
	});
});
