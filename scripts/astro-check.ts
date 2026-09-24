/**
 * Typechecks `.astro` files, which `tsc` does not read.
 *
 * `astro check` loads the programmatic TypeScript API, which TypeScript 7 does
 * not ship yet. This runs the same checker with every `require("typescript")`
 * made by the checker redirected to the `typescript-6` alias. Drop it for
 * `astro check` once that supports TypeScript 7.
 *
 * Only errors are reported, and any error makes the script exit with 1.
 */

import Module, { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const ts6Main = require.resolve("typescript-6");
/// The root of the TypeScript 6 package, for requests like `typescript/lib/...`.
const ts6Root = path.dirname(path.dirname(ts6Main));

type Resolver = (request: string, ...rest: unknown[]) => string;
const internals = Module as unknown as { _resolveFilename: Resolver };
const resolve = internals._resolveFilename;
internals._resolveFilename = function (this: unknown, request, ...rest) {
	if (request === "typescript") return ts6Main;
	if (request.startsWith("typescript/")) {
		return resolve.call(
			this,
			path.join(ts6Root, request.slice("typescript/".length)),
			...rest,
		);
	}
	return resolve.call(this, request, ...rest);
};

// Loaded only after the redirect is in place.
const { AstroCheck } =
	require("@astrojs/language-server") as typeof import("@astrojs/language-server");

const checker = new AstroCheck(process.cwd(), ts6Main, undefined);
const result = await checker.lint({ logErrors: { level: "error" } });
console.info(
	`astro-check: ${result.fileChecked} files, ${result.errors} errors`,
);
process.exit(result.errors > 0 ? 1 : 0);
