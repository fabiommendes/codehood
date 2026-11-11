/**
 * Elm: the Guida compiler, with a package cache built ahead. Run compiles
 * the files, runs their tests and opens the REPL.
 */

import { defineRunner } from "@codehood/runner-api";
import { guida } from "./runtime";

export default function elm() {
	return defineRunner({
		apiVersion: 1,
		id: "elm",
		extension: "elm",
		// File names must match module names.
		defaultFilename: "Main.elm",
		modes: ["repl", "script"],
		defaultMode: "repl",
		label: { en: "Elm" },
		notes: {
			restart: {
				en: "Run restarts the Elm REPL",
				"pt-BR": "Rodar reinicia o REPL do Elm",
			},
		},
		driver: "./src/runner/plugins/elm/driver.ts",
		editor: "./src/runner/plugins/elm/editor.ts",
		grammar: { shiki: "elm" },
		runtimes: [guida],
		build: "./src/runner/plugins/elm/build.ts",
	});
}
