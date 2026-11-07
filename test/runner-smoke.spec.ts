import { expect, test } from "@playwright/test";
import { collect, loadFrame, send, start } from "./runner-harness";

/**
 * Two smoke tests per real runtime, in the default suite: the runtime loads
 * and reads a line, and an error carries its line number. The full cases are
 * in `test/runtimes/`.
 */

test.describe("prolog smoke", () => {
	test("loads and reads a line", async ({ page }) => {
		const h = await loadFrame(page);
		const id = await start(
			h,
			":- read(X), format('got ~w~n', [X]).\n",
			"prolog",
			{ mode: "repl" },
		);
		await send(h, { type: "stdin", runId: id, line: "hello." });
		await send(h, { type: "stdin-eof", runId: id });
		const result = await collect(h, id, 60_000);
		expect(result.stdout).toContain("got hello");
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
	});

	test("a syntax error carries its line number", async ({ page }) => {
		const h = await loadFrame(page);
		const id = await start(h, "ok.\nok.\nbroken( :- .\n", "prolog", {
			mode: "repl",
		});
		await send(h, { type: "stdin-eof", runId: id });
		const result = await collect(h, id, 60_000);
		expect(result.stderr).toMatch(/main\.pl:3:\d+/);
	});
});

test.describe("python smoke", () => {
	test("loads and reads a line", async ({ page }) => {
		const h = await loadFrame(page);
		const id = await start(h, "print('got', input())\n", "python");
		await send(h, { type: "stdin", runId: id, line: "hello" });
		const result = await collect(h, id, 60_000);
		expect(result.stdout).toContain("got hello");
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
	});

	test("an error carries its line number", async ({ page }) => {
		const h = await loadFrame(page);
		const id = await start(
			h,
			"x = 1\ny = 2\nraise ValueError('boom')\n",
			"python",
		);
		const result = await collect(h, id, 60_000);
		expect(result.stderr).toContain('File "main.py", line 3');
		expect(result.exit).toMatchObject({ reason: "exited", code: 1 });
	});
});
