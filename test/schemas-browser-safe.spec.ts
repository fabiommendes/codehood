import path from "node:path";
import vm from "node:vm";
import { expect, test } from "@playwright/test";
import { build } from "esbuild";

test("the schemas barrel loads in a browser, without process or Buffer", async () => {
	const result = await build({
		stdin: {
			contents: 'export * from "@/core/schemas";',
			resolveDir: path.resolve("src"),
		},
		alias: { "@": path.resolve("src") },
		bundle: true,
		write: false,
		platform: "browser",
		format: "iife",
		globalName: "schemas",
		logLevel: "silent",
	});
	const code = result.outputFiles[0]?.text ?? "";
	const context = vm.createContext({});
	expect(() => vm.runInContext(code, context)).not.toThrow();
	const schemas = vm.runInContext("schemas", context);
	expect(typeof schemas.answerGrade.safeParse).toBe("function");
});
