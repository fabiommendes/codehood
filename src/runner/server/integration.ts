/**
 * Astro integration that builds the sandbox bundle.
 */

import { createHash } from "node:crypto";
import {
	copyFileSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import { type BuildOptions, build, buildSync, type Plugin } from "esbuild";
import { RUNTIMES, runtimeDir } from "../sandbox/runtimes";
import { BUNDLE_DIR_NAME, DEV_BUNDLE_DIR, MANIFEST_NAME } from "./assets";

/// Whether `file` may be part of the bundle: the sandbox, its entries,
/// the shared protocol and zod.
function isAllowed(root: string, file: string): boolean {
	const rel = resolve(root, "src", "runner");
	return (
		file.startsWith(join(rel, "sandbox") + sep) ||
		file.startsWith(join(rel, "server", "entries") + sep) ||
		file === join(rel, "protocol.ts") ||
		file.includes(`${sep}node_modules${sep}zod${sep}`)
	);
}

/// esbuild plugin that fails the build on any import outside the allowed set.
function restrictImports(root: string): Plugin {
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
				if (!isAllowed(root, result.path)) {
					return {
						errors: [
							{
								text: `The runner bundle may import only src/runner/sandbox/**, src/runner/protocol.ts and zod; got "${args.path}" (${result.path}).`,
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

/// Bundles `exports` of the module `source` into the ES module `outfile`, minified.
function buildModule(source: string, exports: string[], outfile: string): void {
	buildSync({
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
	});
}

/// Copies the files of `RUNTIMES` from `node_modules` into `<staging>/rt/`,
/// checking the installed version, and wraps the glue that is not an ES module.
function copyRuntimes(root: string, staging: string): void {
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
				buildModule(join(pkgDir, from), only, join(target, to));
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

/**
 * Builds the sandbox bundle for `root` into `outDir`, replacing what is there.
 *
 * Writes `frame.js`, `worker.js` (ES modules sharing chunks), `sw.js` (one
 * self-contained script, since it is not served from the versioned directory)
 * and `manifest.json` with the content hash and the file list. Runtime files
 * go to `rt/`, outside both: their own path carries the version.
 *
 * @throws {Error} when the bundle imports anything outside the allowed set.
 */
export async function buildRunnerBundle(
	root: string,
	outDir: string,
	minify: boolean,
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
		copyRuntimes(root, staging);
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
						await buildRunnerBundle(root, target, false);
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
				await buildRunnerBundle(root, join(outDir, BUNDLE_DIR_NAME), true);
			},
		},
	};
}
