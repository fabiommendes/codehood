/**
 * Checks that the server, the CLI and the chalk-worker hold the same version,
 * and that the worker requires exactly that `codehood-cli`.
 *
 * Usage: `tsx scripts/check-versions.ts`
 *
 * `pnpm run release` bumps the three together.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/mdq-snapshot";
import {
	lockstepProblems,
	packageJsonVersion,
	pyprojectPin,
	pyprojectVersion,
} from "./lib/siblings";

const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const worker = read("workers/chalk-worker/pyproject.toml");

const problems = lockstepProblems(
	[
		{ file: "package.json", version: packageJsonVersion(read("package.json")) },
		{
			file: "cli/pyproject.toml",
			version: pyprojectVersion(read("cli/pyproject.toml")),
		},
		{
			file: "workers/chalk-worker/pyproject.toml",
			version: pyprojectVersion(worker),
		},
	],
	pyprojectPin(worker, "codehood-cli"),
);

for (const problem of problems) console.error(`error: ${problem}`);
process.exit(problems.length > 0 ? 1 : 0);
