import type { RuntimePackage } from "@codehood/runner-api/driver";

/** The Elm compiler (Guida), as an ES module. */
export const guida: RuntimePackage = {
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
};
