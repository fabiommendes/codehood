/**
 * JavaScript driver: runs the entry file in the Worker itself, no download.
 *
 * Script mode evaluates the entry file as the body of an async function, so
 * top-level `await` works. `console.log`, `info` and `debug` write to stdout;
 * `console.error` and `warn` to stderr; values are formatted like Node's
 * `util.inspect` for plain data. `prompt(message?)` writes `message`, then
 * returns `readLine()`. An uncaught error prints its stack to stderr and exits
 * with code 1.
 *
 * REPL mode reads lines with `readLine`, evaluates each in a shared global
 * scope, prints the result, and ends with code 0 at end of input.
 *
 * Only the entry file runs; other files in `files` are ignored for now.
 */

import type { Driver } from "../driver";

export const javascriptDriver: Driver = {
	language: "javascript",
	modes: ["script", "repl"],
	async load() {
		throw new Error("not implemented");
	},
	async run() {
		throw new Error("not implemented");
	},
};
