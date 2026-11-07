import { expect, test } from "@playwright/test";
import { cleanStack } from "@/runner/sandbox/drivers/javascript-stack";

const WORKER = "https://runner.example/runner/abc/worker.js";

test.describe("cleanStack", () => {
	test("Chrome: drops runner frames and removes the wrapper's two lines", () => {
		const stack = [
			"Error: boom",
			`    at fail (eval at runScript (${WORKER}:10:5), <anonymous>:5:9)`,
			`    at eval (eval at runScript (${WORKER}:10:5), <anonymous>:7:1)`,
			`    at runScript (${WORKER}:12:3)`,
			`    at async ${WORKER}:99:1`,
		].join("\n");
		expect(cleanStack(stack, "main.js", 2)).toBe(
			[
				"Error: boom",
				"    at fail (main.js:3:9)",
				"    at eval (main.js:5:1)",
			].join("\n"),
		);
	});

	test("Firefox: frames have no header and carry the eval marker", () => {
		const stack = [
			`fail@${WORKER} line 10 > AsyncFunction:5:9`,
			`@${WORKER} line 10 > AsyncFunction:7:1`,
			`runScript@${WORKER}:12:3`,
		].join("\n");
		expect(cleanStack(stack, "main.js", 2)).toBe(
			["fail@main.js:3:9", "@main.js:5:1"].join("\n"),
		);
	});

	test("the REPL has no wrapper to compensate", () => {
		const stack = `ReferenceError: x is not defined\n    at eval (eval at runRepl (${WORKER}:1:1), <anonymous>:1:1)`;
		expect(cleanStack(stack, "repl", 0)).toBe(
			"ReferenceError: x is not defined\n    at eval (repl:1:1)",
		);
	});

	test("a stack with only runner frames keeps the message", () => {
		const stack = `Error: x\n    at runScript (${WORKER}:12:3)`;
		expect(cleanStack(stack, "main.js", 2)).toBe("Error: x");
	});
});
