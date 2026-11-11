import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildModule } from "@codehood/runner/server/integration";
import { expect, test } from "@playwright/test";

/// A runtime module bundle may pull in only its own package and its
/// dependency, never other code of the repository or of `node_modules`.

const ROOT = process.cwd();

test("the sucrase module bundles with its own files only", async () => {
	const dir = mkdtempSync(join(tmpdir(), "bundle-"));
	try {
		await buildModule(
			join(ROOT, "node_modules/sucrase/dist/esm/index.js"),
			["transform"],
			join(dir, "sucrase.mjs"),
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a runtime module that imports other code fails the build", async () => {
	const dir = mkdtempSync(join(tmpdir(), "bundle-"));
	try {
		const source = join(dir, "source.js");
		writeFileSync(
			source,
			`import { z } from ${JSON.stringify(join(ROOT, "node_modules/zod/index.js"))};\nexport const transform = z;\n`,
		);
		await expect(
			buildModule(source, ["transform"], join(dir, "out.mjs")),
		).rejects.toThrow(/may import only sucrase, /);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
