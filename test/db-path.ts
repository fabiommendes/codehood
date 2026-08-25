import path from "node:path";
import { fileURLToPath } from "node:url";

export const TEST_DB_PATH = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	".tmp/test.db",
);
export const TEST_DATABASE_URL = `file:${TEST_DB_PATH}`;
