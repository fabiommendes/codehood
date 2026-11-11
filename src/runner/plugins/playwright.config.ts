/**
 * Tests of the runner plugins that ship with Codehood: one project per
 * plugin, each with the contract of `@codehood/runner/testing/contract` and
 * its own cases. Run from the project root with `pnpm run test:plugins`, or
 * one plugin with `pnpm run test:plugins --project=python`.
 */

import { defineConfig, devices } from "@playwright/test";

/// Plugins with a `test/` folder; the project name is the plugin id.
const PLUGINS = ["javascript", "typescript", "python", "lua", "prolog", "elm"];

export default defineConfig({
	testDir: ".",
	globalSetup: "./global-setup.ts",
	fullyParallel: true,
	workers: 4,
	timeout: 90_000,
	reporter: process.env.CI ? "line" : "dot",
	projects: PLUGINS.map((id) => ({
		name: id,
		testMatch: `${id}/test/**/*.spec.ts`,
		use: { ...devices["Desktop Chrome"] },
	})),
});
