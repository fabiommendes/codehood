/**
 * Regenerates what the CLI derives from the server's OpenAPI document.
 *
 * - no argument: writes the snapshot `cli/resources/openapi/codehood.json`,
 *   then regenerates the client `cli/codehood/api/generated.py` from it
 *   (needs `uv`).
 * - a path: writes only the document there. `cli/scripts/copy-openapi.py`
 *   uses this form.
 *
 * The formatting (two-space indent, trailing newline) is the one
 * `cli/scripts/copy-openapi.py` writes, so a diff shows only real changes.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApiDocument } from "@/api/registry/openapi-document";

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const cliDir = path.join(rootDir, "cli");
const snapshot = path.join(cliDir, "resources/openapi/codehood.json");
const argument = process.argv[2];
const outPath = path.resolve(argument ?? snapshot);

writeFileSync(
	outPath,
	`${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`,
	"utf8",
);
console.log(`wrote ${outPath}`);

if (argument === undefined) {
	const result = spawnSync(
		"uv",
		["run", "python", "-m", "codehood.api.generate", snapshot],
		{ cwd: cliDir, stdio: "inherit" },
	);
	if (result.error) {
		console.error(
			`could not run uv (${result.error.message}). The snapshot was written; ` +
				"install uv, then run `cd cli && uv run python -m codehood.api.generate " +
				"resources/openapi/codehood.json` to regenerate the client.",
		);
		process.exit(1);
	}
	if (result.status !== 0) process.exit(result.status ?? 1);
}
