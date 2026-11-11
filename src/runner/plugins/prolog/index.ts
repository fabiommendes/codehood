/**
 * Prolog: SWI-Prolog compiled to WebAssembly. Run consults the files and
 * opens the toplevel.
 */

import { defineRunner } from "../../plugin";
import { RUNTIMES } from "../../sandbox/runtimes";

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
		driver: "./src/runner/sandbox/drivers/prolog.ts",
		editor: "./src/runner/plugins/prolog/editor.ts",
		grammar: { shiki: "prolog" },
		runtimes: [RUNTIMES.swipl],
	});
}
