import { runnerContractTests } from "@codehood/runner/testing/contract";

runnerContractTests({
	language: "javascript",
	readsALine: {
		code: "console.log('got', prompt());\n",
		stdout: "got hello",
	},
	errorAtLine3: {
		code: "const x = 1;\nconst y = 2;\nthrow new Error('boom');\n",
		stderr: "main.js:3",
	},
	loops: { code: "while (true) {}\n" },
});
