import { runnerContractTests } from "@codehood/runner/testing/contract";

runnerContractTests({
	language: "scheme",
	entry: "main.scm",
	readsALine: {
		code: '(display "got ")\n(display (read-line))\n(newline)\n',
		stdout: "got hello",
	},
	errorAtLine3: {
		code: "(define x 1)\n(define y 2)\n(car '())\n",
		stderr: "main.scm:3:",
	},
	loops: { code: "(let loop () (loop))\n" },
});
