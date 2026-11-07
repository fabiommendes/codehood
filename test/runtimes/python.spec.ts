import { expect, test } from "@playwright/test";
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
 * The Python driver with the real Pyodide runtime. Slow: not part of the
 * default suite; run with `pnpm exec tsx test/run.ts test/runtimes`.
 */

/// Starts a Python run, queues `input` lines and then end of input.
async function runWithInput(
	page: Parameters<typeof loadFrame>[0],
	code: string,
	input: string[],
	mode: "script" | "repl" = "script",
) {
	const h = await loadFrame(page);
	const id = await start(h, code, "python", { mode });
	for (const line of input) {
		await send(h, { type: "stdin", runId: id, line });
	}
	await send(h, { type: "stdin-eof", runId: id });
	return { h, id, result: await collect(h, id, 60_000) };
}

test.describe("python driver", () => {
	test("print and input()", async ({ page }) => {
		const { result } = await runWithInput(
			page,
			"name = input('Name? ')\nprint(f'Hello, {name}!')\n",
			["Ada"],
		);
		expect(result.stdout).toContain("Hello, Ada!");
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
	});

	test("a traceback names main.py and the exit code is 1", async ({ page }) => {
		const { result } = await runWithInput(
			page,
			"def f():\n    return 1 / 0\n\nf()\n",
			[],
		);
		expect(result.stderr).toContain('File "main.py", line 4');
		expect(result.stderr).toContain('File "main.py", line 2, in f');
		expect(result.stderr).toContain("ZeroDivisionError");
		expect(result.exit).toMatchObject({ reason: "exited", code: 1 });
	});

	test("a syntax error carries its line number", async ({ page }) => {
		const { result } = await runWithInput(page, "x = 1\ny = (\n", []);
		expect(result.stderr).toMatch(/main\.py", line \d/);
		expect(result.exit).toMatchObject({ reason: "exited", code: 1 });
	});

	test("sys.exit(3) gives the exit code 3", async ({ page }) => {
		const { result } = await runWithInput(
			page,
			"import sys\nsys.exit(3)\n",
			[],
		);
		expect(result.exit).toMatchObject({ reason: "exited", code: 3 });
	});

	test("input() at end of input raises EOFError", async ({ page }) => {
		const { result } = await runWithInput(page, "input()\n", []);
		expect(result.stderr).toContain("EOFError");
		expect(result.exit).toMatchObject({ reason: "exited", code: 1 });
	});

	test("import numpy fails without a request for a package", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const requests: string[] = [];
		page.on("request", (request) => requests.push(request.url()));
		const result = await run(h, "import numpy\n", "python");
		expect(result.stderr).toContain("ModuleNotFoundError");
		expect(result.exit).toMatchObject({ reason: "exited", code: 1 });
		const pythonRequests = requests.filter((url) => /pyodide|numpy/.test(url));
		expect(pythonRequests.length).toBeGreaterThan(0);
		for (const url of pythonRequests) {
			expect(new URL(url).pathname).toContain("/runner/");
			expect(new URL(url).pathname).toContain("/rt/pyodide@");
		}
		expect(requests.filter((url) => /numpy|\.whl/.test(url))).toEqual([]);
	});

	test("repl mode runs the program and ends at end of input", async ({
		page,
	}) => {
		const { result } = await runWithInput(
			page,
			"x = 6\n",
			["print(x * 7)", "x + 1"],
			"repl",
		);
		expect(result.stdout).toContain("42");
		expect(result.stdout).toContain("7");
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
	});

	test("the program can import a sibling file", async ({ page }) => {
		const h = await loadFrame(page);
		const id = await start(h, "", "python", {
			extra: {
				files: {
					"main.py": "import helper\nprint(helper.VALUE)\n",
					"helper.py": "VALUE = 'from helper'\n",
				},
			},
		});
		expect((await collect(h, id, 60_000)).stdout).toContain("from helper");
	});

	test("stop interrupts an infinite loop and the next run works", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const id = await start(h, "while True:\n    pass\n", "python");
		await waitFor(h, id, "status", "running", 60_000);
		await page.waitForTimeout(500);
		await send(h, { type: "stop", runId: id });
		const result = await collect(h, id, 3000);
		expect(result.exit).toMatchObject({ reason: "stopped", code: null });
		const next = await run(h, "print(6 * 7)\n", "python");
		expect(next.stdout).toContain("42");
	});

	test("with a prepared runtime the run goes straight to running", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		await send(h, { type: "prepare", language: "python" });
		// The reserve has no run id: give it time to load.
		await page.waitForTimeout(15_000);
		const id = await start(h, "print('hi')\n", "python");
		const result = await collect(h, id, 60_000);
		expect(statesOf(await messagesOf(h, id))).not.toContain("loading");
		expect(result.stdout).toContain("hi");
	});
});

/// Program that reports each blocked API. A blocked global reads as `undefined`.
const PROBE = [
	"import js",
	"for name in ('indexedDB', 'caches', 'Worker', 'SharedWorker', 'BroadcastChannel'):",
	"    print(name, getattr(js, name, None))",
	"for name in ('storage', 'serviceWorker', 'locks'):",
	"    print('navigator.' + name, getattr(js.navigator, name, None))",
].join("\n");

test.describe("python driver, persistence is blocked", () => {
	test("indexedDB, caches and navigator.storage are undefined", async ({
		page,
	}) => {
		const { result } = await runWithInput(page, PROBE, []);
		expect(result.stderr).toBe("");
		for (const name of [
			"indexedDB",
			"caches",
			"Worker",
			"SharedWorker",
			"BroadcastChannel",
			"navigator.storage",
			"navigator.serviceWorker",
			"navigator.locks",
		]) {
			expect(result.stdout).toMatch(
				new RegExp(`^${name.replace(".", "\\.")} (undefined|None)$`, "m"),
			);
		}
	});

	test("syncing an IDBFS mount fails because indexedDB is blocked", async ({
		page,
	}) => {
		const { result } = await runWithInput(
			page,
			[
				"import pyodide_js",
				"from pyodide.ffi import create_proxy",
				"FS = pyodide_js.FS",
				"FS.mkdirTree('/idb')",
				"FS.mount(FS.filesystems.IDBFS, {}, '/idb')",
				"errors = []",
				"FS.syncfs(True, create_proxy(lambda err: errors.append(err)))",
				"print('syncfs-errors:', [str(e) for e in errors])",
			].join("\n"),
			[],
		);
		// Mounting alone succeeds; the sync is what needs indexedDB.
		expect(result.stderr).toBe("");
		// `indexedDB.open` on the undefined global is how Emscripten's IDBFS fails.
		expect(result.stdout).toContain(
			"Cannot read properties of undefined (reading 'open')",
		);
	});

	test("a run after another starts from a clean file system", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		await run(h, "open('leak.txt', 'w').write('secret')\n", "python");
		const read = await run(
			h,
			"import os\nprint('leaked' if os.path.exists('leak.txt') else 'clean')\n",
			"python",
		);
		expect(read.stdout).toContain("clean");
	});
});
