import { defineConfig } from "@playwright/test";
import { TEST_DATABASE_URL } from "./test/db-path";

export default defineConfig({
	testDir: "./test",
	fullyParallel: false,
	workers: 1,
	use: {
		baseURL: "http://localhost:4322",
	},
	webServer: {
		// `astro dev` refuses a second concurrent instance for the project (see AGENTS.md:
		// agents run one in the background), so tests build once and run the standalone
		// Node adapter server on its own port instead.
		command: "node_modules/.bin/astro build && node dist/server/entry.mjs",
		url: "http://localhost:4322",
		reuseExistingServer: false,
		timeout: 60_000,
		env: {
			DATABASE_URL: TEST_DATABASE_URL,
			NODE_ENV: "test",
			HOST: "localhost",
			PORT: "4322",
		},
	},
});
