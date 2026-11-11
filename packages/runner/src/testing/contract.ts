/**
 * The tests every runner plugin must pass, against the runner test server.
 *
 * A plugin's suite calls `runnerContractTests` with programs in its language;
 * the kit runs them through the real frame and checks what the app relies on:
 * the language is announced, stdin reaches the program, an error points at
 * its line, and Stop ends a run that never finishes.
 */

import type { RunMode } from "@codehood/runner-api/driver";
import { expect, test } from "@playwright/test";
import type { Harness, RunResult, StartOptions } from "./harness";
import { collect, loadFrame, send, start, waitFor } from "./suite";

/// A program of the contract, with how to run it.
export interface ContractProgram {
	code: string;
	mode?: RunMode;
	/// Lines typed into the program, in order.
	stdin?: string[];
	/// Whether end of input follows the lines.
	eof?: boolean;
}

/** Programs in the plugin's language that exercise the contract. */
export interface RunnerContract {
	language: string;
	/// Entry file name; the harness default is `main.<language>`.
	entry?: string;
	/// Run timeout, which covers the download of the runtime.
	timeout?: number;
	/// Reads the line `hello`; `stdout` is what it must print.
	readsALine: ContractProgram & { stdout: string | RegExp };
	/// Fails at line 3 of the entry; `stderr` must point at it.
	errorAtLine3: ContractProgram & { stderr: string | RegExp };
	/// Never ends on its own. Omit it only for a language that cannot loop.
	loops?: ContractProgram;
}

/// Run options of `program`, with the contract's entry file.
function options(contract: RunnerContract, program: ContractProgram) {
	const opts: StartOptions = { mode: program.mode ?? "script" };
	if (contract.entry) {
		opts.extra = {
			files: { [contract.entry]: program.code },
			entry: contract.entry,
		};
	}
	return opts;
}

/// Runs `program` to its end, typing its input.
async function runProgram(
	h: Harness,
	contract: RunnerContract,
	program: ContractProgram,
	stdin: string[] = [],
): Promise<RunResult> {
	const id = await start(
		h,
		program.code,
		contract.language,
		options(contract, program),
	);
	for (const line of program.stdin ?? stdin) {
		await send(h, { type: "stdin", runId: id, line });
	}
	if (program.eof) await send(h, { type: "stdin-eof", runId: id });
	return collect(h, id, contract.timeout ?? 60_000);
}

/**
 * Declares the contract tests of a runner plugin in the current spec file.
 *
 * @example
 * runnerContractTests({
 *   language: "python",
 *   readsALine: { code: "print('got', input())\n", stdout: "got hello" },
 *   errorAtLine3: { code: "x = 1\ny = 2\nraise ValueError()\n", stderr: 'line 3' },
 *   loops: { code: "while True:\n    pass\n" },
 * });
 */
export function runnerContractTests(contract: RunnerContract): void {
	const { language } = contract;
	const timeout = contract.timeout ?? 60_000;

	test.describe(`${language} runner contract`, () => {
		test("the frame announces the language", async ({ page }) => {
			const h = await loadFrame(page);
			expect(h.ready.languages).toContain(language);
		});

		test("a program reads a line and prints it", async ({ page }) => {
			const program = contract.readsALine;
			const result = await runProgram(
				await loadFrame(page),
				contract,
				program,
				["hello"],
			);
			if (typeof program.stdout === "string") {
				expect(result.stdout).toContain(program.stdout);
			} else {
				expect(result.stdout).toMatch(program.stdout);
			}
			expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
		});

		test("an error points at its line", async ({ page }) => {
			const program = contract.errorAtLine3;
			const result = await runProgram(await loadFrame(page), contract, program);
			if (typeof program.stderr === "string") {
				expect(result.stderr).toContain(program.stderr);
			} else {
				expect(result.stderr).toMatch(program.stderr);
			}
			expect(result.exit.reason).toBe("exited");
		});

		const loops = contract.loops;
		if (!loops) return;
		test("Stop ends a run that never finishes, and the frame runs again", async ({
			page,
		}) => {
			const h = await loadFrame(page);
			const id = await start(h, loops.code, language, options(contract, loops));
			await waitFor(h, id, "status", "running", timeout);
			await page.waitForTimeout(300);
			await send(h, { type: "stop", runId: id });
			const result = await collect(h, id, 5000);
			expect(result.exit).toMatchObject({ reason: "stopped", code: null });
			const again = await runProgram(h, contract, contract.readsALine, [
				"hello",
			]);
			expect(again.exit).toMatchObject({ reason: "exited", code: 0 });
		});
	});
}
