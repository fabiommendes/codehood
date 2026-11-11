/**
 * TypeScript: types stripped by sucrase, then run as JavaScript.
 */

import { defineRunner } from "@codehood/runner-api";
import { sucrase } from "./runtime";

export default function typescript() {
	return defineRunner({
		apiVersion: 1,
		id: "typescript",
		aliases: ["ts", "mts"],
		extension: "ts",
		modes: ["script"],
		defaultMode: "script",
		label: { en: "TypeScript" },
		driver: "./src/runner/plugins/typescript/driver.ts",
		editor: "./src/runner/plugins/typescript/editor.ts",
		grammar: { shiki: "typescript" },
		runtimes: [sucrase],
		sandboxDependencies: ["acorn"],
	});
}
