/**
 * Build step of the Elm plugin: writes the package cache the driver fetches.
 */

import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { BuildContext } from "@codehood/runner-api";
import { buildElmCache } from "../../elm/cache";
import { ELM_CACHE_FILE } from "../../sandbox/drivers/elm/project";

/// Inputs of the cache, relative to the root: the compiler, the package
/// sources, the support modules and the code that builds the cache.
const INPUTS = [
	join("node_modules", "guida", "bin", "guida.min.js"),
	join("src", "runner", "elm"),
	join("src", "runner", "sandbox", "drivers", "elm"),
];

/// Files under `dir`, absolute, sorted.
function filesUnder(dir: string): string[] {
	return (
		readdirSync(dir, { recursive: true, withFileTypes: true }) as never as {
			name: string;
			parentPath: string;
			isFile(): boolean;
		}[]
	)
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name))
		.sort();
}

/**
 * Emits the Elm package cache (`ELM_CACHE_FILE`).
 *
 * Building it takes seconds, so the result is kept in the plugin's cache
 * directory under the hash of its inputs and reused while they do not change.
 */
export default async function buildElm({
	root,
	cacheDir,
	emit,
}: BuildContext): Promise<void> {
	const hash = createHash("sha256");
	for (const input of INPUTS) {
		const path = join(root, input);
		const files = statSync(path).isDirectory() ? filesUnder(path) : [path];
		for (const file of files) {
			hash.update(file.slice(root.length)).update(readFileSync(file));
		}
	}
	const cached = join(cacheDir, `${hash.digest("hex")}.bin`);
	if (!existsSync(cached)) {
		mkdirSync(cacheDir, { recursive: true });
		writeFileSync(`${cached}.tmp`, await buildElmCache(root));
		renameSync(`${cached}.tmp`, cached);
	}
	emit(ELM_CACHE_FILE, readFileSync(cached));
}
