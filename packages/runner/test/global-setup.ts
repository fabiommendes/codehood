/**
 * Builds the runner bundle once and starts the test server for the specs of
 * the runner itself.
 */

import { join, resolve } from "node:path";
import { javascript } from "../../../src/runner/plugins";
import { runnerGlobalSetup } from "../src/testing/setup";

/// Grace period of the test bundle; the busy-frame specs depend on it.
const STDIN_GRACE_MS = 1500;

export default function globalSetup(): Promise<() => Promise<void>> {
	return runnerGlobalSetup({
		// Plugin specifiers and `node_modules` are resolved from the project root.
		root: resolve(import.meta.dirname, "..", "..", ".."),
		bundleDir: join(import.meta.dirname, ".tmp", "bundle"),
		// The protocol specs run JavaScript besides `fake`: its driver needs no
		// runtime download, so the suite stays fast.
		plugins: [javascript()],
		// A lost stdin channel crashes the run after three grace periods.
		stdinGraceMs: STDIN_GRACE_MS,
	});
}
