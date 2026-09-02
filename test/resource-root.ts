import path from "node:path";
import { fileURLToPath } from "node:url";

/** Where test blobs get written — kept out of the real `storage/resources`
 * a dev checkout uses, and wiped by `test/run.ts` on every run. */
export const TEST_RESOURCE_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	".tmp/resources",
);
