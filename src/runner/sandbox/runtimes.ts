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
	/// Text put before and after a file (keyed by its destination path) at
	/// build, for glue that is a classic script or UMD and has to become an
	/// ES module the Worker can import.
	wrap?: Record<string, { prefix?: string; suffix?: string }>;
	/// Destination files the build bundles into one ES module from the source
	/// file in `files`, keeping only the listed exports: for packages whose
	/// entry drags in code the Worker has no use for.
	bundle?: Record<string, string[]>;
}

export const RUNTIMES: {
	swipl: RuntimePackage;
	pyodide: RuntimePackage;
	wasmoon: RuntimePackage;
	sucrase: RuntimePackage;
} = {
	swipl: {
		pkg: "swipl-wasm",
		version: "8.2.6",
		files: {
			"dist/swipl/swipl-web.js": "swipl-web.js",
			"dist/swipl/swipl-web.wasm": "swipl-web.wasm",
			"dist/swipl/swipl-web.data": "swipl-web.data",
		},
		wrap: { "swipl-web.js": { suffix: "\nexport default SWIPL;\n" } },
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
	wasmoon: {
		pkg: "wasmoon",
		version: "1.16.0",
		files: {
			"dist/index.js": "wasmoon.js",
			"dist/glue.wasm": "glue.wasm",
		},
		// UMD: with `exports` and `module` defined it fills `exports` instead of a global.
		wrap: {
			"wasmoon.js": {
				prefix: "const exports = {}, module = {};\n",
				suffix: "\nexport default exports;\n",
			},
		},
	},
	sucrase: {
		pkg: "sucrase",
		version: "3.35.1",
		files: { "dist/esm/index.js": "sucrase.mjs" },
		bundle: { "sucrase.mjs": ["transform"] },
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
