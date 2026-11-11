import { runnerContractTests } from "@codehood/runner/testing/contract";

runnerContractTests({
	language: "typescript",
	readsALine: {
		code: "const line: string | null = prompt();\nconsole.log('got', line);\n",
		stdout: "got hello",
	},
	errorAtLine3: {
		code: "interface A { n: number }\nconst a: A = { n: 1 };\nthrow new Error('boom');\n",
		stderr: "main.ts:3",
	},
	loops: { code: "while (true) {}\n" },
});
