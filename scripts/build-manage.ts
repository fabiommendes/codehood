/**
 * Bundles the management CLI (`src/commands/`) into `dist/manage.mjs` (or the
 * path given as the first argument), so a
 * deployed instance runs it with plain `node` instead of `tsx` and sources.
 *
 * Only `dependencies` stay external and load from `node_modules`, the only
 * packages a production install has; everything else (the linked `mdq`, for
 * one) is bundled in. `astro:env/client` is
 * resolved here the same way Astro bakes it into the server build: from the
 * build-time `SERVER_TZ`, falling back to the schema default.
 */
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { SERVER_TZ } from "../test/astro-env-client";

/// What `pnpm install --prod` puts in `node_modules`; subpaths follow.
const dependencies = Object.keys(
	JSON.parse(readFileSync("package.json", "utf8")).dependencies ?? {},
);

await build({
	entryPoints: ["src/commands/index.ts"],
	outfile: process.argv[2] ?? "dist/manage.mjs",
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	external: dependencies,
	tsconfig: "tsconfig.json",
	logLevel: "warning",
	plugins: [
		{
			name: "astro-env-client",
			setup(pluginBuild) {
				pluginBuild.onResolve({ filter: /^astro:env\/client$/ }, () => ({
					path: "astro:env/client",
					namespace: "astro-env",
				}));
				pluginBuild.onLoad({ filter: /.*/, namespace: "astro-env" }, () => ({
					contents: `export const SERVER_TZ = ${JSON.stringify(process.env.SERVER_TZ || SERVER_TZ)};`,
					loader: "js",
				}));
			},
		},
	],
});
