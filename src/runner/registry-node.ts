/**
 * `codehood:runners` for code that runs outside a bundle (tsx, Playwright,
 * tsc): the registry built from the plugins of the configuration file.
 *
 * Bundles resolve the id to a generated module instead
 * (`src/config/integration.ts`).
 */

import config from "codehood:config";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { runnersRegistry } from "./registry";

const registry = runnersRegistry(
	config.runner.languages,
	config.instance.locale,
	process.cwd(),
	(module) => import(isAbsolute(module) ? pathToFileURL(module).href : module),
);

/** A `RunnerInfo` per language the configuration lists. */
export const runners = registry.runners;

/** Every runtime package the listed languages carry. */
export const runtimes = registry.runtimes;
