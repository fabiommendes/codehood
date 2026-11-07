import { defineConfig, devices } from "@playwright/test";
import {
	TEST_BASE_URL,
	TEST_DATABASE_URL,
	TEST_DIST_DIR,
	TEST_PORT,
	TEST_RESOURCE_ROOT,
	TEST_RUNNER_ORIGIN,
} from "./test/env";

/// `TEST_BROWSERS=cross` adds Firefox and WebKit projects, limited to the
/// `runner-*` specs. Without it only Chromium runs.
/// Specs that exercise a browser. The pure ones run no page, so one browser is enough.
const CROSS_BROWSER_SPECS = /runner-.*\.spec\.ts/;
const PURE_SPECS = /runner-(terminal|ide-state|languages)\.spec\.ts/;
const crossBrowser = process.env.TEST_BROWSERS === "cross";

export default defineConfig({
	testDir: "./test",
	// Real-runtime specs are slow; `test/run.ts test/runtimes` runs them.
	testIgnore: process.argv.some((arg) => arg.includes("test/runtimes"))
		? []
		: ["**/runtimes/**"],
	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"] } },
		...(crossBrowser
			? [
					{
						name: "firefox",
						testMatch: CROSS_BROWSER_SPECS,
						testIgnore: PURE_SPECS,
						use: { ...devices["Desktop Firefox"] },
					},
					{
						name: "webkit",
						testMatch: CROSS_BROWSER_SPECS,
						testIgnore: PURE_SPECS,
						use: { ...devices["Desktop Safari"] },
					},
				]
			: []),
	],
	fullyParallel: false,
	workers: 1,
	// Refuses to run against the wrong database — see the file for why that is
	// otherwise invisible.
	globalSetup: "./test/global-setup.ts",
	use: {
		baseURL: TEST_BASE_URL,
		// Astro's CSRF protection for form-accepting actions checks the Origin header,
		// which a real browser always sends but Playwright's bare `request` fixture doesn't.
		extraHTTPHeaders: { origin: TEST_BASE_URL },
	},
	webServer: {
		// `astro dev` refuses a second concurrent instance for the project (see AGENTS.md:
		// agents run one in the background), so tests build once and run the standalone
		// Node adapter server on its own port instead.
		// Each run builds into its own directory under `test/.tmp/<port>/`.
		command: `node_modules/.bin/astro build --outDir ${TEST_DIST_DIR} && node ${TEST_DIST_DIR}/server/entry.mjs`,
		url: TEST_BASE_URL,
		reuseExistingServer: false,
		timeout: 60_000,
		env: {
			DATABASE_URL: TEST_DATABASE_URL,
			RESOURCE_ROOT: TEST_RESOURCE_ROOT,
			NODE_ENV: "test",
			// Required, no default. The test server is a dev instance: it runs
			// over plain HTTP, so a Secure session cookie would never come back.
			ENVIRONMENT: "dev",
			// Clone URLs are built from it, so a test can `git clone` what the API returns.
			PUBLIC_URL: TEST_BASE_URL,
			// One address answers as `localhost` (app) and `127.0.0.1` (runner).
			HOST: "127.0.0.1",
			RUNNER_ORIGIN: TEST_RUNNER_ORIGIN,
			PORT: String(TEST_PORT),
		},
	},
});
