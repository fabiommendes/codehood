/**
 * JavaScript: runs in the Worker's own engine.
 */

import { defineRunner } from "@codehood/runner-api";

export default function javascript() {
	return defineRunner({
		apiVersion: 1,
		id: "javascript",
		aliases: ["js", "mjs", "node"],
		extension: "js",
		modes: ["script", "repl"],
		defaultMode: "script",
		label: { en: "JavaScript" },
		driver: "./src/runner/plugins/javascript/driver.ts",
		editor: "./src/runner/plugins/javascript/editor.ts",
		grammar: { shiki: "javascript" },
		sandboxDependencies: ["acorn"],
	});
}
