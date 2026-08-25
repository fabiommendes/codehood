import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { TEST_DATABASE_URL, TEST_DB_PATH } from "./db-path";

// Resets the test SQLite database and pushes the current Prisma schema to it,
// then runs Playwright with the same DATABASE_URL so both the unit-test worker
// processes and the spawned webServer point at it.
mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });
for (const suffix of ["", "-journal", "-wal", "-shm"]) {
	rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
}

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.NODE_ENV = "test";

// prisma.config.ts hardcodes its datasource url, so the CLI needs --url to target the
// test database explicitly. The user has consented (see AskUserQuestion in this session)
// to `db push` running non-interactively against this throwaway test-only file.
execSync(
	`node_modules/.bin/prisma db push --url "${TEST_DATABASE_URL}" --accept-data-loss`,
	{
		env: {
			...process.env,
			PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION:
				"Yes, allow it for the test DB only",
		},
		stdio: "inherit",
	},
);

const result = spawnSync(
	"node_modules/.bin/playwright",
	["test", ...process.argv.slice(2)],
	{
		env: process.env,
		stdio: "inherit",
	},
);

process.exit(result.status ?? 1);
