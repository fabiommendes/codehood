import { runnerContractTests } from "@codehood/runner/testing/contract";

runnerContractTests({
	language: "elm",
	readsALine: {
		code: "module Main exposing (..)\n\n\ndouble n =\n    2 * n\n",
		mode: "repl",
		stdin: ["double 21"],
		eof: true,
		stdout: "42",
	},
	// Elm reports type errors with the source line; the program never runs.
	errorAtLine3: {
		code: 'module Main exposing (..)\n\nx = 1 + "a"\n',
		stderr: '3| x = 1 + "a"',
	},
});
