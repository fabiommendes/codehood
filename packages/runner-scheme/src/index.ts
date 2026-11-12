/**
 * Scheme for the Codehood runner: BiwaScheme, an interpreter in JavaScript.
 *
 * Not one of the default languages; an instance lists it in
 * `runner.languages`.
 */

import { defineRunner } from "@codehood/runner-api";
import { biwascheme } from "./runtime";

/** The Scheme runner plugin. */
export default function scheme() {
	return defineRunner({
		apiVersion: 1,
		id: "scheme",
		aliases: ["scheme", "scm", "ss"],
		extension: "scm",
		modes: ["script", "repl"],
		defaultMode: "script",
		label: { en: "Scheme" },
		driver: "@codehood/runner-scheme/driver",
		editor: "@codehood/runner-scheme/editor",
		grammar: { shiki: "scheme" },
		runtimes: [biwascheme],
	});
}
