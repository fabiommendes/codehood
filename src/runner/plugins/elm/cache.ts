/**
 * Builds the Elm package cache the runner ships, without the network.
 *
 * Runs the Guida compiler in Node on a `MemFs`, answers its registry
 * requests from the package sources under `packages/`, compiles a sample
 * program and its test suite, and packs what the compiler left in its
 * package cache and in the project's build directory, plus the support
 * modules under `support/`.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { MemFs, MOUNTED_MTIME } from "./fs";
import {
	type ArchiveEntry,
	type GuidaElm,
	type GuidaIo,
	type HostResponse,
	runGuida,
} from "./host";
import {
	ELM_PACKAGES,
	elmJson,
	HOME_DIR,
	PROJECT_DIR,
	packFiles,
	SOURCE_DIR,
	STUFF_DIR,
	SUPPORT_DIR,
	TEST_MAIN_MODULE,
	testMainSource,
} from "./project";

/// Registry the compiler is pointed at; every request to it is answered
/// here, so the host never resolves.
const REGISTRY = "https://registry.invalid";

/// Scheme of the archive URLs `endpoint.json` hands out.
const ARCHIVE_SCHEME = "codehood-package:";

/// A program that touches every package, so their artifacts get built.
const SAMPLE = `module Main exposing (tests)

import Expect
import Test exposing (Test)


tests : Test
tests =
    Test.test "sample" (\\_ -> Expect.equal 2 (1 + 1))
`;

/// Package files a compile never reads once `artifacts.dat` is built: the
/// sources, the docs and the readme.
const UNUSED =
	/^\/home\/[^/]+\/[^/]+\/packages\/.+\/(src\/.*|docs\.json|README\.md)$/;

/// Every file under `dir`, relative to it, sorted.
function listFiles(dir: string): string[] {
	return (
		readdirSync(dir, { recursive: true, withFileTypes: true }) as never as {
			name: string;
			parentPath: string;
			isFile(): boolean;
		}[]
	)
		.filter((entry) => entry.isFile())
		.map((entry) => relative(dir, join(entry.parentPath, entry.name)))
		.sort();
}

/// Answers the compiler's registry requests from `packagesDir`.
function registry(packagesDir: string): Pick<GuidaIo, "fetch" | "archive"> {
	const known = new Map(ELM_PACKAGES.map((p) => [p.name, p.version]));
	const archives = new Map<string, { sha: string; archive: ArchiveEntry[] }>();
	const archiveOf = (name: string, version: string) => {
		const key = `${name}/${version}`;
		const cached = archives.get(key);
		if (cached) return cached;
		const dir = join(packagesDir, name, version);
		const hash = createHash("sha1");
		const archive = listFiles(dir).map((file) => {
			const eData = readFileSync(join(dir, file), "utf8");
			hash.update(file).update("\0").update(eData).update("\0");
			return { eRelativePath: `package/${file}`, eData };
		});
		// The compiler strips from every path the length of the first one, the
		// root directory of a GitHub zipball.
		const result = {
			sha: hash.digest("hex"),
			archive: [{ eRelativePath: "package/", eData: "" }, ...archive],
		};
		archives.set(key, result);
		return result;
	};
	const pkgPath = new RegExp(
		`^${REGISTRY.replace(/\./g, "\\.")}/packages/([^/]+/[^/]+)/([^/]+)/([^/]+)$`,
	);
	return {
		fetch(method, url): HostResponse {
			if (url === `${REGISTRY}/all-packages` && method === "POST") {
				const all = Object.fromEntries(
					ELM_PACKAGES.map((p) => [p.name, [p.version]]),
				);
				return { status: 200, body: JSON.stringify(all) };
			}
			if (url.startsWith(`${REGISTRY}/all-packages/since/`)) {
				return { status: 200, body: "[]" };
			}
			const match = pkgPath.exec(url);
			if (!match) throw new Error(`Elm cache: unexpected request ${url}.`);
			const [, name = "", version = "", file] = match;
			if (known.get(name) !== version) {
				throw new Error(`Elm cache: ${name} ${version} is not provided.`);
			}
			if (file === "elm.json") {
				return {
					status: 200,
					body: readFileSync(
						join(packagesDir, name, version, "elm.json"),
						"utf8",
					),
				};
			}
			if (file === "endpoint.json") {
				return {
					status: 200,
					body: JSON.stringify({
						url: `${ARCHIVE_SCHEME}${name}/${version}`,
						hash: archiveOf(name, version).sha,
					}),
				};
			}
			return { status: 404, body: "Not Found" };
		},
		archive(url) {
			if (!url.startsWith(ARCHIVE_SCHEME)) return null;
			const rest = url.slice(ARCHIVE_SCHEME.length);
			const version = rest.slice(rest.lastIndexOf("/") + 1);
			return archiveOf(rest.slice(0, rest.lastIndexOf("/")), version);
		},
	};
}

/** Loads `bin/guida.min.js` of the installed `guida` package. */
export function loadGuida(root: string): GuidaElm {
	const require = createRequire(join(root, "package.json"));
	return (require("guida/bin/guida.min.js") as { Elm: GuidaElm }).Elm;
}

/**
 * Builds the packed cache for the project root `root`.
 *
 * The output depends only on the package sources, the support modules and
 * the compiler, so two builds of the same tree give the same bytes.
 *
 * @throws {Error} when a compile fails or the compiler asks for anything
 * outside the provided packages.
 */
export async function buildElmCache(root: string): Promise<Uint8Array> {
	const elmDir = import.meta.dirname;
	let clock = 1000;
	const fs = new MemFs(() => clock++);
	const supportDir = join(elmDir, "support");
	for (const file of listFiles(supportDir)) {
		if (!file.endsWith(".elm")) continue;
		fs.write(
			`${PROJECT_DIR}/${SUPPORT_DIR}/${file}`,
			readFileSync(join(supportDir, file)),
			MOUNTED_MTIME,
		);
	}
	fs.write(`${PROJECT_DIR}/elm.json`, elmJson(), MOUNTED_MTIME);
	fs.write(`${PROJECT_DIR}/${SOURCE_DIR}/Main.elm`, SAMPLE);
	fs.write(
		`${PROJECT_DIR}/${SOURCE_DIR}/${TEST_MAIN_MODULE}.elm`,
		testMainSource("Main"),
	);
	fs.cwd = PROJECT_DIR;
	let output = "";
	const code = await runGuida(loadGuida(root), {
		fs,
		args: [
			"make",
			`${SOURCE_DIR}/${TEST_MAIN_MODULE}.elm`,
			"--output=/dev/null",
		],
		env: { GUIDA_REGISTRY: REGISTRY, HOME: HOME_DIR },
		stdout: (text) => {
			output += text;
		},
		stderr: (text) => {
			output += text;
		},
		...registry(join(elmDir, "packages")),
	});
	if (code !== 0) throw new Error(`Elm cache: compile failed.\n${output}`);
	const files = new Map([
		...fs.filesUnder(HOME_DIR),
		...fs.filesUnder(`${PROJECT_DIR}/${STUFF_DIR}`),
		...fs.filesUnder(`${PROJECT_DIR}/${SUPPORT_DIR}`),
	]);
	for (const path of files.keys()) {
		if (UNUSED.test(path)) files.delete(path);
	}
	return packFiles(files);
}
