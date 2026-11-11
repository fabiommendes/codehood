/**
 * TypeScript: types stripped by sucrase, then run as JavaScript.
 */

import { defineRunner } from "../../plugin";
import { RUNTIMES } from "../../sandbox/runtimes";

export default function typescript() {
	return defineRunner({
		apiVersion: 1,
		id: "typescript",
		aliases: ["ts", "mts"],
		extension: "ts",
		modes: ["script"],
		defaultMode: "script",
		label: { en: "TypeScript" },
		driver: "./src/runner/sandbox/drivers/typescript.ts",
		editor: "./src/runner/plugins/typescript/editor.ts",
		grammar: { shiki: "typescript" },
		runtimes: [RUNTIMES.sucrase],
		sandboxDependencies: ["acorn"],
	});
}
