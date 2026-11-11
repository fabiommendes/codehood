import {
	collect,
	loadFrame,
	messagesOf,
	send,
	start,
} from "@codehood/runner/testing/suite";
import { expect, test } from "@playwright/test";

/**
 * The Elm driver with the real Guida compiler. Run with
 * `pnpm run test:plugins --project=elm`.
 */

const LISTS = `module Main exposing (..)

import Expect
import Test exposing (Test, describe, test)


double : Int -> Int
double n =
    2 * n


tests : Test
tests =
    describe "double"
        [ test "doubles 2" (\\_ -> Expect.equal 4 (double 2))
        , test "doubles 3" (\\_ -> Expect.equal 6 (double 3))
        ]
`;

/// `LISTS` with one test that fails.
const FAILING = LISTS.replace(
	"Expect.equal 6 (double 3)",
	"Expect.equal 7 (double 3)",
);

/// Strips ANSI escapes, which the REPL and the reports use for colors.
function plain(text: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

type Harness = Awaited<ReturnType<typeof loadFrame>>;

/// Waits until the run has asked for input `count` times in all.
async function prompts(h: Harness, runId: string, count: number) {
	await expect
		.poll(
			async () =>
				(await messagesOf(h, runId)).filter(
					(m) => m.type === "status" && m.state === "waiting-input",
				).length,
			{ timeout: 60_000 },
		)
		.toBeGreaterThanOrEqual(count);
}

/// Sends `lines`, each after its prompt, then waits for the next prompt.
async function typeLines(h: Harness, runId: string, lines: string[]) {
	for (const [i, line] of lines.entries()) {
		await prompts(h, runId, i + 1);
		await send(h, { type: "stdin", runId, line });
	}
	await prompts(h, runId, lines.length + 1);
}

test.describe("elm", () => {
	test.setTimeout(120_000);

	test("the REPL sees the entry module and prints values with their types", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const id = await start(h, LISTS.replace(/\ntests :[\s\S]*$/, "\n"), "elm", {
			mode: "repl",
		});
		await typeLines(h, id, ["double 21", 'f x = x ++ "!"', 'f "oi"']);
		await send(h, { type: "stdin-eof", runId: id });
		const result = await collect(h, id, 60_000);
		const out = plain(result.stdout);
		expect(out).toContain("Elm 0.19.1");
		expect(out).not.toContain("Guida 1.0.0 ---");
		expect(out).toContain("42 : Int");
		expect(out).toContain("<function> : String -> String");
		expect(out).toContain('"oi!" : String');
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
	});

	test("a runtime error in the REPL goes to stderr and the REPL goes on", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const id = await start(h, "module Main exposing (..)\n\nx = 1\n", "elm", {
			mode: "repl",
		});
		await typeLines(h, id, ['Debug.todo "boom"', "x + 1"]);
		await send(h, { type: "stdin", runId: id, line: ":exit" });
		const result = await collect(h, id, 60_000);
		expect(plain(result.stderr)).toContain("boom");
		expect(plain(result.stdout)).toContain("2 : number");
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
	});

	test("a type error is reported at its place and the REPL does not open", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const id = await start(
			h,
			'module Main exposing (..)\n\n\nx : Int\nx = 1 + "a"\n',
			"elm",
			{ mode: "repl" },
		);
		const result = await collect(h, id, 60_000);
		expect(plain(result.stderr)).toContain("-- TYPE MISMATCH");
		expect(plain(result.stderr)).toContain("Main.elm");
		expect(plain(result.stderr)).not.toContain("/work/");
		expect(result.exit).toMatchObject({
			reason: "exited",
			code: 1,
			diagnostics: [
				{ file: "Main.elm", line: 5, column: 8, message: "TYPE MISMATCH" },
			],
		});
		expect(
			result.messages.some(
				(m) => m.type === "status" && m.state === "waiting-input",
			),
		).toBe(false);
	});

	test("a failing test is reported and the script exits with 2", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const id = await start(h, FAILING, "elm", { mode: "script" });
		const result = await collect(h, id, 60_000);
		const out = plain(result.stdout);
		expect(out).toContain("✗ doubles 3");
		expect(out).toContain("TEST RUN FAILED");
		expect(out).toMatch(/Passed: +1\nFailed: +1/);
		expect(result.exit).toMatchObject({ reason: "exited", code: 2 });
	});

	test("passing tests exit with 0, and the compiler never reaches a registry", async ({
		page,
	}) => {
		const requests: string[] = [];
		page.on("request", (request) => requests.push(request.url()));
		const h = await loadFrame(page);
		const id = await start(h, LISTS, "elm", { mode: "script" });
		const result = await collect(h, id, 60_000);
		expect(plain(result.stdout)).toContain("TEST RUN PASSED");
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
		// The app page loads fonts from outside; what must never happen is the
		// compiler reaching a package registry or GitHub.
		expect(
			requests.filter((url) => /elm-lang|guida-lang|github/.test(url)),
		).toEqual([]);
	});

	test("a module with no tests compiles in script mode", async ({ page }) => {
		const h = await loadFrame(page);
		const id = await start(h, "module Main exposing (..)\n\nx = 1\n", "elm", {
			mode: "script",
		});
		const result = await collect(h, id, 60_000);
		expect(result.stdout).toBe("Compiled Main.elm, no tests to run.\n");
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
	});
});
