/**
 * Astro integration that builds the sandbox bundle.
 */

import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { brotliCompress, gzip, constants as zlib } from "node:zlib";
import type { AstroIntegration } from "astro";
import { type BuildOptions, build, type Plugin } from "esbuild";
import { RUNTIMES, runtimeDir } from "../sandbox/runtimes";
import {
	BUNDLE_DIR_NAME,
	type ContentEncoding,
	DEV_BUNDLE_DIR,
	MANIFEST_NAME,
	PRECOMPRESSED,
} from "./assets";

/// Whether `file` may be part of the bundle: the sandbox, its entries,
/// the shared protocol, zod and acorn (to locate JavaScript syntax errors).
function isAllowed(root: string, file: string): boolean {
	const rel = resolve(root, "src", "runner");
	return (
		file.startsWith(join(rel, "sandbox") + sep) ||
		file.startsWith(join(rel, "server", "entries") + sep) ||
		file === join(rel, "protocol.ts") ||
		file.includes(`${sep}node_modules${sep}zod${sep}`) ||
		file.includes(`${sep}node_modules${sep}acorn${sep}`)
	);
}

/// esbuild plugin that fails the build on any import outside the allowed set.
function restrictImports(
	root: string,
	allowed: (file: string) => boolean = (file) => isAllowed(root, file),
	allowedText = "src/runner/sandbox/**, src/runner/protocol.ts, zod and acorn",
): Plugin {
	return {
		name: "runner-restrict-imports",
		setup(b) {
			b.onResolve({ filter: /.*/ }, async (args) => {
				if (args.kind === "entry-point" || args.pluginData?.skip) return null;
				const result = await b.resolve(args.path, {
					importer: args.importer,
					kind: args.kind,
					resolveDir: args.resolveDir,
					pluginData: { skip: true },
				});
				if (result.errors.length > 0) return result;
				if (!allowed(result.path)) {
					return {
						errors: [
							{
								text: `The runner bundle may import only ${allowedText}; got "${args.path}" (${result.path}).`,
							},
						],
					};
				}
				return result;
			});
		},
	};
}

/// Lists the files under `dir`, relative to it, sorted.
function listFiles(dir: string): string[] {
	return (
		readdirSync(dir, { recursive: true, withFileTypes: true }) as never as {
			name: string;
			parentPath: string;
			isFile(): boolean;
		}[]
	)
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
		.sort();
}

/// Packages whose files a runtime module may bundle: sucrase and the
/// dependencies its `transform` reaches (not its CLI ones: commander, glob, mz).
const MODULE_PACKAGES = [
	"sucrase",
	"ts-interface-checker",
	"lines-and-columns",
	"@jridgewell",
];

/**
 * Bundles `exports` of the module `source` into the ES module `outfile`, minified.
 *
 * Fails on any import that is not a file of `MODULE_PACKAGES`.
 */
export async function buildModule(
	root: string,
	source: string,
	exports: string[],
	outfile: string,
): Promise<void> {
	await build({
		stdin: {
			contents: `export { ${exports.join(", ")} } from ${JSON.stringify(source)};`,
			resolveDir: dirname(source),
		},
		outfile,
		bundle: true,
		format: "esm",
		platform: "browser",
		target: "es2022",
		minify: true,
		logLevel: "silent",
		plugins: [
			restrictImports(
				root,
				(file) =>
					MODULE_PACKAGES.some((pkg) =>
						file.includes(`${sep}node_modules${sep}${pkg}${sep}`),
					),
				MODULE_PACKAGES.join(", "),
			),
		],
	});
}

/// Copies the files of `RUNTIMES` from `node_modules` into `<staging>/rt/`,
/// checking the installed version, and wraps the glue that is not an ES module.
async function copyRuntimes(root: string, staging: string): Promise<void> {
	for (const runtime of Object.values(RUNTIMES)) {
		const pkgDir = join(root, "node_modules", runtime.pkg);
		const installed = JSON.parse(
			readFileSync(join(pkgDir, "package.json"), "utf8"),
		).version;
		if (installed !== runtime.version) {
			throw new Error(
				`${runtime.pkg} ${installed} is installed but RUNTIMES lists ${runtime.version}.`,
			);
		}
		const target = join(staging, "rt", runtimeDir(runtime));
		mkdirSync(target, { recursive: true });
		for (const [from, to] of Object.entries(runtime.files)) {
			const wrap = runtime.wrap?.[to];
			const only = runtime.bundle?.[to];
			if (only) {
				await buildModule(root, join(pkgDir, from), only, join(target, to));
			} else if (wrap) {
				writeFileSync(
					join(target, to),
					(wrap.prefix ?? "") +
						readFileSync(join(pkgDir, from), "utf8") +
						(wrap.suffix ?? ""),
				);
			} else {
				copyFileSync(join(pkgDir, from), join(target, to));
			}
		}
	}
}

/// Files smaller than this are sent as they are.
const MIN_COMPRESS_SIZE = 1024;

/// A compressed copy is kept only when it is at most this fraction of the
/// original; archives such as `python_stdlib.zip` barely shrink.
const MAX_COMPRESS_RATIO = 0.9;

/// Compresses `data` as `encoding` at the highest level.
async function compress(
	data: Buffer,
	encoding: ContentEncoding,
): Promise<Buffer> {
	if (encoding === "gzip") return promisify(gzip)(data, { level: 9 });
	return promisify(brotliCompress)(data, {
		params: {
			[zlib.BROTLI_PARAM_QUALITY]: zlib.BROTLI_MAX_QUALITY,
			[zlib.BROTLI_PARAM_SIZE_HINT]: data.length,
		},
	});
}

/**
 * Writes a `.br` and a `.gz` copy next to each file under `dir` that
 * compresses well, for the runner endpoint to send to clients that accept them.
 *
 * Brotli at its highest quality takes about 25 s for the runtimes, so each
 * copy is cached in `cacheDir` under the hash of the original; a build with
 * the same runtimes reuses them.
 */
export async function precompress(
	dir: string,
	cacheDir: string,
): Promise<void> {
	mkdirSync(cacheDir, { recursive: true });
	await Promise.all(
		listFiles(dir).map(async (file) => {
			const path = join(dir, file);
			const data = readFileSync(path);
			if (data.length < MIN_COMPRESS_SIZE) return;
			const hash = createHash("sha256").update(data).digest("hex");
			for (const { encoding, extension } of PRECOMPRESSED) {
				const cached = join(cacheDir, hash + extension);
				let out: Buffer;
				if (existsSync(cached)) {
					out = readFileSync(cached);
				} else {
					out = await compress(data, encoding);
					writeFileSync(`${cached}.tmp`, out);
					renameSync(`${cached}.tmp`, cached);
				}
				if (out.length <= data.length * MAX_COMPRESS_RATIO) {
					writeFileSync(path + extension, out);
				}
			}
		}),
	);
}

/** How `buildRunnerBundle` builds. */
export interface BundleOptions {
	minify: boolean;
	/// Where `precompress` caches its output; without it, nothing is compressed.
	compressCache?: string;
}

/**
 * Builds the sandbox bundle for `root` into `outDir`, replacing what is there.
 *
 * Writes `frame.js`, `worker.js` (ES modules sharing chunks), `sw.js` (one
 * self-contained script, since it is not served from the versioned directory)
 * and `manifest.json` with the content hash and the file list. Runtime files
 * go to `rt/`, outside both: their own path carries the version. With
 * `compressCache`, each file also gets its `precompress` copies.
 *
 * @throws {Error} when the bundle imports anything outside the allowed set.
 */
export async function buildRunnerBundle(
	root: string,
	outDir: string,
	{ minify, compressCache }: BundleOptions,
): Promise<void> {
	const entries = join(root, "src", "runner", "server", "entries");
	const staging = `${outDir}.tmp`;
	rmSync(staging, { recursive: true, force: true });
	mkdirSync(staging, { recursive: true });
	const common = {
		absWorkingDir: root,
		bundle: true,
		platform: "browser",
		target: "es2022",
		minify,
		tsconfigRaw: "{}",
		logLevel: "silent",
		plugins: [restrictImports(root)],
	} satisfies BuildOptions;
	try {
		await build({
			...common,
			entryPoints: [join(entries, "frame.ts"), join(entries, "worker.ts")],
			outdir: staging,
			format: "esm",
			splitting: true,
			chunkNames: "[name]-[hash]",
		});
		await build({
			...common,
			entryPoints: [join(entries, "sw.ts")],
			outfile: join(staging, "sw.js"),
			format: "iife",
		});
		const files = listFiles(staging);
		const hash = createHash("sha256");
		for (const file of files) {
			hash.update(file);
			hash.update(readFileSync(join(staging, file)));
		}
		const version = hash.digest("hex").slice(0, 12);
		writeFileSync(
			join(staging, MANIFEST_NAME),
			JSON.stringify({ version, files }),
		);
		await copyRuntimes(root, staging);
		if (compressCache) await precompress(staging, compressCache);
		rmSync(outDir, { recursive: true, force: true });
		mkdirSync(dirname(outDir), { recursive: true });
		renameSync(staging, outDir);
	} catch (error) {
		rmSync(staging, { recursive: true, force: true });
		throw error;
	}
}

/**
 * Builds `src/runner/sandbox/` with esbuild into its own directory: entries
 * `frame.js`, `worker.js` (module Worker) and `sw.js`, plus driver chunks.
 *
 * `astro build` writes it next to the server build so a packaged release
 * carries it; `astro dev` rebuilds it on change. The bundle may import only
 * `src/runner/protocol.ts`, `src/runner/sandbox/**` and `zod`; the build fails
 * on any other import from `src/`.
 */
export function runnerBundle(): AstroIntegration {
	let root = "";
	let outDir = "";
	return {
		name: "runner-bundle",
		hooks: {
			"astro:config:done": ({ config }) => {
				root = fileURLToPath(config.root);
				outDir = fileURLToPath(config.outDir);
			},
			"astro:server:setup": async ({ server, logger }) => {
				const target = join(root, DEV_BUNDLE_DIR);
				const rebuild = async () => {
					try {
						await buildRunnerBundle(root, target, { minify: false });
					} catch (error) {
						logger.error(
							`Runner bundle: ${error instanceof Error ? error.message : error}`,
						);
					}
				};
				await rebuild();
				const watched = [
					join(root, "src", "runner", "sandbox") + sep,
					join(root, "src", "runner", "server", "entries") + sep,
					join(root, "src", "runner", "protocol.ts"),
				];
				let timer: NodeJS.Timeout | undefined;
				const onChange = (file: string) => {
					if (!watched.some((path) => file.startsWith(path))) return;
					clearTimeout(timer);
					timer = setTimeout(rebuild, 100);
				};
				server.watcher.on("change", onChange);
				server.watcher.on("add", onChange);
				server.watcher.on("unlink", onChange);
			},
			"astro:build:done": async () => {
				await buildRunnerBundle(root, join(outDir, BUNDLE_DIR_NAME), {
					minify: true,
					compressCache: join(root, "node_modules", ".cache", "runner-bundle"),
				});
			},
		},
	};
}
