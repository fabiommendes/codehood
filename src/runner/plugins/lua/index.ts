/**
 * Lua: Lua 5.4 compiled to WebAssembly (wasmoon).
 */

import { defineRunner } from "@codehood/runner-api";
import { wasmoon } from "./runtime";

export default function lua() {
	return defineRunner({
		apiVersion: 1,
		id: "lua",
		extension: "lua",
		modes: ["script", "repl"],
		defaultMode: "script",
		label: { en: "Lua" },
		driver: "./src/runner/plugins/lua/driver.ts",
		editor: "./src/runner/plugins/lua/editor.ts",
		grammar: { shiki: "lua" },
		runtimes: [wasmoon],
	});
}
