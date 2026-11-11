import type { RuntimePackage } from "@codehood/runner-api/driver";

/** Lua 5.4 compiled to WebAssembly. */
export const wasmoon: RuntimePackage = {
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
};
