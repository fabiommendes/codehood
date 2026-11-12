/**
 * Tests of the Scheme plugin against the runner test server of
 * `@codehood/runner`. Run from the project root with
 * `pnpm --filter @codehood/runner-scheme test`.
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./test",
	testMatch: "**/*.spec.ts",
	globalSetup: "./test/global-setup.ts",
	fullyParallel: true,
	workers: 4,
	reporter: process.env.CI ? "line" : "dot",
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
