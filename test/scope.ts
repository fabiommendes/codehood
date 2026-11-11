import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/// The two halves of the suite: `unit` specs call the code in-process, `e2e`
/// specs talk to the server under test.
export type TestScope = "unit" | "e2e";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

/// A test callback that takes one of the fixtures that reach the server.
const SERVER_FIXTURE =
	/\{[^{}]*\b(page|request|browser|context)\b[^{}]*\}\s*(,\s*\w+\s*)?\)\s*=>/;

/// The address of the server under test, used by specs that open their own
/// connection instead of taking a fixture.
const SERVER_ADDRESS = /\bTEST_(BASE_URL|RUNNER_ORIGIN)\b/;

const SPEC_FILE = /\.(spec|test)\.ts$/;

function specFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			return entry.name.startsWith(".") ? [] : specFiles(full);
		}
		return SPEC_FILE.test(entry.name) ? [full] : [];
	});
}

/**
 * The absolute paths of the specs that need the server under test.
 *
 * A spec is `e2e` when it takes the `page`, `request`, `browser` or `context`
 * fixture, or refers to `TEST_BASE_URL` or `TEST_RUNNER_ORIGIN`. Everything
 * else is `unit`. The `unit` scope starts no server, so a spec this misses
 * fails there with a refused connection rather than passing by accident.
 */
export function e2eSpecs(): string[] {
	return specFiles(TEST_DIR).filter((file) => {
		const source = readFileSync(file, "utf8");
		return SERVER_FIXTURE.test(source) || SERVER_ADDRESS.test(source);
	});
}

/**
 * The scope selected for this Playwright invocation, read from `TEST_SCOPE`.
 *
 * @throws Error when `TEST_SCOPE` is set to anything but `unit` or `e2e`.
 */
export function currentScope(): TestScope {
	const scope = process.env.TEST_SCOPE ?? "e2e";
	if (scope === "unit" || scope === "e2e") return scope;
	throw new Error(`TEST_SCOPE must be "unit" or "e2e", got "${scope}".`);
}
