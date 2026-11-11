import { execSync, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_E2E_WORKERS, DEFAULT_TEST_PORT } from "./default-port";

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

/// Where runs leave one lock file per port they took. Outside the checkout,
/// because the runs that compete for ports are in different checkouts.
const LOCK_DIR = path.join(
	existsSync("/dev/shm") ? "/dev/shm" : tmpdir(),
	"codehood-test-ports",
);

/// The ports this run holds a lock file for.
const lockedPorts: number[] = [];

function lockPath(port: number): string {
	return path.join(LOCK_DIR, `${port}.lock`);
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/// Takes the lock of `port`, replacing one left by a run that died.
function lock(port: number): boolean {
	mkdirSync(LOCK_DIR, { recursive: true });
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			writeFileSync(lockPath(port), String(process.pid), { flag: "wx" });
			lockedPorts.push(port);
			return true;
		} catch {
			let owner = Number.NaN;
			try {
				owner = Number(readFileSync(lockPath(port), "utf8"));
			} catch {}
			if (Number.isInteger(owner) && isAlive(owner)) return false;
			rmSync(lockPath(port), { force: true });
		}
	}
	return false;
}

function unlockAll(): void {
	for (const port of lockedPorts.splice(0)) {
		rmSync(lockPath(port), { force: true });
	}
}

/// Locks `count` consecutive ports from `first` on, or releases them all and
/// reports the first one that is locked or answering.
async function reserve(
	first: number,
	count: number,
): Promise<{ ok: true } | { ok: false; taken: number }> {
	for (let port = first; port < first + count; port++) {
		if (!lock(port) || (await inUse(port))) {
			unlockAll();
			return { ok: false, taken: port };
		}
	}
	return { ok: true };
}

/**
 * Reserves `count` consecutive ports for this run and returns the first.
 *
 * The servers only bind after the build, long after the choice, so a probe
 * alone lets two runs started together pick the same ports. The lock files
 * close that window.
 *
 * @throws Error when `pinned` is taken, or no block is free in the scanned range.
 */
async function reservePorts(count: number, pinned?: number): Promise<number> {
	if (pinned !== undefined) {
		const result = await reserve(pinned, count);
		if (result.ok) return pinned;
		throw new Error(
			`TEST_PORT=${pinned} needs ports ${pinned} to ${pinned + count - 1}, and ${result.taken} is taken by another run or server.`,
		);
	}
	const end = DEFAULT_TEST_PORT + 200;
	for (let first = DEFAULT_TEST_PORT; first + count <= end; ) {
		const result = await reserve(first, count);
		if (result.ok) return first;
		first = result.taken + 1;
	}
	throw new Error(`No ${count} free ports in [${DEFAULT_TEST_PORT}, ${end}).`);
}

process.on("exit", unlockAll);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => process.exit(130));
}

// The port decides where the databases and the blobs live, so a run started
// while another is already going gets its own of each rather than wiping the
// ones in use. Each `e2e` worker has a server, so the run takes one port per
// worker. Set `TEST_PORT` to pin the first.
const serverCount = Number(process.env.TEST_E2E_WORKERS ?? DEFAULT_E2E_WORKERS);
if (!Number.isInteger(serverCount) || serverCount < 1) {
	console.error("TEST_E2E_WORKERS must be a positive integer.");
	process.exit(1);
}
process.env.TEST_PORT = String(
	await reservePorts(
		serverCount,
		process.env.TEST_PORT ? Number(process.env.TEST_PORT) : undefined,
	).catch((error: Error) => {
		console.error(error.message);
		process.exit(1);
	}),
);

// Read after `TEST_PORT` is set: the module derives every path from it.
const {
	TEST_BASE_URL,
	TEST_DATABASE_URL,
	TEST_DB_DIR,
	TEST_DIST_DIR,
	TEST_RESOURCE_ROOT,
	TEST_RUNNER_ORIGIN,
	TEST_TMP_DIR,
} = await import("./env");

// Resets the test SQLite database and pushes the current Prisma schema to it,
// then runs Playwright with the same DATABASE_URL so both the unit-test worker
// processes and the spawned webServer point at it.
rmSync(TEST_DB_DIR, { recursive: true, force: true });
mkdirSync(TEST_DB_DIR, { recursive: true });

// Same idea for resource blobs: a throwaway directory, wiped before every run
// so file-service tests never see bytes left over from a previous one.
rmSync(TEST_TMP_DIR, { recursive: true, force: true });
mkdirSync(TEST_RESOURCE_ROOT, { recursive: true });

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.RESOURCE_ROOT = TEST_RESOURCE_ROOT;
process.env.NODE_ENV = "test";
// The server and the test workers must agree on the origin of clone URLs.
process.env.PUBLIC_URL = TEST_BASE_URL;
// `ENVIRONMENT` has no default and the test server runs over plain HTTP.
process.env.ENVIRONMENT = "dev";
// Specs build dates in the local time of the process and compare them with
// what the server shows in its own time zone, so the two must be the same.
process.env.TZ = process.env.SERVER_TZ ?? "America/Sao_Paulo";
// The server and the workers read the instance settings above from the
// environment, through the test configuration.
process.env.CODEHOOD_CONFIG = "test/codehood.config.ts";

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

// `--rtk` and `--scope` are consumed here rather than forwarded: they select
// how Playwright is launched, not how it runs.
const forwarded = process.argv.slice(2);
const useRtk = forwarded.includes("--rtk");
const scopeArg = forwarded.find((arg) => arg.startsWith("--scope="));
const requestedScope = scopeArg?.slice("--scope=".length) ?? "all";
const playwrightArgs = forwarded.filter(
	(arg) => arg !== "--rtk" && arg !== scopeArg,
);

const SCOPES = ["unit", "e2e"] as const;
type Scope = (typeof SCOPES)[number];

function isScope(value: string): value is Scope {
	return (SCOPES as readonly string[]).includes(value);
}

if (requestedScope !== "all" && !isScope(requestedScope)) {
	console.error(`--scope must be unit, e2e or all, got "${requestedScope}".`);
	process.exit(1);
}
const scopes: readonly Scope[] =
	requestedScope === "all" ? SCOPES : [requestedScope];

const hasReporter = playwrightArgs.some(
	(arg) => arg === "--reporter" || arg.startsWith("--reporter="),
);

// `dot` keeps a full-suite run to a handful of lines while still streaming as
// it goes. rtk parses the default `list` reporter, so leave it alone there.
if (!hasReporter && !useRtk) {
	playwrightArgs.push("--reporter=dot");
}

// A file or a `--grep` given to both scopes usually belongs to one of them.
if (scopes.length > 1) {
	playwrightArgs.push("--pass-with-no-tests");
}

/// Builds the server the `e2e` workers start, once for all of them.
function buildServer(): number {
	// `astro dev` refuses a second concurrent instance for the project, so the
	// tests run the standalone Node adapter server of a build of their own.
	const result = spawnSync(
		"node_modules/.bin/astro",
		["build", "--outDir", TEST_DIST_DIR],
		{
			env: { ...process.env, RUNNER_ORIGIN: TEST_RUNNER_ORIGIN },
			stdio: ["ignore", "ignore", "inherit"],
		},
	);
	return result.status ?? 1;
}

/// Runs Playwright on one scope and returns its exit status.
function runScope(scope: Scope): number {
	console.log(`\n[test] scope: ${scope}`);
	if (scope === "e2e") {
		const built = buildServer();
		if (built !== 0) return built;
	}
	const result = spawnSync(
		useRtk ? "rtk" : "node_modules/.bin/playwright",
		useRtk
			? ["playwright", "test", ...playwrightArgs]
			: ["test", ...playwrightArgs],
		{
			env: {
				...process.env,
				TEST_SCOPE: scope,
				// rtk resolves `playwright` from PATH, which does not carry the
				// workspace's binaries by default.
				PATH: `${path.resolve("node_modules/.bin")}${path.delimiter}${process.env.PATH ?? ""}`,
			},
			stdio: "inherit",
		},
	);
	return result.status ?? 1;
}

// The cheap scope goes first, and a failure in it does not hide the other's.
const statuses = scopes.map(runScope);

// The build alone is ~7 MB per run and every port gets its own, so without
// this the directory grows with each run on a new port.
rmSync(TEST_TMP_DIR, { recursive: true, force: true });
rmSync(TEST_DB_DIR, { recursive: true, force: true });

process.exit(statuses.find((status) => status !== 0) ?? 0);
