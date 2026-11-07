/**
 * Files of the sandbox bundle, as the runner endpoint serves them.
 *
 * The bundle is built by `runnerBundle()` (see `integration.ts`) outside
 * `public/`, because files there are served before the middleware runs, on
 * any host and without the runner headers.
 *
 * URL layout on the runner origin:
 *
 * | Path                         | Kind      | Content                          |
 * | :--------------------------- | :-------- | :------------------------------- |
 * | `/runner/frame`              | `frame`   | `renderFramePage(...)`           |
 * | `/runner/sw.js`              | `sw`      | service worker                   |
 * | `/runner/<version>/<file>`   | `bundle`  | `frame.js`, `worker.js`, chunks  |
 * | `/runner/rt/<pkg>@<ver>/...` | `runtime` | runtime files (later deliveries) |
 */

import type { FrameConfig } from "../sandbox/frame";
import type { RunnerAssetKind } from "./routing";

/** One file to serve. */
export interface RunnerAsset {
	kind: RunnerAssetKind;
	contentType: string;
	body: Uint8Array;
}

/** Content hash of the current sandbox bundle; the `<version>` segment of its URLs. */
export function runnerVersion(): string {
	throw new Error("not implemented");
}

/**
 * Resolves a path under `/runner/` to the file to serve.
 *
 * @returns `null` for anything that is not a file of the current bundle,
 * including another `<version>` and any path that escapes the bundle directory.
 */
export async function readRunnerAsset(
	_pathname: string,
): Promise<RunnerAsset | null> {
	throw new Error("not implemented");
}

/**
 * The frame page: an empty document whose `<meta>` tags carry the
 * `FrameConfig` and whose only script is `/runner/<version>/frame.js`.
 *
 * No inline script, so the frame CSP needs no `'unsafe-inline'`.
 */
export function renderFramePage(
	_config: Omit<FrameConfig, "bundleBase">,
): string {
	throw new Error("not implemented");
}
