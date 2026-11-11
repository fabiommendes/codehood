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
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { brotliCompress, gzip, constants as zlib } from "node:zlib";
import {
	type BuildStep,
	type RunnerPlugin,
	runtimeDir,
} from "@codehood/runner-api";
import type { AstroIntegration } from "astro";
import { type BuildOptions, build, type Plugin } from "esbuild";
import { tsImport } from "tsx/esm/api";
import { driversModule, pluginRuntimes, resolveSpecifier } from "../registry";
import {
	BUNDLE_DIR_NAME,
	type ContentEncoding,
	DEV_BUNDLE_DIR,
	MANIFEST_NAME,
	PRECOMPRESSED,
} from "./layout";

/// Namespace of the generated `codehood:runner-drivers` module.
const DRIVERS_NAMESPACE = "runner-drivers";

/// Absolute path of the module a plugin specifier points at.
function modulePath(root: string, specifier: string): string {
	const resolved = resolveSpecifier(root, specifier);
	return isAbsolute(resolved)
		? resolved
		: createRequire(join(root, "package.json")).resolve(resolved);
}

/// Directories a plugin's driver may import from: its own directory, and
/// each package in `sandboxDependencies`.
function pluginDirs(root: string, plugin: RunnerPlugin): string[] {
	return [
		dirname(modulePath(root, plugin.driver)) + sep,
		...plugin.sandboxDependencies.map(
			(pkg) => `${sep}node_modules${sep}${pkg.replaceAll("/", sep)}${sep}`,
		),
	];
}

/// Files of `@codehood/runner-api` the sandbox may bundle: the entries
/// `./driver` and `./schema`, not the plugin descriptor. Resolved from
/// Codehood's own dependencies, which is where `protocol.ts` imports them.
function apiFiles(): string[] {
	const require = createRequire(import.meta.url);
	return ["driver", "schema"].map((entry) =>
		realpathSync(require.resolve(`@codehood/runner-api/${entry}`)),
	);
}

/// Whether `file` may be part of the bundle: the sandbox, its entries, the
/// shared protocol, the driver side of the plugin contract, zod, and what
/// each plugin's driver may import.
function isAllowed(
	root: string,
	plugins: readonly RunnerPlugin[],
): (file: string) => boolean {
	const rel = resolve(root, "src", "runner");
	const api = apiFiles();
	const dirs = plugins.flatMap((plugin) => pluginDirs(root, plugin));
	return (file) =>
		file.startsWith(join(rel, "sandbox") + sep) ||
		file.startsWith(join(rel, "server", "entries") + sep) ||
		file === join(rel, "protocol.ts") ||
		api.includes(file) ||
		file.includes(`${sep}node_modules${sep}zod${sep}`) ||
		dirs.some((dir) =>
			dir.startsWith(`${sep}node_modules`)
				? file.includes(dir)
				: file.startsWith(dir),
		);
}

/// esbuild plugin that serves `codehood:runner-drivers`: a loader of each
/// plugin's driver.
function runnerDrivers(root: string, plugins: readonly RunnerPlugin[]): Plugin {
	return {
		name: "runner-drivers",
		setup(b) {
			b.onResolve({ filter: /^codehood:runner-drivers$/ }, () => ({
				path: "codehood:runner-drivers",
				namespace: DRIVERS_NAMESPACE,
			}));
			b.onLoad({ filter: /.*/, namespace: DRIVERS_NAMESPACE }, () => ({
				contents: driversModule(plugins, root),
				loader: "js",
				resolveDir: root,
			}));
		},
	};
}

/// esbuild plugin that fails the build on any import outside the allowed set.
function restrictImports(
	allowed: (file: string) => boolean,
	allowedText: string,
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
				if (result.namespace === DRIVERS_NAMESPACE) return result;
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
				(file) =>
					MODULE_PACKAGES.some((pkg) =>
						file.includes(`${sep}node_modules${sep}${pkg}${sep}`),
					),
				MODULE_PACKAGES.join(", "),
			),
		],
	});
}

/// Copies the runtime files of `plugins` from `node_modules` into
/// `<staging>/rt/`, checking the installed version, and wraps the glue that
/// is not an ES module.
async function copyRuntimes(
	root: string,
	plugins: readonly RunnerPlugin[],
	staging: string,
): Promise<void> {
	for (const runtime of pluginRuntimes(plugins)) {
		const pkgDir = join(root, "node_modules", runtime.pkg);
		const installed = JSON.parse(
			readFileSync(join(pkgDir, "package.json"), "utf8"),
		).version;
		if (installed !== runtime.version) {
			throw new Error(
				`${runtime.pkg} ${installed} is installed but a runner plugin lists ${runtime.version}.`,
			);
		}
		const target = join(staging, "rt", runtimeDir(runtime));
		mkdirSync(target, { recursive: true });
		for (const [from, to] of Object.entries(runtime.files)) {
			const wrap = runtime.wrap?.[to];
			const only = runtime.bundle?.[to];
			if (only) {
				await buildModule(join(pkgDir, from), only, join(target, to));
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

/// Runs the `build` step of each plugin that has one, writing what it emits
/// into `staging`.
async function runBuildSteps(
	root: string,
	plugins: readonly RunnerPlugin[],
	staging: string,
): Promise<void> {
	for (const plugin of plugins) {
		if (!plugin.build) continue;
		const module = modulePath(root, plugin.build);
		const loaded = (await tsImport(
			pathToFileURL(module).href,
			import.meta.url,
		)) as { default?: BuildStep };
		if (typeof loaded.default !== "function") {
			throw new Error(
				`The build module of runner plugin "${plugin.id}" (${module}) must default-export a function.`,
			);
		}
		await loaded.default({
			root,
			cacheDir: join(root, "node_modules", ".cache", `runner-${plugin.id}`),
			emit(name, data) {
				const target = join(staging, name);
				if (!target.startsWith(staging + sep)) {
					throw new Error(
						`Runner plugin "${plugin.id}" emitted "${name}", outside the bundle.`,
					);
				}
				mkdirSync(dirname(target), { recursive: true });
				writeFileSync(target, data);
			},
		});
	}
}

/** How `buildRunnerBundle` builds. */
export interface BundleOptions {
	minify: boolean;
	/// Languages the bundle runs, besides `fake`.
	plugins?: readonly RunnerPlugin[];
	/// Where `precompress` caches its output; without it, nothing is compressed.
	compressCache?: string;
}

/**
 * Builds the sandbox bundle for `root` into `outDir`, replacing what is there.
 *
 * Writes `frame.js`, `worker.js` (ES modules sharing chunks), `sw.js` (one
 * self-contained script, since it is not served from the versioned directory),
 * what the plugins' build steps emit (versioned with the code that reads it)
 * and `manifest.json` with the content hash and the file list. Runtime files
 * go to `rt/`, outside both: their own path carries the version. With
 * `compressCache`, each file also gets its `precompress` copies.
 *
 * @throws {Error} when the bundle imports anything outside the allowed set.
 */
export async function buildRunnerBundle(
	root: string,
	outDir: string,
	{ minify, compressCache, plugins = [] }: BundleOptions,
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
		plugins: [
			restrictImports(
				isAllowed(root, plugins),
				"src/runner/sandbox/**, src/runner/protocol.ts, @codehood/runner-api/driver, zod and the runner plugins' own files and sandboxDependencies",
			),
			runnerDrivers(root, plugins),
		],
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
		await runBuildSteps(root, plugins, staging);
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
		await copyRuntimes(root, plugins, staging);
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
 * carries it; `astro dev` rebuilds it on change. It carries the drivers of
 * `plugins` (`runner.languages`). The bundle may import only
 * `src/runner/protocol.ts`, `src/runner/sandbox/**`,
 * `@codehood/runner-api/driver`, `zod` and each plugin's
 * driver directory and `sandboxDependencies`; the build fails on any other
 * import.
 */
export function runnerBundle(
	plugins: readonly RunnerPlugin[],
): AstroIntegration {
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
						await buildRunnerBundle(root, target, { minify: false, plugins });
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
					...plugins.flatMap((plugin) =>
						[plugin.driver, plugin.build]
							.filter((module) => module !== undefined)
							.map((module) => dirname(modulePath(root, module)) + sep),
					),
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
					plugins,
					compressCache: join(root, "node_modules", ".cache", "runner-bundle"),
				});
			},
		},
	};
}
