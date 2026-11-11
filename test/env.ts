import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_E2E_WORKERS, DEFAULT_TEST_PORT } from "./default-port";

/**
 * Everything one test run must not share with another: its ports, its
 * databases, its blob directories and its server build.
 *
 * All of them are derived from `TEST_PORT`, so two runs on two ports never touch
 * each other's files. `test/run.ts` picks a free port and exports it before
 * launching Playwright; `playwright.config.ts` and the worker processes read
 * the same value back out of the environment.
 *
 * Inside a run, each worker owns a database and a blob directory, and each
 * `e2e` worker also owns a server, so spec files can run side by side.
 */

/// The first port of the run. The `e2e` servers take this one and the next.
const RUN_PORT: number = Number(process.env.TEST_PORT ?? DEFAULT_TEST_PORT);

/// How many `e2e` workers run side by side, each against its own server.
export const E2E_WORKERS: number = Number(
	process.env.TEST_E2E_WORKERS ?? DEFAULT_E2E_WORKERS,
);

/// One directory per run, wiped by `test/run.ts` before and after it.
export const TEST_TMP_DIR = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	".tmp",
	String(RUN_PORT),
);

/// Where the server under test is built, so a second run's build does not
/// replace the chunks the first run's server is loading.
export const TEST_DIST_DIR = path.join(TEST_TMP_DIR, "dist");

/// Memory-backed where the platform has it: SQLite syncs every commit to disk,
/// which no test needs. The checkout is part of the name because the same port
/// in two checkouts is two runs.
const SHARED_MEMORY = "/dev/shm";
const CHECKOUT_ID = createHash("sha1")
	.update(TEST_TMP_DIR)
	.digest("hex")
	.slice(0, 12);

/// Where the databases of this run live, wiped by `test/run.ts` like `TEST_TMP_DIR`.
export const TEST_DB_DIR = existsSync(SHARED_MEMORY)
	? path.join(SHARED_MEMORY, `codehood-test-${CHECKOUT_ID}`)
	: path.join(TEST_TMP_DIR, "db");

/// The database `test/run.ts` pushes the schema to and seeds. Every worker
/// starts from a copy of it.
export const TEST_SEEDED_DB_PATH = path.join(TEST_DB_DIR, "test.db");

/// What one `e2e` worker and its server share, and no other worker touches.
export interface E2eSlot {
	port: number;
	baseUrl: string;
	/// The runner frame's origin: same process and port, but `127.0.0.1` is a
	/// different site from `localhost`, so the session cookie never reaches it.
	runnerOrigin: string;
	dbPath: string;
	resourceRoot: string;
}

/** The server address, database and blob directory of the `e2e` worker `index`. */
export function e2eSlot(index: number): E2eSlot {
	const port = RUN_PORT + index;
	return {
		port,
		baseUrl: `http://localhost:${port}`,
		runnerOrigin: `http://127.0.0.1:${port}`,
		dbPath: path.join(TEST_DB_DIR, `e2e-${index}.db`),
		resourceRoot: path.join(TEST_TMP_DIR, `resources-e2e-${index}`),
	};
}

const SCOPE = process.env.TEST_SCOPE;

/// Set by Playwright in worker processes only. A worker restarted after a
/// failure gets a new index, and so a fresh database.
const WORKER_INDEX = process.env.TEST_WORKER_INDEX;

/// Set in worker processes only, and kept by a worker restarted after a
/// failure, so it finds the server of the one it replaces.
const PARALLEL_INDEX = process.env.TEST_PARALLEL_INDEX;

/// `unit` specs never reach the server, so a database per worker is all they need.
const UNIT_WORKER = SCOPE === "unit" && WORKER_INDEX !== undefined;

const E2E_WORKER = SCOPE !== "unit" && PARALLEL_INDEX !== undefined;

if (E2E_WORKER && Number(PARALLEL_INDEX) >= E2E_WORKERS) {
	throw new Error(
		`Worker ${PARALLEL_INDEX} has no server: only ${E2E_WORKERS} were started. ` +
			"Set TEST_E2E_WORKERS instead of passing --workers.",
	);
}

/// Outside a worker this is the first slot, which is also where a run with a
/// single worker lands.
const SLOT = e2eSlot(E2E_WORKER ? Number(PARALLEL_INDEX) : 0);

export const TEST_PORT: number = SLOT.port;
export const TEST_BASE_URL = SLOT.baseUrl;
export const TEST_RUNNER_ORIGIN = SLOT.runnerOrigin;

export const TEST_DB_PATH = UNIT_WORKER
	? path.join(TEST_DB_DIR, `worker-${WORKER_INDEX}.db`)
	: E2E_WORKER
		? SLOT.dbPath
		: TEST_SEEDED_DB_PATH;
export const TEST_DATABASE_URL = `file:${TEST_DB_PATH}`;

/**
 * Where test blobs get written — kept out of the real `storage/resources` a
 * dev checkout uses, and wiped by `test/run.ts` on every run.
 */
export const TEST_RESOURCE_ROOT = UNIT_WORKER
	? path.join(TEST_TMP_DIR, `resources-worker-${WORKER_INDEX}`)
	: E2E_WORKER
		? SLOT.resourceRoot
		: path.join(TEST_TMP_DIR, "resources");

/** Creates the database and the blob directory of `slot`, unless they exist. */
export function prepareE2eSlot(slot: E2eSlot): void {
	if (!existsSync(slot.dbPath)) copyFileSync(TEST_SEEDED_DB_PATH, slot.dbPath);
	mkdirSync(slot.resourceRoot, { recursive: true });
}

// `playwright.config.ts` imports this module, and a worker loads the config
// before any spec, so the environment points at the worker's own files by the
// time `src/db/client.ts` opens the database.
if (UNIT_WORKER) {
	if (!existsSync(TEST_DB_PATH)) {
		copyFileSync(TEST_SEEDED_DB_PATH, TEST_DB_PATH);
	}
	mkdirSync(TEST_RESOURCE_ROOT, { recursive: true });
	process.env.DATABASE_URL = TEST_DATABASE_URL;
	process.env.RESOURCE_ROOT = TEST_RESOURCE_ROOT;
}
if (E2E_WORKER) {
	process.env.DATABASE_URL = TEST_DATABASE_URL;
	process.env.RESOURCE_ROOT = TEST_RESOURCE_ROOT;
	// Clone URLs built in the worker must match the ones its server builds.
	process.env.PUBLIC_URL = TEST_BASE_URL;
}
