/**
 * Writes src/api/registry/route-patterns.json, the list of URL patterns
 * `hook.ts` injects into Astro.
 *
 * The patterns are read from the live `ROUTES` registry rather than scraped out
 * of the source, so anything that registers a route — a bare `GET`/`POST` call
 * or a whole `CRUD()` block — is picked up the same way. `hook.ts` itself
 * cannot do this: it runs during `astro:config:setup`, where importing the API
 * modules pulls in Astro internals that are not ready yet. Hence this file.
 *
 * Every pattern is a literal inside `src/api/`, so the script skips the slow
 * import of the API modules when nothing there changed since the last run.
 * Pass `--force` to regenerate anyway.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inputsStamp } from "./lib/inputs-stamp";

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const apiDir = path.join(rootDir, "src", "api");
const outPath = path.join(apiDir, "registry", "route-patterns.json");
const stamp = inputsStamp(
	path.join(rootDir, "src", "generated", "route-patterns.hash"),
	{ paths: [apiDir], exclude: [outPath] },
	[outPath],
);
if (stamp.fresh && !process.argv.includes("--force")) {
	console.log("Route patterns are up to date");
	process.exit(0);
}

// This script only enumerates routes registered by importing the API modules
// below; it never reads DEVELOPMENT/PRODUCTION or anything derived from
// ENVIRONMENT, so which valid value it holds cannot change the output. Force
// it to "dev" here so the script runs standalone without the caller having to
// set it. A static import of `../src/api/registry/route` would be hoisted
// ahead of this assignment regardless of where it sits in the file, so the
// modules that pull in `src/core/constants.ts` are loaded with a dynamic
// `import()` instead, after the assignment has run.
process.env.ENVIRONMENT = "dev";

const { getRouteMapping } = await import("../src/api/registry/route");

// Importing this module imports every API module in turn, which is what
// populates the registry. Same trick as openapi-document.ts.
await import("../src/api/registry/dynamicHandler");

const routes = Object.entries(getRouteMapping())
	.map(([pattern, methods]) => ({
		pattern,
		methods: Object.keys(methods).sort(),
	}))
	.sort((a, b) => a.pattern.localeCompare(b.pattern));

writeFileSync(outPath, `${JSON.stringify(routes, null, "\t")}\n`);
stamp.write();
console.log(
	`Wrote ${path.relative(rootDir, outPath)} (${routes.length} patterns)`,
);
