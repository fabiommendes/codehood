import { defineConfig } from "@playwright/test";
import {
	TEST_BASE_URL,
	TEST_DATABASE_URL,
	TEST_PORT,
	TEST_RESOURCE_ROOT,
} from "./test/env";

export default defineConfig({
	testDir: "./test",
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
		command: "node_modules/.bin/astro build && node dist/server/entry.mjs",
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
			HOST: "localhost",
			PORT: String(TEST_PORT),
		},
	},
});
