/**
 * Tests of the runner itself (protocol, host, frame, isolation), against the
 * minimal server of `test/server.ts`. Run from the project root with
 * `pnpm run test:runner`.
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./test",
	testMatch: "**/*.spec.ts",
	globalSetup: "./test/global-setup.ts",
	fullyParallel: true,
	workers: 4,
	reporter: process.env.CI ? "line" : "dot",
	// `TEST_BROWSERS=cross` adds Firefox and WebKit, as in the main suite.
	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"] } },
		...(process.env.TEST_BROWSERS === "cross"
			? [
					{ name: "firefox", use: { ...devices["Desktop Firefox"] } },
					{ name: "webkit", use: { ...devices["Desktop Safari"] } },
				]
			: []),
	],
});
