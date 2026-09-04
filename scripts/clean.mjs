/**
 * Resets the working tree to the state of a fresh `git clone`.
 *
 * Removes every generated artifact: dependencies, Prisma client, Astro cache,
 * builds, test output, local databases and resource blobs. Files tracked by git
 * are never touched. Pass `--all` to also remove `.env`, and `--dry-run` to
 * only list what would be deleted.
 *
 * Plain Node with no imports beyond `node:*`, so it still works while it is
 * deleting `node_modules`.
 */
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

/** Generated paths, relative to the project root. */
const TARGETS = [
	"node_modules",
	"src/generated",
	".astro",
	"dist",
	"coverage",
	"test-results",
	"playwright-report",
	"test/.tmp",
	"storage",
	"dev.db",
	"dev.db-journal",
	"prisma/dev.db",
	"prisma/dev.db-journal",
];

/** Paths only removed with `--all`, since they hold local configuration. */
const OPT_IN_TARGETS = [".env"];

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const all = args.has("--all");

const targets = all ? [...TARGETS, ...OPT_IN_TARGETS] : TARGETS;
let removed = 0;

for (const target of targets) {
	const fullPath = path.join(rootDir, target);
	if (!existsSync(fullPath)) continue;

	removed++;
	if (dryRun) {
		console.log(`would remove ${target}`);
		continue;
	}
	rmSync(fullPath, { recursive: true, force: true });
	console.log(`removed ${target}`);
}

if (removed === 0) {
	console.log("Nothing to remove: the working tree is already clean.");
} else if (!dryRun) {
	console.log("\nRun `pnpm install` to set the project up again.");
}

if (!all && existsSync(path.join(rootDir, ".env"))) {
	console.log("Kept .env — pass --all to remove it too.");
}
