/**
 * Astro integration that builds the sandbox bundle.
 */

import type { AstroIntegration } from "astro";

/**
 * Builds `src/runner/sandbox/` with Vite into its own directory: entries
 * `frame.js`, `worker.js` (module Worker) and `sw.js`, plus driver chunks.
 *
 * `astro build` writes it next to the server build so a packaged release
 * carries it; `astro dev` rebuilds it on change. The bundle may import only
 * `src/runner/protocol.ts`, `src/runner/sandbox/**` and `zod`; the build fails
 * on any other import from `src/`.
 */
export function runnerBundle(): AstroIntegration {
	throw new Error("not implemented");
}
