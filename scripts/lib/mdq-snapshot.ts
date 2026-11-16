/**
 * Reads the state of the sibling checkout `../mdq` (git, files, build output)
 * into the snapshot `scripts/lib/siblings.ts` judges.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
	distState,
	type MdqSnapshot,
	packageJsonVersion,
	pyprojectLowerBound,
	pyprojectVersion,
} from "./siblings";

/// The codehood checkout, where the scripts run from.
export const ROOT = path.resolve(import.meta.dirname, "../..");

/// The sibling checkout of mdq-spec.
export const MDQ_DIR = path.resolve(ROOT, "../mdq");

/// The file that pins the mdq commit codehood is built and tested against.
export const MDQ_REF_FILE = path.join(ROOT, ".mdq-ref");

/// Paths of `../mdq` the server and the CLI consume.
export const MDQ_WATCHED = ["mdq-js", "mdq-py", "schema"];

/// Runs git in `../mdq`; null when it fails.
function mdqGit(...args: string[]): string | null {
	const result = spawnSync("git", ["-C", MDQ_DIR, ...args], {
		encoding: "utf8",
	});
	return result.status === 0 ? result.stdout.trim() : null;
}

/** HEAD of `../mdq`, or null when it is not a git checkout. */
export function mdqHead(): string | null {
	return mdqGit("rev-parse", "HEAD");
}

/** Porcelain lines of uncommitted changes in the watched paths of `../mdq`. */
export function mdqDirty(): string[] {
	const status = mdqGit("status", "--porcelain", "--", ...MDQ_WATCHED) ?? "";
	return status.split("\n").filter(Boolean);
}

/** Whether `sha` is contained in a remote-tracking branch of `../mdq` (as of the last fetch). */
export function mdqPushed(sha: string): boolean {
	return (mdqGit("branch", "--remotes", "--contains", sha) ?? "") !== "";
}

/** Fetches `origin` in `../mdq`; false when it fails. */
export function mdqFetch(): boolean {
	return mdqGit("fetch", "--quiet", "origin") !== null;
}

/// Newest mtime in ms of the files under `entries`, or null when there are none.
function newestMtime(entries: string[]): number | null {
	let newest: number | null = null;
	const visit = (entry: string) => {
		if (!existsSync(entry)) return;
		const stat = statSync(entry);
		if (stat.isDirectory()) {
			for (const child of readdirSync(entry)) visit(path.join(entry, child));
		} else if (newest === null || stat.mtimeMs > newest) {
			newest = stat.mtimeMs;
		}
	};
	for (const entry of entries) visit(entry);
	return newest;
}

/** Whether the build output of `mdq-js` is newer than everything it is built from. */
export function mdqDist(): MdqSnapshot["dist"] {
	const js = path.join(MDQ_DIR, "mdq-js");
	const sources = newestMtime([
		path.join(js, "src"),
		path.join(js, "package.json"),
		path.join(js, "tsconfig.build.json"),
		path.join(js, "tsconfig.json"),
	]);
	return distState(newestMtime([path.join(js, "dist")]), sources ?? 0);
}

/// The text of a file, or null when it does not exist.
function readOrNull(file: string): string | null {
	return existsSync(file) ? readFileSync(file, "utf8") : null;
}

/** The versions of the mdq packages and the lower bound the CLI requires. */
export function mdqVersions(): MdqSnapshot["versions"] {
	const js = readOrNull(path.join(MDQ_DIR, "mdq-js/package.json"));
	const schema = readOrNull(path.join(MDQ_DIR, "schema/package.json"));
	const py = readOrNull(path.join(MDQ_DIR, "mdq-py/pyproject.toml"));
	const cli = readOrNull(path.join(ROOT, "cli/pyproject.toml"));
	return {
		js: js && packageJsonVersion(js),
		schema: schema && packageJsonVersion(schema),
		py: py && pyprojectVersion(py),
		cliBound: cli && pyprojectLowerBound(cli, "mdq"),
	};
}

/** The content of `.mdq-ref`, trimmed; null when the file is missing. */
export function readMdqRef(): string | null {
	return readOrNull(MDQ_REF_FILE)?.trim() ?? null;
}
