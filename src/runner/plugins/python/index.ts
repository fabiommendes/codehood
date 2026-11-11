/**
 * Python: CPython compiled to WebAssembly (Pyodide).
 */

import { defineRunner } from "@codehood/runner-api";
import { RUNTIMES } from "../../sandbox/runtimes";

export default function python() {
	return defineRunner({
		apiVersion: 1,
		id: "python",
		aliases: ["py", "python3"],
		extension: "py",
		modes: ["script", "repl"],
		defaultMode: "script",
		label: { en: "Python" },
		driver: "./src/runner/sandbox/drivers/python.ts",
		editor: "./src/runner/plugins/python/editor.ts",
		grammar: { shiki: "python" },
		runtimes: [RUNTIMES.pyodide],
	});
}
