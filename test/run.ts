import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import path from "node:path";
import { DEFAULT_TEST_PORT } from "./default-port";

/**
 * Whether something already answers on `port`.
 *
 * Connects rather than binding: `localhost` resolves to both `127.0.0.1` and
 * `::1`, and a bind probe that lands on the other one reports a busy port as
 * free.
 */
async function inUse(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const probe = createConnection({ host: "localhost", port });
		const settle = (answer: boolean) => {
			probe.destroy();
			resolve(answer);
		};
		probe.setTimeout(500, () => settle(false));
		probe.once("connect", () => settle(true));
		probe.once("error", () => settle(false));
	});
}

/// The first free port at or above `DEFAULT_TEST_PORT`.
async function freePort(): Promise<number> {
	for (let port = DEFAULT_TEST_PORT; port < DEFAULT_TEST_PORT + 50; port++) {
		if (!(await inUse(port))) return port;
	}
	throw new Error(
		`No free port in [${DEFAULT_TEST_PORT}, ${DEFAULT_TEST_PORT + 50}).`,
	);
}

// The port decides where the database and the blobs live, so a run started
// while another is already going gets its own of each rather than wiping the
// one in use. Set `TEST_PORT` to pin it.
process.env.TEST_PORT = String(
	process.env.TEST_PORT ? Number(process.env.TEST_PORT) : await freePort(),
);

// Read after `TEST_PORT` is set: the module derives every path from it.
const { TEST_DATABASE_URL, TEST_DB_PATH, TEST_RESOURCE_ROOT } = await import(
	"./env"
);

// Resets the test SQLite database and pushes the current Prisma schema to it,
// then runs Playwright with the same DATABASE_URL so both the unit-test worker
// processes and the spawned webServer point at it.
mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });
for (const suffix of ["", "-journal", "-wal", "-shm"]) {
	rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
}

// Same idea for resource blobs: a throwaway directory, wiped before every run
// so file-service tests never see bytes left over from a previous one.
rmSync(TEST_RESOURCE_ROOT, { recursive: true, force: true });
mkdirSync(TEST_RESOURCE_ROOT, { recursive: true });

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.RESOURCE_ROOT = TEST_RESOURCE_ROOT;
process.env.NODE_ENV = "test";
// `ENVIRONMENT` has no default and the test server runs over plain HTTP.
process.env.ENVIRONMENT = "dev";

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

// The demo accounts and courses used to appear on the first request, seeded by
// a middleware that no longer exists. Seed them here instead, so a spec that
// logs in as `admin` still finds one.
execSync("node_modules/.bin/tsx prisma/seed.ts", {
	env: process.env,
	stdio: "inherit",
});

// `--rtk` is consumed here rather than forwarded: it selects how Playwright is
// launched, not how it runs.
const forwarded = process.argv.slice(2);
const useRtk = forwarded.includes("--rtk");
const playwrightArgs = forwarded.filter((arg) => arg !== "--rtk");

const hasReporter = playwrightArgs.some(
	(arg) => arg === "--reporter" || arg.startsWith("--reporter="),
);

// `dot` keeps a full-suite run to a handful of lines while still streaming as
// it goes. rtk parses the default `list` reporter, so leave it alone there.
if (!hasReporter && !useRtk) {
	playwrightArgs.push("--reporter=dot");
}

const result = spawnSync(
	useRtk ? "rtk" : "node_modules/.bin/playwright",
	useRtk
		? ["playwright", "test", ...playwrightArgs]
		: ["test", ...playwrightArgs],
	{
		env: {
			...process.env,
			// rtk resolves `playwright` from PATH, which does not carry the
			// workspace's binaries by default.
			PATH: `${path.resolve("node_modules/.bin")}${path.delimiter}${process.env.PATH ?? ""}`,
		},
		stdio: "inherit",
	},
);

process.exit(result.status ?? 1);
