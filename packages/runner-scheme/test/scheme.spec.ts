import {
	collect,
	loadFrame,
	run,
	send,
	start,
} from "@codehood/runner/testing/suite";
import { expect, test } from "@playwright/test";

/**
 * The Scheme driver with the real BiwaScheme runtime, beyond the contract.
 */

/// Runs `code` as `main.scm` in script mode.
function script(code: string) {
	return { extra: { files: { "main.scm": code }, entry: "main.scm" } };
}

test("call/cc, tail calls and strings work", async ({ page }) => {
	const h = await loadFrame(page);
	const result = await run(
		h,
		"",
		"scheme",
		script(
			[
				"(define (count n acc) (if (= n 0) acc (count (- n 1) (+ acc 1))))",
				"(display (count 10000 0)) (newline)",
				"(display (call/cc (lambda (k) (+ 1 (k 41))))) (newline)",
				'(display (string-append "a" "b")) (newline)',
			].join("\n"),
		),
	);
	expect(result.stdout).toBe("10000\n41\nab\n");
	expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
});

test("an error inside a procedure points at the form that called it", async ({
	page,
}) => {
	const h = await loadFrame(page);
	const result = await run(
		h,
		"",
		"scheme",
		script('(define (f)\n  (car \'()))\n(display "before")\n(f)\n'),
	);
	expect(result.stdout).toBe("before");
	expect(result.stderr).toMatch(/^main\.scm:4: /);
	expect(result.exit).toMatchObject({
		reason: "exited",
		code: 1,
		diagnostics: [{ file: "main.scm", line: 4, column: 0 }],
	});
});

test("a syntax error points at the line where the form starts", async ({
	page,
}) => {
	const h = await loadFrame(page);
	const result = await run(
		h,
		"",
		"scheme",
		script('(display "ok")\n\n(display (+ 1\n'),
	);
	expect(result.stdout).toBe("");
	expect(result.stderr).toMatch(/^main\.scm:3: syntax error: /);
	expect(result.exit).toMatchObject({ reason: "exited", code: 1 });
});

test("(exit n) ends the program with code n", async ({ page }) => {
	const h = await loadFrame(page);
	const result = await run(
		h,
		"",
		"scheme",
		script('(display "a")\n(exit 3)\n(display "b")\n'),
	);
	expect(result.stdout).toBe("a");
	expect(result.exit).toMatchObject({ reason: "exited", code: 3 });
});

test("read-line gives the eof object at the end of input", async ({ page }) => {
	const h = await loadFrame(page);
	const id = await start(
		h,
		"",
		"scheme",
		script("(display (eof-object? (read-line)))\n"),
	);
	await send(h, { type: "stdin-eof", runId: id });
	expect((await collect(h, id, 30_000)).stdout).toBe("#t");
});

test("the REPL writes values, skips definitions and waits for open forms", async ({
	page,
}) => {
	const h = await loadFrame(page);
	const id = await start(h, "", "scheme", {
		mode: "repl",
		...script("(define (double n) (* 2 n))\n"),
	});
	for (const line of [
		"(double 21)",
		"(define y",
		"  5)",
		"(list y 'a)",
		"(car '())",
		"(+ 1 1)",
	]) {
		await send(h, { type: "stdin", runId: id, line });
	}
	await send(h, { type: "stdin-eof", runId: id });
	const result = await collect(h, id, 30_000);
	expect(result.stdout).toBe("42\n(5 a)\n2\n");
	expect(result.stderr).toContain("car");
	expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
});
