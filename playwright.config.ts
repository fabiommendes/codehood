import { defineConfig, devices } from "@playwright/test";
import {
	E2E_WORKERS,
	e2eSlot,
	prepareE2eSlot,
	TEST_BASE_URL,
	TEST_DIST_DIR,
} from "./test/env";
import { currentScope, e2eSpecs } from "./test/scope";

/// `TEST_BROWSERS=cross` adds Firefox and WebKit projects, limited to the
/// `runner-*` specs. Without it only Chromium runs.
/// Specs that exercise a browser. The pure ones run no page, so one browser is enough.
const CROSS_BROWSER_SPECS = /runner-.*\.spec\.ts/;
const PURE_SPECS = /runner-(terminal|ide-state|languages)\.spec\.ts/;
const BROWSERS = process.env.TEST_BROWSERS ?? "chromium";
const crossBrowser = BROWSERS === "cross";

const ENGINES = {
	chromium: devices["Desktop Chrome"],
	firefox: devices["Desktop Firefox"],
	webkit: devices["Desktop Safari"],
};

/// `TEST_BROWSERS=firefox`, or a list such as `firefox,webkit`, runs every
/// `e2e` spec that is selected on those engines instead of Chromium.
function engineProjects() {
	return BROWSERS.split(",").map((name) => {
		if (!(name in ENGINES)) {
			throw new Error(
				`TEST_BROWSERS must be "cross" or a list of chromium, firefox and webkit, got "${BROWSERS}".`,
			);
		}
		return { name, use: { ...ENGINES[name as keyof typeof ENGINES] } };
	});
}

/// Real-runtime specs are slow; `test/run.ts test/runtimes` runs them.
const SLOW_SPECS = process.argv.some((arg) => arg.includes("test/runtimes"))
	? []
	: ["**/runtimes/**"];

const E2E_SPECS = e2eSpecs();

/// Spec files run side by side, each worker on its own database (see
/// `test/env.ts`). Tests inside a file keep their order.
const unitConfig = defineConfig({
	testDir: "./test",
	testIgnore: [...SLOW_SPECS, ...E2E_SPECS],
	projects: [{ name: "unit" }],
	fullyParallel: false,
	globalSetup: "./test/global-setup.ts",
});

/// One server per worker, each with its own database and blobs, all running
/// the build `test/run.ts` made.
const E2E_SERVER_COUNT = currentScope() === "e2e" ? E2E_WORKERS : 0;
const E2E_SERVERS = Array.from({ length: E2E_SERVER_COUNT }, (_, index) => {
	const slot = e2eSlot(index);
	prepareE2eSlot(slot);
	return {
		command: `node ${TEST_DIST_DIR}/server/entry.mjs`,
		url: slot.baseUrl,
		reuseExistingServer: false,
		timeout: 60_000,
		env: {
			DATABASE_URL: `file:${slot.dbPath}`,
			RESOURCE_ROOT: slot.resourceRoot,
			NODE_ENV: "test",
			// Required, no default. The test server is a dev instance: it runs
			// over plain HTTP, so a Secure session cookie would never come back.
			ENVIRONMENT: "dev",
			// Clone URLs are built from it, so a test can `git clone` what the API returns.
			PUBLIC_URL: slot.baseUrl,
			// One address answers as `localhost` (app) and `127.0.0.1` (runner).
			HOST: "127.0.0.1",
			RUNNER_ORIGIN: slot.runnerOrigin,
			// Reads the values above from the environment.
			CODEHOOD_CONFIG: "test/codehood.config.ts",
			PORT: String(slot.port),
		},
	};
});

/// Spec files run side by side, each worker against its own server. Tests
/// inside a file keep their order.
const e2eConfig = defineConfig({
	testDir: "./test",
	testMatch: E2E_SPECS,
	testIgnore: SLOW_SPECS,
	projects: [
		...(crossBrowser
			? [
					{ name: "chromium", use: { ...devices["Desktop Chrome"] } },
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
			: engineProjects()),
	],
	fullyParallel: false,
	workers: E2E_WORKERS,
	// Refuses to run against the wrong database — see the file for why that is
	// otherwise invisible.
	globalSetup: "./test/global-setup.ts",
	use: {
		baseURL: TEST_BASE_URL,
		// Astro's CSRF protection for form-accepting actions checks the Origin header,
		// which a real browser always sends but Playwright's bare `request` fixture doesn't.
		extraHTTPHeaders: { origin: TEST_BASE_URL },
	},
	webServer: E2E_SERVERS,
});

export default currentScope() === "unit" ? unitConfig : e2eConfig;
