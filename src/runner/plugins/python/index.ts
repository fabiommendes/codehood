/**
 * Python: CPython compiled to WebAssembly (Pyodide).
 */

import { defineRunner } from "@codehood/runner-api";
import { pyodide } from "./runtime";

export default function python() {
	return defineRunner({
		apiVersion: 1,
		id: "python",
		aliases: ["py", "python3"],
		extension: "py",
		modes: ["script", "repl"],
		defaultMode: "script",
		label: { en: "Python" },
		driver: "./src/runner/plugins/python/driver.ts",
		editor: "./src/runner/plugins/python/editor.ts",
		grammar: { shiki: "python" },
		runtimes: [pyodide],
	});
}
