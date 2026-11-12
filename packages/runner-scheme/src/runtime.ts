import type { RuntimePackage } from "@codehood/runner-api/driver";

/**
 * BiwaScheme, an R7RS Scheme interpreter in JavaScript.
 *
 * Its browser build reads `window` and `document` when it loads (jQuery
 * glue, `<script type="text/biwascheme">` tags); in a Worker neither exists,
 * so the module gets stand-ins that find nothing.
 */
export const biwascheme: RuntimePackage = {
	pkg: "biwascheme",
	version: "0.8.3",
	files: { "release/biwascheme.mjs": "biwascheme.mjs" },
	wrap: {
		"biwascheme.mjs": {
			prefix: [
				"const window = { console, addEventListener() {} };",
				"const document = { querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}) };",
				"",
			].join("\n"),
		},
	},
};
