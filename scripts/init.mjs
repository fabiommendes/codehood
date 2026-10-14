/**
 * Brings a freshly-cloned (or freshly-cleared) checkout to a runnable state.
 *
 * Installs dependencies, creates `.env`, generates the Prisma client, applies
 * the migrations, seeds the database and runs the code generators. Every step
 * is idempotent, so it is safe to re-run on an existing checkout.
 *
 * Plain Node with no imports beyond `node:*`, so it can run before
 * `node_modules` exists.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

/** Runs a command in the project root, aborting the script if it fails. */
function run(label, command, args) {
	console.log(`\n▶ ${label}`);
	const { status, error } = spawnSync(command, args, {
		cwd: rootDir,
		stdio: "inherit",
		shell: process.platform === "win32",
	});
	if (error) throw error;
	if (status !== 0) {
		console.error(`\n✖ ${label} failed (exit code ${status}).`);
		process.exit(status ?? 1);
	}
}

// 1. Dependencies. Skipped when node_modules is already there, so re-running
// init on a working checkout stays fast.
if (existsSync(path.join(rootDir, "node_modules"))) {
	console.log("▶ Dependencies already installed, skipping pnpm install");
} else {
	run("Installing dependencies", "pnpm", ["install"]);
}

// 2. Environment. prisma.config.ts and src/db/client.ts both fall back to a
// local dev.db, but an explicit .env is what the rest of the tooling expects.
const envPath = path.join(rootDir, ".env");
if (existsSync(envPath)) {
	console.log("▶ .env already exists, keeping it");
} else {
	copyFileSync(path.join(rootDir, ".env.example"), envPath);
	console.log("▶ Created .env from .env.example");
}

// 3. Database: client, schema, data.
run("Generating Prisma client", "pnpm", ["exec", "prisma", "generate"]);
run("Branding generated types", "pnpm", [
	"exec",
	"tsx",
	"scripts/brand-generated-types.ts",
]);
// Development tracks the schema with `db push`; migrations are only written
// when a release is cut (`pnpm run release`), so they lag behind the schema.
run("Pushing the schema", "pnpm", ["exec", "prisma", "db", "push"]);
run("Seeding the database", "pnpm", ["exec", "prisma", "db", "seed"]);

// 4. Code generators. `generate` writes the route patterns and the OpenAPI
// document, which `dev` and `build` also do.
run("Generating route patterns and OpenAPI document", "pnpm", [
	"run",
	"generate",
]);

// 5. The generators write their own indentation, which is not Biome's. Format
// just their output, so `pnpm run lint` passes on a freshly-initialized tree.
run("Formatting generated files", "pnpm", [
	"exec",
	"biome",
	"check",
	"--write",
	"src/api/registry/route-patterns.json",
]);

console.log("\n✔ Project ready. Run `pnpm run dev` to start the server.");
