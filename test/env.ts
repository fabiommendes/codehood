import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_TEST_PORT } from "./default-port";

/**
 * Everything one test run must not share with another: its port, its database
 * and its blob directory.
 *
 * All three are derived from `TEST_PORT`, so two runs on two ports never touch
 * each other's files. `test/run.ts` picks a free port and exports it before
 * launching Playwright; `playwright.config.ts` and the worker processes read
 * the same value back out of the environment.
 */

export const TEST_PORT: number = Number(
	process.env.TEST_PORT ?? DEFAULT_TEST_PORT,
);

export const TEST_BASE_URL = `http://localhost:${TEST_PORT}`;

/// One directory per port, wiped by `test/run.ts` at the start of each run.
const TEST_TMP_DIR = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	".tmp",
	String(TEST_PORT),
);

export const TEST_DB_PATH = path.join(TEST_TMP_DIR, "test.db");
export const TEST_DATABASE_URL = `file:${TEST_DB_PATH}`;

/**
 * Where test blobs get written — kept out of the real `storage/resources` a
 * dev checkout uses, and wiped by `test/run.ts` on every run.
 */
export const TEST_RESOURCE_ROOT = path.join(TEST_TMP_DIR, "resources");
