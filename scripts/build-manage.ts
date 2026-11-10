/**
 * Bundles the management CLI (`src/commands/`) into `dist/manage.mjs` (or the
 * path given as the first argument), so a
 * deployed instance runs it with plain `node` instead of `tsx` and sources.
 *
 * Only `dependencies` stay external and load from `node_modules`, the only
 * packages a production install has; everything else (the linked `mdq`, for
 * one) is bundled in. `codehood:config` and `codehood:build` resolve as in
 * the Astro build: to the configuration file (`CODEHOOD_CONFIG`), evaluated
 * again when the CLI starts, and to the build-time constants it holds.
 */
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { loadConfig } from "../src/config/integration";
import { configPath } from "../src/config/path";

const configFile = configPath(process.cwd(), process.env);
const config = await loadConfig(configFile);

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
			name: "codehood-config",
			setup(pluginBuild) {
				pluginBuild.onResolve({ filter: /^codehood:config$/ }, () => ({
					path: configFile,
				}));
				pluginBuild.onResolve({ filter: /^codehood:build$/ }, () => ({
					path: "codehood:build",
					namespace: "codehood-build",
				}));
				pluginBuild.onLoad(
					{ filter: /.*/, namespace: "codehood-build" },
					() => ({
						contents: `export const timeZone = ${JSON.stringify(config.instance.timeZone)};`,
						loader: "js",
					}),
				);
			},
		},
	],
});
