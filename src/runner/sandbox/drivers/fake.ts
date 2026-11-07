/**
 * Deterministic driver for tests: a tiny command language that exercises
 * every path of the protocol without downloading a runtime.
 *
 * The entry file has one command per line; blank lines are skipped:
 *
 * | Command                   | Effect                                              |
 * | :------------------------ | :-------------------------------------------------- |
 * | `out <text>`              | writes `<text>\n` to stdout                         |
 * | `err <text>`              | writes `<text>\n` to stderr                         |
 * | `read`                    | `readLine()`; writes `<line>\n`, or `EOF\n` on null |
 * | `flood <bytes>`           | writes `<bytes>` characters `x` to stdout           |
 * | `loop`                    | spins forever (`while (true) {}`)                   |
 * | `exit <code>`             | ends with that exit code                            |
 * | `crash <message>`         | throws; the run ends with `crashed`                 |
 *
 * `load` honors the commands that appear before any other command:
 *
 * | Command                   | Effect                                              |
 * | :------------------------ | :-------------------------------------------------- |
 * | `progress <loaded> <total>` | reports download progress                         |
 * | `load-delay <ms>`         | waits before finishing the load                     |
 * | `load-fail <message>`     | throws; the run ends with `load-failed`             |
 *
 * Without `exit`, the program ends with code 0. REPL mode reads lines and runs
 * each as a command until end of input.
 */

import type { Driver } from "../driver";

export const fakeDriver: Driver = {
	language: "fake",
	modes: ["script", "repl"],
	async load() {
		throw new Error("not implemented");
	},
	async run() {
		throw new Error("not implemented");
	},
};
