/**
 * The fixed Elm project every run compiles in, and the file that carries its
 * package cache.
 *
 * Shared by the Elm driver (in the Worker) and by the build, which compiles
 * the packages once and ships the result as `ELM_CACHE_FILE`.
 */

/** An Elm package the runner provides, at a fixed version. */
export interface ElmPackage {
	readonly name: string;
	readonly version: string;
	/// Whether students import it; the others are only dependencies of these.
	readonly direct: boolean;
}

/// Packages a program may import. `elm/html` and `elm/virtual-dom` are here
/// only because `elm-explorations/test` depends on them.
export const ELM_PACKAGES: readonly ElmPackage[] = [
	{ name: "elm/core", version: "1.0.5", direct: true },
	{ name: "elm/json", version: "1.1.4", direct: true },
	{ name: "elm/random", version: "1.0.0", direct: true },
	{ name: "elm/parser", version: "1.1.0", direct: true },
	{ name: "elm/regex", version: "1.0.0", direct: true },
	{ name: "elm/time", version: "1.0.0", direct: true },
	{ name: "elm/bytes", version: "1.0.8", direct: true },
	{ name: "elm-explorations/test", version: "2.2.1", direct: true },
	{ name: "elm/html", version: "1.0.1", direct: false },
	{ name: "elm/virtual-dom", version: "1.0.5", direct: false },
];

/// Root of the project in the compiler's in-memory file system.
export const PROJECT_DIR = "/work";

/// Directory, relative to `PROJECT_DIR`, of the student's files.
export const SOURCE_DIR = "src";

/// Directory, relative to `PROJECT_DIR`, of the modules the driver adds (the
/// test reporter); shipped in the cache, never written by a run.
export const SUPPORT_DIR = "codehood";

/// Home directory the compiler keeps its package cache under (`~/.guida`).
export const HOME_DIR = "/home";

/// Directory, relative to `PROJECT_DIR`, where the compiler keeps the
/// project's build artifacts.
export const STUFF_DIR = "guida-stuff";

/// Module the driver generates to run a suite; never one of the student's.
export const TEST_MAIN_MODULE = "CodehoodTestMain";

/**
 * Source of the module that runs `tests` of `module`, written to `SOURCE_DIR`.
 *
 * With `json`, the suite reports as JSON (`Codehood.Test.Runner.runJson`)
 * instead of terminal text.
 */
export function testMainSource(module: string, json = false): string {
	return [
		`module ${TEST_MAIN_MODULE} exposing (main)`,
		"",
		"import Codehood.Test.Runner",
		`import ${module}`,
		"",
		"",
		`main = Codehood.Test.Runner.${json ? "runJson" : "run"} ${module}.tests`,
		"",
	].join("\n");
}

/** The `elm.json` of the project, as the compiler reads it. */
export function elmJson(): string {
	const pick = (direct: boolean) =>
		Object.fromEntries(
			ELM_PACKAGES.filter((p) => p.direct === direct).map((p) => [
				p.name,
				p.version,
			]),
		);
	return JSON.stringify(
		{
			type: "application",
			"source-directories": [SOURCE_DIR, SUPPORT_DIR],
			"elm-version": "0.19.1",
			dependencies: { direct: pick(true), indirect: pick(false) },
			"test-dependencies": { direct: {}, indirect: {} },
		},
		null,
		4,
	);
}

/// 32-bit FNV-1a of `text`, in hex.
function fnv1a(text: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Directory of the cache under `/runner/rt/`.
 *
 * Changes with the compiler version and with the package list, so a browser
 * never mixes a cache with a compiler it was not built by.
 */
export function elmCacheDir(compilerVersion: string): string {
	return `elm-cache@${compilerVersion}-${fnv1a(elmJson())}`;
}

/// Name of the cache file inside `elmCacheDir`.
export const ELM_CACHE_FILE = "elm-cache.bin";

/**
 * Packs `files` (absolute path to bytes) into one buffer.
 *
 * Layout: a little-endian u32 with the byte length of a UTF-8 JSON header
 * `[[path, size], ...]`, the header, then the contents in header order.
 */
export function packFiles(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
	const paths = [...files.keys()].sort();
	const header = new TextEncoder().encode(
		JSON.stringify(paths.map((p) => [p, files.get(p)?.length ?? 0])),
	);
	let total = 4 + header.length;
	for (const p of paths) total += files.get(p)?.length ?? 0;
	const out = new Uint8Array(total);
	new DataView(out.buffer).setUint32(0, header.length, true);
	out.set(header, 4);
	let offset = 4 + header.length;
	for (const p of paths) {
		const data = files.get(p) ?? new Uint8Array(0);
		out.set(data, offset);
		offset += data.length;
	}
	return out;
}

/**
 * Unpacks what `packFiles` packed.
 *
 * @throws {Error} when the buffer is truncated or its header is not valid.
 */
export function unpackFiles(data: Uint8Array): Map<string, Uint8Array> {
	if (data.length < 4) throw new Error("Elm cache: truncated file.");
	const length = new DataView(
		data.buffer,
		data.byteOffset,
		data.byteLength,
	).getUint32(0, true);
	const header = JSON.parse(
		new TextDecoder().decode(data.subarray(4, 4 + length)),
	) as [string, number][];
	const files = new Map<string, Uint8Array>();
	let offset = 4 + length;
	for (const [path, size] of header) {
		if (offset + size > data.length) {
			throw new Error("Elm cache: truncated file.");
		}
		files.set(path, data.subarray(offset, offset + size));
		offset += size;
	}
	return files;
}
