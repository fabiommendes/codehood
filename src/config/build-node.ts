/**
 * Build-time constants, for code that runs outside a bundle.
 *
 * Bundles resolve `codehood:build` to a virtual module holding the values
 * the build saw (`src/config/integration.ts`), which is also safe in the
 * browser. Elsewhere `tsconfig.json` maps it here, to the same values read
 * from the configuration file.
 */

import config from "codehood:config";

/** Zone every instant is rendered in. */
export const timeZone: string = config.instance.timeZone;
