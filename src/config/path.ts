/**
 * Where the instance configuration file is.
 */

import { isAbsolute, resolve } from "node:path";

/// The file used when `CODEHOOD_CONFIG` is unset.
export const DEFAULT_CONFIG_FILE = "codehood.config.ts";

/**
 * Absolute path of the configuration file: `CODEHOOD_CONFIG`, relative to
 * `root`, or `codehood.config.ts` at the root.
 *
 * @example
 * configPath("/srv/app", {}); // "/srv/app/codehood.config.ts"
 */
export function configPath(root: string, env: NodeJS.ProcessEnv): string {
	const file = env.CODEHOOD_CONFIG?.trim() || DEFAULT_CONFIG_FILE;
	return isAbsolute(file) ? file : resolve(root, file);
}
