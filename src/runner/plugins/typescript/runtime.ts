import type { RuntimePackage } from "@codehood/runner-api/driver";

/** The TypeScript transform, bundled down to `transform`. */
export const sucrase: RuntimePackage = {
	pkg: "sucrase",
	version: "3.35.1",
	files: { "dist/esm/index.js": "sucrase.mjs" },
	bundle: { "sucrase.mjs": ["transform"] },
};
