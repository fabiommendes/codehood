import { expect, test } from "../fixtures";
import {
	collect,
	loadFrame,
	messagesOf,
	run,
	send,
	start,
	statesOf,
	waitFor,
} from "../runner-harness";

/**
 * The Lua driver with the real wasmoon runtime. Slow: not part of the
 * default suite; run with `pnpm exec tsx test/run.ts test/runtimes`.
 */

/// Starts a Lua run, queues `input` lines and then end of input.
async function runWithInput(
	page: Parameters<typeof loadFrame>[0],
	code: string,
	input: string[],
	mode: "script" | "repl" = "script",
) {
	const h = await loadFrame(page);
	const id = await start(h, code, "lua", { mode });
	for (const line of input) {
		await send(h, { type: "stdin", runId: id, line });
	}
	await send(h, { type: "stdin-eof", runId: id });
	return { h, id, result: await collect(h, id, 60_000) };
}

test.describe("lua driver", () => {
	test("print and io.write", async ({ page }) => {
		const { result } = await runWithInput(
			page,
			"print('a', 1, nil, true)\nio.write('x', 2, '\\n')\nio.stdout:write('é\\n')\nio.stderr:write('oops\\n')\n",
			[],
		);
		expect(result.stdout).toBe("a\t1\tnil\ttrue\nx2\né\n");
		expect(result.stderr).toBe("oops\n");
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
	});

	test("io.read reads lines and numbers from the terminal", async ({
		page,
	}) => {
		const { result } = await runWithInput(
			page,
			[
				"local name = io.read('l')",
				"local a, b = io.read('n', 'n')",
				"print(name, a + b, math.type(a))",
				"print(io.read('l'))",
				"print(io.read('L'))",
				"print(io.read('l'))",
			].join("\n"),
			["Ada", "3 4.5", "line"],
		);
		expect(result.stdout).toBe("Ada\t7.5\tinteger\n\nline\n\nnil\n");
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
	});

	test("io.read('a') and io.lines() consume the input", async ({ page }) => {
		const { result } = await runWithInput(
			page,
			"for l in io.lines() do print('[' .. l .. ']') end\nprint(#io.read('a'))\n",
			["one", "two"],
		);
		expect(result.stdout).toBe("[one]\n[two]\n0\n");
	});

	test("an error names main.lua with its line", async ({ page }) => {
		const { result } = await runWithInput(
			page,
			"local x = 1\nlocal y = 2\nerror('boom')\n",
			[],
		);
		expect(result.stderr).toContain("main.lua:3: boom");
		expect(result.exit).toMatchObject({ reason: "exited", code: 1 });
	});

	test("a syntax error carries its line", async ({ page }) => {
		const { result } = await runWithInput(page, "x = 1\ny = = 2\n", []);
		expect(result.stderr).toContain("main.lua:2:");
		expect(result.exit).toMatchObject({ reason: "exited", code: 1 });
	});

	test("os.exit(2) gives the exit code 2", async ({ page }) => {
		const { result } = await runWithInput(
			page,
			"print('before')\nos.exit(2)\nprint('after')\n",
			[],
		);
		expect(result.stdout).toBe("before\n");
		expect(result.exit).toMatchObject({ reason: "exited", code: 2 });
	});

	test("require loads a sibling file", async ({ page }) => {
		const h = await loadFrame(page);
		const id = await start(h, "", "lua", {
			extra: {
				files: {
					"main.lua": "local h = require('helper')\nprint(h.value)\n",
					"helper.lua": "return { value = 'from helper' }\n",
				},
			},
		});
		expect((await collect(h, id, 60_000)).stdout).toContain("from helper");
	});

	test("repl evaluates expressions and statements and ends at end of input", async ({
		page,
	}) => {
		const { result } = await runWithInput(
			page,
			"x = 6\n",
			[
				"x * 7",
				"print('hi')",
				"y = x + 1",
				"y",
				"for i = 1, 2 do",
				"print(i)",
				"end",
			],
			"repl",
		);
		expect(result.stdout).toBe("42\nhi\n7\n1\n2\n");
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
	});

	test("stop interrupts an infinite loop and the next run works", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const id = await start(h, "while true do end\n", "lua");
		await waitFor(h, id, "status", "running", 60_000);
		await page.waitForTimeout(500);
		await send(h, { type: "stop", runId: id });
		const result = await collect(h, id, 3000);
		expect(result.exit).toMatchObject({ reason: "stopped", code: null });
		const next = await run(h, "print(6 * 7)\n", "lua");
		expect(next.stdout).toContain("42");
	});

	test("with a prepared runtime the run goes straight to running", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		await send(h, { type: "prepare", language: "lua" });
		// The reserve has no run id: give it time to load.
		await page.waitForTimeout(10_000);
		const id = await start(h, "print('hi')\n", "lua");
		const result = await collect(h, id, 60_000);
		expect(statesOf(await messagesOf(h, id))).not.toContain("loading");
		expect(result.stdout).toContain("hi");
	});
});

test.describe("lua driver, persistence is blocked", () => {
	test("the program has no door to the JavaScript globals", async ({
		page,
	}) => {
		const { result } = await runWithInput(
			page,
			"print(pcall(require, 'js'))\nprint(type(js), type(indexedDB))\n",
			[],
		);
		expect(result.stdout).toMatch(/^false\t/m);
		expect(result.stdout).toContain("nil\tnil");
	});

	test("native loading and process APIs fail, so FS.mount is out of reach", async ({
		page,
	}) => {
		// wasmoon gives Lua no handle on the Emscripten `FS` (the only way to
		// mount IDBFS), and indexedDB is undefined in the Worker anyway: the
		// Python test settles the second half. Here: no door to either.
		const { result } = await runWithInput(
			page,
			[
				"print(type(package.loadlib('x', '*')))",
				"print(pcall(io.popen, 'ls'))",
				"print(type(FS), type(Module), type(wasmoon))",
			].join("\n"),
			[],
		);
		expect(result.stdout).toContain("nil\n");
		expect(result.stdout).toMatch(/^false\t/m);
		expect(result.stdout).toContain("nil\tnil\tnil");
	});

	test("a run after another starts from a clean file system", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		await run(h, "io.open('leak.txt', 'w'):write('secret'):close()\n", "lua");
		const read = await run(
			h,
			"local f = io.open('leak.txt')\nprint(f and 'leaked' or 'clean')\n",
			"lua",
		);
		expect(read.stdout).toContain("clean");
	});
});
