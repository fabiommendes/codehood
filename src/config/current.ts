/**
 * The configuration of this process, for code that runs outside a bundle.
 *
 * `codehood:config` resolves here only under `tsx`, the Playwright loader
 * and the typechecker (`tsconfig.json` paths). Bundles (the Astro build, the
 * dev server, `dist/manage.mjs`) resolve it straight to the configuration
 * file instead.
 */

import { pathToFileURL } from "node:url";
import type { CodehoodConfig } from ".";
import { configPath } from "./path";

const loaded: { default: CodehoodConfig } = await import(
	pathToFileURL(configPath(process.cwd(), process.env)).href
);

/** The configuration `CODEHOOD_CONFIG` points at. */
const config: CodehoodConfig = loaded.default;
export default config;
