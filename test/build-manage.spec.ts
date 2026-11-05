import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("the bundled management CLI imports only node builtins and production dependencies", () => {
	const outfile = path.resolve("test/.tmp/build-manage/manage.mjs");
	execFileSync("node_modules/.bin/tsx", ["scripts/build-manage.ts", outfile]);
	const dependencies = Object.keys(
		JSON.parse(readFileSync("package.json", "utf8")).dependencies,
	);

	const code = readFileSync(outfile, "utf8");
	// esbuild writes the external imports at the top level, from column 0.
	const specifiers = [
		...code.matchAll(/^import\s[^;]*?["']([^"']+)["'];?$/gm),
		...code.matchAll(/\bimport\(\s*["']([^"'.][^"']*)["']\s*\)/g),
	]
		.map((match) => match[1] as string)
		.filter((specifier) => !specifier.startsWith("."));
	const packageOf = (specifier: string) =>
		specifier.startsWith("@")
			? specifier.split("/").slice(0, 2).join("/")
			: (specifier.split("/")[0] as string);
	const missing = specifiers.filter(
		(specifier) =>
			!specifier.startsWith("node:") &&
			!dependencies.includes(packageOf(specifier)),
	);

	expect(specifiers.length).toBeGreaterThan(0);
	expect(missing).toEqual([]);
});
