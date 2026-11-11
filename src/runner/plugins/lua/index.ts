/**
 * Lua: Lua 5.4 compiled to WebAssembly (wasmoon).
 */

import { defineRunner } from "../../plugin";
import { RUNTIMES } from "../../sandbox/runtimes";

export default function lua() {
	return defineRunner({
		apiVersion: 1,
		id: "lua",
		extension: "lua",
		modes: ["script", "repl"],
		defaultMode: "script",
		label: { en: "Lua" },
		driver: "./src/runner/sandbox/drivers/lua.ts",
		editor: "./src/runner/plugins/lua/editor.ts",
		grammar: { shiki: "lua" },
		runtimes: [RUNTIMES.wasmoon],
	});
}
