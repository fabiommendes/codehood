import { runnerContractTests } from "@codehood/runner/testing/contract";

runnerContractTests({
	language: "python",
	readsALine: { code: "print('got', input())\n", stdout: "got hello" },
	errorAtLine3: {
		code: "x = 1\ny = 2\nraise ValueError('boom')\n",
		stderr: 'File "main.py", line 3',
	},
	loops: { code: "while True:\n    pass\n" },
});
