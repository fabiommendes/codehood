/**
 * Playwright `globalSetup` for suites that run against the runner test server.
 */

import type { RunnerPlugin } from "@codehood/runner-api";
import { startTestServer } from "./server";

/**
 * Builds the bundle with `plugins`, starts the test server and publishes its
 * origins to the workers (`env.ts`); returns the teardown.
 *
 * @param root project root the plugin specifiers are resolved from.
 */
export async function runnerGlobalSetup(options: {
	root: string;
	bundleDir: string;
	plugins: readonly RunnerPlugin[];
	stdinGraceMs?: number;
}): Promise<() => Promise<void>> {
	const server = await startTestServer(options);
	process.env.RUNNER_TEST_APP_ORIGIN = server.appOrigin;
	process.env.RUNNER_TEST_RUNNER_ORIGIN = server.runnerOrigin;
	return server.close;
}
