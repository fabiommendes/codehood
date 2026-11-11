import { runnerContractTests } from "@codehood/runner/testing/contract";

runnerContractTests({
	language: "lua",
	readsALine: { code: "print('got', io.read('l'))\n", stdout: "got\thello" },
	errorAtLine3: {
		code: "local x = 1\nlocal y = 2\nerror('boom')\n",
		stderr: "main.lua:3: boom",
	},
	loops: { code: "while true do end\n" },
});
