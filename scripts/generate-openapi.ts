/**
 * Writes the server's OpenAPI document to the CLI's snapshot,
 * `cli/resources/openapi/codehood.json`, or to the path given as argument.
 *
 * The formatting (two-space indent, trailing newline) is the one
 * `cli/scripts/copy-openapi.py` writes, so a diff shows only real changes.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApiDocument } from "@/api/registry/openapi-document";

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const outPath = path.resolve(
	process.argv[2] ?? path.join(rootDir, "cli/resources/openapi/codehood.json"),
);

writeFileSync(
	outPath,
	`${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`,
	"utf8",
);
console.log(`wrote ${outPath}`);
