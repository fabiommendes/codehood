/**
 * Cuts a release: writes the pending migration, runs the gate, bumps the
 * version, and commits and tags the result.
 *
 * Usage: `pnpm run release <patch|minor|major|x.y.z> [--allow-data-loss] [--dry-run]`
 *
 * 1. Requires `main` with a clean tree and an empty design playground (only
 *    `src/pages/design/playground/index.astro`). Uncommitted migrations are
 *    allowed, so a migration edited by hand after a failed run is kept.
 * 2. `pnpm run db:migrate`: writes the migration for the schema changes since
 *    the last release and checks it for data loss.
 *    It also runs `scripts/check-siblings.ts --strict --fetch` (`../mdq` is the
 *    commit in `.mdq-ref`, clean and pushed) and requires the `mdq` release
 *    the CLI asks for to be on PyPI.
 * 3. The gate: `pnpm run lint`, `pnpm test`, and the CLI's tests against the
 *    PyPI releases of its dependencies (what the published package gets).
 * 4. Bumps `package.json`, `cli/pyproject.toml` and
 *    `workers/chalk-worker/pyproject.toml` (which pins `codehood-cli` to the
 *    same version) to one version, turns the "Unreleased" section of both
 *    changelogs into the version's, regenerates the CLI's OpenAPI snapshot,
 *    commits as `release: vX.Y.Z` and tags `vX.Y.Z`, recording the mdq commit
 *    and versions in the tag message. Pushing the tag publishes the CLI to PyPI
 *    (`.github/workflows/publish-cli.yml`). The worker is not published.
 *
 * `--dry-run` stops after the gate. Nothing is pushed.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { mdqHead, mdqVersions } from "./lib/mdq-snapshot";
import { pyprojectLowerBound } from "./lib/siblings";

const { values: args, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		"allow-data-loss": { type: "boolean", default: false },
		"dry-run": { type: "boolean", default: false },
	},
});

/// Scratch pages for design work in progress; a release ships none of them.
const PLAYGROUND = "src/pages/design/playground";

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

/// Aborts unless the `mdq` release the CLI requires is on PyPI.
async function requireMdqOnPypi(): Promise<void> {
	const bound = pyprojectLowerBound(
		readFileSync("cli/pyproject.toml", "utf8"),
		"mdq",
	);
	if (bound === null) fail("cli/pyproject.toml has no `mdq>=` lower bound.");
	const response = await fetch(`https://pypi.org/pypi/mdq/${bound}/json`);
	if (response.status === 404) fail(`Publish mdq-py ${bound} first.`);
	if (!response.ok) fail(`PyPI answered ${response.status} for mdq ${bound}.`);
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
const playground = readdirSync(PLAYGROUND, {
	recursive: true,
	encoding: "utf8",
})
	.filter((entry) => entry !== "index.astro")
	.map((entry) => `${PLAYGROUND}/${entry}`);
if (playground.length > 0) {
	fail(`The design playground must be empty:\n${playground.join("\n")}`);
}
if (output("git", ["tag", "--list", tag])) fail(`Tag ${tag} already exists.`);
run("Siblings", "tsx", ["scripts/check-siblings.ts", "--strict", "--fetch"]);
run("Versions", "tsx", ["scripts/check-versions.ts"]);
await requireMdqOnPypi();
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
run("CLI tests", "uv", [
	"run",
	"--directory",
	"cli",
	"--no-sources",
	"--isolated",
	"--with",
	"pytest",
	"--with",
	"hypothesis",
	"pytest",
	"-q",
]);

if (args["dry-run"]) {
	console.log("\n✔ Dry run: the gate passed, nothing committed.");
	process.exit(0);
}

// 4. Bump, changelog, commit and tag.
pkg.version = version;
writeFileSync("package.json", `${JSON.stringify(pkg, null, "\t")}\n`);

run("CLI version", "uv", [
	"version",
	"--directory",
	"cli",
	"--no-sync",
	version,
]);

const today = new Date().toISOString().slice(0, 10);
for (const file of ["CHANGELOG.md", "cli/CHANGELOG.md"]) {
	const changelog = readFileSync(file, "utf8");
	if (!changelog.includes("\n## Unreleased\n")) {
		fail(`${file} has no "## Unreleased" section.`);
	}
	writeFileSync(
		file,
		changelog.replace(
			"\n## Unreleased\n",
			`\n## Unreleased\n\n## ${version} (${today})\n`,
		),
	);
}

run("Worker version", "uv", [
	"version",
	"--directory",
	"workers/chalk-worker",
	"--no-sync",
	version,
]);
const workerFile = "workers/chalk-worker/pyproject.toml";
writeFileSync(
	workerFile,
	readFileSync(workerFile, "utf8").replace(
		/"codehood-cli==[^"]*"/,
		`"codehood-cli==${version}"`,
	),
);
run("Worker lock", "uv", ["lock", "--directory", "workers/chalk-worker"]);

// The CLI's OpenAPI snapshot carries the version, so every bump makes it stale.
run("OpenAPI", "pnpm", ["run", "openapi:cli"]);

run("Commit", "git", [
	"add",
	"package.json",
	"CHANGELOG.md",
	"cli/CHANGELOG.md",
	"cli/pyproject.toml",
	"cli/uv.lock",
	workerFile,
	"workers/chalk-worker/uv.lock",
	"prisma/migrations",
	"cli/resources/openapi/codehood.json",
	"cli/codehood/api/generated.py",
]);
run("Commit", "git", ["commit", "--quiet", "-m", `release: ${tag}`]);
const mdq = mdqVersions();
run("Tag", "git", [
	"tag",
	"--annotate",
	tag,
	"-m",
	`Codehood ${version}\n\nmdq: ${mdqHead()} (mdq-js ${mdq.js}, mdq-py ${mdq.py}, spec ${mdq.schema})`,
]);

console.log(
	`\n✔ Tagged ${tag}. Publish with: git push origin main ${tag}` +
		" (the tag also publishes the CLI to PyPI)",
);
