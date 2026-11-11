/**
 * Loads `codehood.config.ts` for the Astro build and makes it importable.
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import type { AstroIntegration } from "astro";
import { runnersModule } from "../runner/registry";
import type { CodehoodConfig } from ".";

/// Id Vite gives the virtual module of build-time constants.
const BUILD_MODULE = "\0codehood:build";

/// Id Vite gives the virtual module of the runner registry.
const RUNNERS_MODULE = "\0codehood:runners";

/**
 * Imports and validates the configuration file at `file`.
 *
 * @throws {Error} when the file is missing, does not default-export a
 * configuration, or holds an invalid one.
 */
export async function loadConfig(file: string): Promise<CodehoodConfig> {
	// Loaded through Vite when the Astro config imports this module.
	const loaded = await import(/* @vite-ignore */ pathToFileURL(file).href);
	if (!loaded.default?.instance) {
		throw new Error(
			`${file} must default-export defineConfig({ ... }) from "@/config".`,
		);
	}
	return loaded.default;
}

/**
 * Astro integration that serves the configuration to the app.
 *
 * `codehood:config` resolves to `file`, which the server evaluates again at
 * boot, so `env()` reads the running process's environment.
 * `codehood:build` is a module of constants frozen at build, safe to import
 * in the browser, and so is `codehood:runners`, the registry of the
 * languages in `runner.languages`. The dev server restarts when `file`
 * changes.
 */
export function codehoodConfig(
	file: string,
	config: CodehoodConfig,
): AstroIntegration {
	return {
		name: "codehood-config",
		hooks: {
			"astro:config:setup": ({ addWatchFile, config: astro, updateConfig }) => {
				addWatchFile(file);
				const root = fileURLToPath(astro.root);
				updateConfig({
					vite: {
						plugins: [
							{
								name: "codehood-config",
								// Before the tsconfig paths, which map both ids for code run outside a bundle.
								enforce: "pre",
								resolveId(id: string) {
									if (id === "codehood:config") return file;
									if (id === "codehood:build") return BUILD_MODULE;
									if (id === "codehood:runners") return RUNNERS_MODULE;
									return null;
								},
								load(id: string) {
									if (id === BUILD_MODULE) {
										return `export const timeZone = ${JSON.stringify(config.instance.timeZone)};\n`;
									}
									if (id === RUNNERS_MODULE) {
										return runnersModule(
											config.runner.languages,
											config.instance.locale,
											root,
										);
									}
									return null;
								},
							},
						],
					},
				});
			},
		},
	};
}
