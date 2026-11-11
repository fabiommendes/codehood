import type { RuntimePackage } from "@codehood/runner-api/driver";

/** CPython compiled to WebAssembly. */
export const pyodide: RuntimePackage = {
	pkg: "pyodide",
	version: "314.0.7",
	files: {
		"pyodide.mjs": "pyodide.mjs",
		"pyodide.asm.mjs": "pyodide.asm.mjs",
		"pyodide.asm.wasm": "pyodide.asm.wasm",
		"python_stdlib.zip": "python_stdlib.zip",
		"pyodide-lock.json": "pyodide-lock.json",
	},
};
