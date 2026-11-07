/**
 * Runtime packages the runner bundle carries and serves under `/runner/rt/`.
 *
 * Shared by the sandbox (paths) and the build and the asset server (files).
 */

/** A runtime package copied into the runner bundle. */
export interface RuntimePackage {
	/// npm package name and exact version, as in package.json.
	pkg: string;
	version: string;
	/// Files copied from the package, relative to its root, and the path
	/// each gets under `/runner/rt/<pkg>@<version>/`.
	files: Record<string, string>;
}

/// Appended to `swipl-web.js` at build: it is a classic script, and the
/// module Worker imports it as an ES module.
export const SWIPL_MODULE_SUFFIX = "\nexport default SWIPL;\n";

export const RUNTIMES: { swipl: RuntimePackage; pyodide: RuntimePackage } = {
	swipl: {
		pkg: "swipl-wasm",
		version: "8.2.6",
		files: {
			"dist/swipl/swipl-web.js": "swipl-web.js",
			"dist/swipl/swipl-web.wasm": "swipl-web.wasm",
			"dist/swipl/swipl-web.data": "swipl-web.data",
		},
	},
	pyodide: {
		pkg: "pyodide",
		version: "314.0.7",
		files: {
			"pyodide.mjs": "pyodide.mjs",
			"pyodide.asm.mjs": "pyodide.asm.mjs",
			"pyodide.asm.wasm": "pyodide.asm.wasm",
			"python_stdlib.zip": "python_stdlib.zip",
			"pyodide-lock.json": "pyodide-lock.json",
		},
	},
};

/** Directory of a runtime under `/runner/rt/`, e.g. `pyodide@314.0.7`. */
export function runtimeDir(runtime: RuntimePackage): string {
	return `${runtime.pkg}@${runtime.version}`;
}

/** Path of a runtime file under `/runner/rt/`, e.g. `pyodide@314.0.7/pyodide.mjs`. */
export function runtimePath(runtime: RuntimePackage, file: string): string {
	return `${runtimeDir(runtime)}/${file}`;
}
