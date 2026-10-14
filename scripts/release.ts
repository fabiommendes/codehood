/**
 * Cuts a release: writes the pending migration, runs the gate, bumps the
 * version, and commits and tags the result.
 *
 * Usage: `pnpm run release <patch|minor|major|x.y.z> [--allow-data-loss] [--dry-run]`
 *
 * 1. Requires `main` with a clean tree. Uncommitted migrations are allowed,
 *    so a migration edited by hand after a failed run is kept.
 * 2. `pnpm run db:migrate`: writes the migration for the schema changes since
 *    the last release and checks it for data loss.
 * 3. The gate: `pnpm run lint` and `pnpm test`.
 * 4. Bumps `package.json`, turns the changelog's "Unreleased" section into the
 *    version's, commits as `release: vX.Y.Z` and tags `vX.Y.Z`.
 *
 * `--dry-run` stops after the gate. Nothing is pushed.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values: args, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		"allow-data-loss": { type: "boolean", default: false },
		"dry-run": { type: "boolean", default: false },
	},
});

function fail(message: string): never {
	console.error(`\n✖ ${message}`);
	process.exit(1);
}

/// Runs a command with inherited output, aborting the release if it fails.
function run(label: string, command: string, commandArgs: string[]): void {
	console.log(`\n▶ ${label}`);
	const { status } = spawnSync(command, commandArgs, { stdio: "inherit" });
	if (status !== 0) fail(`${label} failed (exit code ${status}).`);
}

/// Runs a command and returns its trimmed stdout.
function output(command: string, commandArgs: string[]): string {
	const result = spawnSync(command, commandArgs, { encoding: "utf8" });
	if (result.status !== 0) fail(`${command} ${commandArgs.join(" ")} failed.`);
	return result.stdout.trim();
}

/// The version after `current`, given a bump level or an explicit version.
function nextVersion(current: string, bump: string): string {
	if (/^\d+\.\d+\.\d+$/.test(bump)) return bump;
	const [major = 0, minor = 0, patch = 0] = current.split(".").map(Number);
	if (bump === "major") return `${major + 1}.0.0`;
	if (bump === "minor") return `${major}.${minor + 1}.0`;
	if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
	fail(`Unknown bump "${bump}". Use patch, minor, major or x.y.z.`);
}

const bump = positionals[0];
if (!bump) fail("Usage: pnpm run release <patch|minor|major|x.y.z>");

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const version = nextVersion(pkg.version, bump);
const tag = `v${version}`;

// 1. Preconditions.
if (output("git", ["branch", "--show-current"]) !== "main") {
	fail("Releases are cut from main.");
}
const dirty = output("git", ["status", "--porcelain"])
	.split("\n")
	.filter(Boolean)
	.filter((line) => !line.slice(3).startsWith("prisma/migrations/"));
if (dirty.length > 0) fail(`The tree is not clean:\n${dirty.join("\n")}`);
if (output("git", ["tag", "--list", tag])) fail(`Tag ${tag} already exists.`);
console.log(`▶ Releasing ${pkg.version} → ${version}`);

// 2. Migrations.
run("Migrations", "pnpm", [
	"run",
	"db:migrate",
	"--name",
	`v${version.replaceAll(".", "_")}`,
	...(args["allow-data-loss"] ? ["--allow-data-loss"] : []),
]);

// 3. Gate.
run("Lint", "pnpm", ["run", "lint"]);
run("Tests", "pnpm", ["test"]);

if (args["dry-run"]) {
	console.log("\n✔ Dry run: the gate passed, nothing committed.");
	process.exit(0);
}

// 4. Bump, changelog, commit and tag.
pkg.version = version;
writeFileSync("package.json", `${JSON.stringify(pkg, null, "\t")}\n`);

const changelog = readFileSync("CHANGELOG.md", "utf8");
const today = new Date().toISOString().slice(0, 10);
if (!changelog.includes("\n## Unreleased\n")) {
	fail('CHANGELOG.md has no "## Unreleased" section.');
}
writeFileSync(
	"CHANGELOG.md",
	changelog.replace(
		"\n## Unreleased\n",
		`\n## Unreleased\n\n## ${version} (${today})\n`,
	),
);

run("Commit", "git", [
	"add",
	"package.json",
	"CHANGELOG.md",
	"prisma/migrations",
]);
run("Commit", "git", ["commit", "--quiet", "-m", `release: ${tag}`]);
run("Tag", "git", ["tag", "--annotate", tag, "-m", `Codehood ${version}`]);

console.log(`\n✔ Tagged ${tag}. Publish with: git push origin main ${tag}`);
