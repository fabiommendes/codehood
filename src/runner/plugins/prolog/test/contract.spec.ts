import { runnerContractTests } from "@codehood/runner/testing/contract";

runnerContractTests({
	language: "prolog",
	readsALine: {
		code: ":- read(X), format('got ~w~n', [X]).\n",
		mode: "repl",
		stdin: ["hello."],
		eof: true,
		stdout: "got hello",
	},
	errorAtLine3: {
		code: "ok.\nok.\nbroken( :- .\n",
		mode: "repl",
		eof: true,
		stderr: /main\.pl:3:\d+/,
	},
	loops: { code: "loop :- loop.\n:- loop.\n" },
});
