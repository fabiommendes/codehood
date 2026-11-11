/**
 * Runtime packages of the runner plugins that ship with Codehood.
 *
 * A plugin lists the ones it needs in `runtimes`; the bundle carries and
 * serves under `/runner/rt/` those of the plugins in `runner.languages`.
 * Drivers import them here for the paths.
 */

import type { RuntimePackage } from "@codehood/runner-api/driver";

/** The runtime packages of the plugins under `src/runner/plugins/`. */
export const RUNTIMES: {
	swipl: RuntimePackage;
	pyodide: RuntimePackage;
	wasmoon: RuntimePackage;
	sucrase: RuntimePackage;
	guida: RuntimePackage;
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
	guida: {
		pkg: "guida",
		version: "1.0.0-beta.2",
		files: { "bin/guida.min.js": "guida.mjs" },
		// A classic script that defines `Elm` on its `this`.
		wrap: {
			"guida.mjs": {
				prefix: "const scope = {};\n(function () {\n",
				suffix: "\n}).call(scope);\nexport default scope.Elm;\n",
			},
		},
	},
};
