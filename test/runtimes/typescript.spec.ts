import { expect, test } from "../fixtures";
import {
	collect,
	loadFrame,
	messagesOf,
	run,
	send,
	start,
	statesOf,
} from "../runner-harness";

/**
 * The TypeScript driver with the real sucrase runtime. Slow: not part of the
 * default suite; run with `pnpm exec tsx test/run.ts test/runtimes`.
 */

/// Starts a TypeScript run, queues `input` lines and then end of input.
async function runWithInput(
	page: Parameters<typeof loadFrame>[0],
	code: string,
	input: string[] = [],
) {
	const h = await loadFrame(page);
	const id = await start(h, code, "typescript");
	for (const line of input) {
		await send(h, { type: "stdin", runId: id, line });
	}
	await send(h, { type: "stdin-eof", runId: id });
	return { h, id, result: await collect(h, id, 30_000) };
}

test.describe("typescript driver", () => {
	test("annotations, enum and interface run", async ({ page }) => {
		const { result } = await runWithInput(
			page,
			[
				"interface Point { x: number; y: number }",
				"enum Color { Red, Green = 5 }",
				"type Id = string | number;",
				"function norm(p: Point): number { return Math.hypot(p.x, p.y); }",
				"const id: Id = 'a';",
				"console.log(norm({ x: 3, y: 4 }), Color.Green, Color[0], id);",
				"class Box<T> { constructor(public value: T) {} }",
				"console.log(new Box<number>(7).value);",
			].join("\n"),
		);
		expect(result.stderr).toBe("");
		expect(result.stdout).toBe("5 5 Red a\n7\n");
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
	});

	test("a type error does not stop the program", async ({ page }) => {
		const { result } = await runWithInput(
			page,
			"const n: number = 'not a number';\nconsole.log(n);\n",
		);
		expect(result.stdout).toBe("not a number\n");
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
	});

	test("an exception on line 7 of the .ts reads main.ts:7", async ({
		page,
	}) => {
		const { result } = await runWithInput(
			page,
			[
				"interface A { n: number }",
				"enum E { X }",
				"const a: A = { n: 1 };",
				"function f(x: A): number {",
				"  return x.n;",
				"}",
				"throw new Error('boom ' + f(a));",
			].join("\n"),
		);
		expect(result.stderr).toContain("Error: boom 1");
		expect(result.stderr).toContain("main.ts:7");
		expect(result.exit).toMatchObject({ reason: "exited", code: 1 });
	});

	test("a syntax error names the file", async ({ page }) => {
		const { result } = await runWithInput(page, "const x: number = ;\n");
		expect(result.stderr).toContain("main.ts");
		expect(result.stderr).toContain("SyntaxError");
		expect(result.exit).toMatchObject({ reason: "exited", code: 1 });
	});

	test("prompt() reads a line from the terminal", async ({ page }) => {
		const { result } = await runWithInput(
			page,
			"const name: string | null = prompt('Name? ');\nconsole.log('Hello, ' + name + '!');\n",
			["Ada"],
		);
		expect(result.stdout).toBe("Name? Hello, Ada!\n");
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
	});

	test("an import of another file fails with a clear message", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const id = await start(h, "", "typescript", {
			extra: {
				files: {
					"main.ts": "import { x } from './helper';\nconsole.log(x);\n",
					"helper.ts": "export const x: number = 1;\n",
				},
			},
		});
		const result = await collect(h, id, 30_000);
		expect(result.stderr).toContain("Cannot use import statement");
		expect(result.stderr).toContain("put the program in a single file");
		expect(result.stdout).toBe("");
		expect(result.exit).toMatchObject({ reason: "exited", code: 1 });
	});

	test("with a prepared runtime the run goes straight to running", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		await send(h, { type: "prepare", language: "typescript" });
		// The reserve has no run id: give it time to load.
		await page.waitForTimeout(5000);
		const id = await start(h, "console.log('hi');\n", "typescript");
		const result = await collect(h, id, 30_000);
		expect(statesOf(await messagesOf(h, id))).not.toContain("loading");
		expect(result.stdout).toContain("hi");
	});
});

test.describe("typescript driver, persistence is blocked", () => {
	test("indexedDB, caches and Worker stay undefined", async ({ page }) => {
		const h = await loadFrame(page);
		const result = await run(
			h,
			"console.log(typeof indexedDB, typeof caches, typeof Worker, typeof navigator.storage);\n",
			"typescript",
		);
		expect(result.stdout).toBe("undefined undefined undefined undefined\n");
	});
});
