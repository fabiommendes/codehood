/**
 * Downloads the sources of the Elm packages the runner provides into
 * `src/runner/elm/packages/<author>/<name>/<version>/`.
 *
 * Run by hand after changing `ELM_PACKAGES`; the build never touches the
 * network. Keeps only `elm.json`, `LICENSE` and `src/` of each package.
 *
 *     node --import tsx scripts/fetch-elm-packages.ts
 */

import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ELM_PACKAGES } from "../src/runner/sandbox/drivers/elm/project";

const ROOT = resolve(import.meta.dirname, "..");
const TARGET = join(ROOT, "src", "runner", "elm", "packages");

/// Files and directories copied from each package.
const KEEP = ["elm.json", "LICENSE", "src"];

async function main() {
	const scratch = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "elm-pkg-"));
	try {
		rmSync(TARGET, { recursive: true, force: true });
		for (const { name, version } of ELM_PACKAGES) {
			const url = `https://codeload.github.com/${name}/tar.gz/refs/tags/${version}`;
			const response = await fetch(url);
			if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
			const archive = join(scratch, `${name.replace("/", "-")}.tar.gz`);
			writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
			const unpacked = join(scratch, name.replace("/", "-"));
			mkdirSync(unpacked);
			execFileSync("tar", [
				"-xzf",
				archive,
				"-C",
				unpacked,
				"--strip-components=1",
			]);
			const dest = join(TARGET, name, version);
			mkdirSync(dest, { recursive: true });
			for (const entry of KEEP) {
				const from = join(unpacked, entry);
				if (!existsSync(from)) {
					throw new Error(`${name} ${version} has no ${entry}.`);
				}
				cpSync(from, join(dest, entry), { recursive: true });
			}
			console.log(`${name} ${version}`);
		}
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

await main();
