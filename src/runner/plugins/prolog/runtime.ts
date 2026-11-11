import type { RuntimePackage } from "@codehood/runner-api/driver";

/** SWI-Prolog compiled to WebAssembly. */
export const swipl: RuntimePackage = {
	pkg: "swipl-wasm",
	version: "8.2.6",
	files: {
		"dist/swipl/swipl-web.js": "swipl-web.js",
		"dist/swipl/swipl-web.wasm": "swipl-web.wasm",
		"dist/swipl/swipl-web.data": "swipl-web.data",
	},
	wrap: { "swipl-web.js": { suffix: "\nexport default SWIPL;\n" } },
};
