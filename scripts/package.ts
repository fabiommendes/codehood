/**
 * Builds a release tag into a tarball a server can run after a production
 * `pnpm install`, without building anything itself.
 *
 * Usage: `pnpm run package <tag> --out <dir> [--rehearse <db>]`
 *
 * The tag is exported from git into a scratch directory and built there, so
 * uncommitted work never ships. The build bakes in the build environment:
 * `PUBLIC_URL` (required, the address the instance is served at),
 * `CODEHOOD_LOCALE` and `SERVER_TZ` (optional).
 *
 * `--rehearse <db>` applies the release's migrations to a copy of `<db>`,
 * typically a fresh copy of the production database, and aborts if they fail.
 * `--keep` leaves the scratch directory behind for inspection.
 *
 * The tarball holds `dist/` (server, assets and `manage.mjs`), the Prisma
 * schema, migrations and config, the manifests pnpm installs from, and a
 * `RELEASE` file recording what was built.
 */
import { execSync, spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadCatalog, resolveBuildLocale } from "./lib/i18n-catalog";

const SHIPPED = [
	"dist",
	"package.json",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
	"prisma",
	"prisma.config.ts",
	"RELEASE",
];

const { values: args, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		out: { type: "string" },
		rehearse: { type: "string" },
		keep: { type: "boolean", default: false },
	},
});

function fail(message: string): never {
	console.error(`\n✖ ${message}`);
	process.exit(1);
}

/// Runs a command in `cwd` with inherited output, aborting if it fails.
function run(
	label: string,
	cwd: string,
	command: string,
	commandArgs: string[],
	env: NodeJS.ProcessEnv = process.env,
): void {
	console.log(`\n▶ ${label}`);
	const { status } = spawnSync(command, commandArgs, {
		cwd,
		env,
		stdio: "inherit",
	});
	if (status !== 0) fail(`${label} failed (exit code ${status}).`);
}

const tag = positionals[0];
if (!tag || !args.out) fail("Usage: pnpm run package <tag> --out <dir>");
if (!process.env.PUBLIC_URL) fail("Set PUBLIC_URL to the instance's address.");

const commit = spawnSync("git", ["rev-parse", "--verify", `${tag}^{commit}`], {
	encoding: "utf8",
});
if (commit.status !== 0) fail(`Unknown tag ${tag}.`);

const out = resolve(args.out);
const work = mkdtempSync(join(tmpdir(), "codehood-package-"));

try {
	console.log(`▶ Exporting ${tag} to ${work}`);
	execSync(`git archive ${tag} -- . ':(exclude)cli' | tar -x -C ${work}`);

	// Checked against the tag's own catalogue, before the slow install. Tags
	// older than the translations have no catalogue and build in English.
	let locale = "en";
	if (existsSync(join(work, "project.inlang"))) {
		try {
			locale = resolveBuildLocale(
				process.env.CODEHOOD_LOCALE,
				loadCatalog(work),
			);
		} catch (error) {
			fail(error instanceof Error ? error.message : String(error));
		}
	} else if (process.env.CODEHOOD_LOCALE) {
		fail(`${tag} predates translations; unset CODEHOOD_LOCALE.`);
	}

	// The build's own .env would otherwise be read by prisma.config.ts.
	const env = {
		...process.env,
		ENVIRONMENT: "prod",
		DATABASE_URL: "file:./build.db",
	};
	run(
		"Installing dependencies",
		work,
		"pnpm",
		["install", "--frozen-lockfile"],
		env,
	);
	run(
		"Generating the Prisma client",
		work,
		"pnpm",
		["run", "db:generate"],
		env,
	);
	run("Building", work, "pnpm", ["run", "build"], env);

	if (args.rehearse) {
		const copy = join(work, "rehearsal.db");
		copyFileSync(resolve(args.rehearse), copy);
		run(
			"Rehearsing the migrations",
			work,
			"pnpm",
			["exec", "prisma", "migrate", "deploy"],
			{
				...env,
				DATABASE_URL: `file:${copy}`,
			},
		);
	}

	const version = tag.replace(/^v/, "");
	writeFileSync(
		join(work, "RELEASE"),
		[
			`version=${version}`,
			`commit=${commit.stdout.trim()}`,
			`public_url=${process.env.PUBLIC_URL}`,
			`server_tz=${process.env.SERVER_TZ ?? ""}`,
			`locale=${locale}`,
			`built_at=${new Date().toISOString()}`,
			"",
		].join("\n"),
	);

	mkdirSync(out, { recursive: true });
	const tarball = join(out, `codehood-${version}.tar.gz`);
	execSync(`tar -czf ${tarball} -C ${work} ${SHIPPED.join(" ")}`);
	console.log(`\n✔ ${tarball}`);
} finally {
	if (args.keep) console.log(`Kept ${work}`);
	else rmSync(work, { recursive: true, force: true });
}
