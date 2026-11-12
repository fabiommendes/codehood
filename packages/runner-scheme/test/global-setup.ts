/**
 * Builds a runner bundle with only the Scheme plugin and starts the runner
 * test server. The package is the project root: its specifiers and its
 * runtime resolve from here, as they would from an instance that installs it.
 */

import { join, resolve } from "node:path";
import { runnerGlobalSetup } from "@codehood/runner/testing/setup";
import scheme from "../src/index";

export default function globalSetup(): Promise<() => Promise<void>> {
	return runnerGlobalSetup({
		root: resolve(import.meta.dirname, ".."),
		bundleDir: join(import.meta.dirname, ".tmp", "bundle"),
		plugins: [scheme()],
	});
}
