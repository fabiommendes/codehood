/**
 * Bundles the management CLI (`src/commands/`) into `dist/manage.mjs`, so a
 * deployed instance runs it with plain `node` instead of `tsx` and sources.
 *
 * Packages stay external and load from `node_modules`. `astro:env/client` is
 * resolved here the same way Astro bakes it into the server build: from the
 * build-time `SERVER_TZ`, falling back to the schema default.
 */
import { build } from "esbuild";
import { SERVER_TZ } from "../test/astro-env-client";

await build({
	entryPoints: ["src/commands/index.ts"],
	outfile: "dist/manage.mjs",
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	packages: "external",
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
