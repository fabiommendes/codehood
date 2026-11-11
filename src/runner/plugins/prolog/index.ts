/**
 * Prolog: SWI-Prolog compiled to WebAssembly. Run consults the files and
 * opens the toplevel.
 */

import { defineRunner } from "@codehood/runner-api";
import { swipl } from "./runtime";

export default function prolog() {
	return defineRunner({
		apiVersion: 1,
		id: "prolog",
		aliases: ["pl", "swipl"],
		extension: "pl",
		modes: ["repl"],
		defaultMode: "repl",
		label: { en: "Prolog" },
		notes: {
			restart: {
				en: "Run restarts Prolog",
				"pt-BR": "Rodar reinicia o Prolog",
			},
		},
		driver: "./src/runner/plugins/prolog/driver.ts",
		editor: "./src/runner/plugins/prolog/editor.ts",
		grammar: { shiki: "prolog" },
		runtimes: [swipl],
	});
}
