import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { REPOSITORY_ROOT } from "@/core/constants";

/// The shared `pre-receive` hook of team repositories: the rules it enforces,
/// and the files that put it on disk.

/// The messages a refused push shows. `{path}` and `{limit}` are replaced.
export type PushMessages = {
	wrongRef: string;
	closed: string;
	notEnrolled: string;
	fileTooLarge: string;
	pathDenied: string;
	repositoryFull: string;
};

/// What the hook enforces on one push.
export type PushRules = {
	/// The assignment no longer accepts pushes.
	closed: boolean;
	/// The student pushing has an active enrollment.
	enrolled: boolean;
	/// Largest accepted new file, in bytes.
	maxFileBytes: number;
	/// Largest the repository may grow to, in bytes.
	maxRepoBytes: number;
	/// Globs of paths no push may add.
	deny: string[];
	messages: PushMessages;
};

/// What reaches the hook: the rules plus whether the repository has no room.
export type HookRules = PushRules & { full: boolean };

/// The environment variable that carries the JSON of {@link HookRules}.
export const PUSH_RULES_ENV = "CODEHOOD_PUSH_RULES";

/// The Node script with the rules. It imports only `node:` modules.
const HOOK_SCRIPT = String.raw`import { spawnSync } from "node:child_process";
import path from "node:path";

const ZERO = "0".repeat(40);
const GIT = ["-c", "core.quotePath=false"];

function fail(text) {
	process.stderr.write(text + "\n");
	process.exit(1);
}

let rules;
try {
	rules = JSON.parse(process.env.${PUSH_RULES_ENV} ?? "");
} catch {
	fail("push rules are missing");
}
if (!rules || typeof rules !== "object") fail("push rules are missing");

function size(bytes) {
	// Binary units, as the instance configuration reads them ("10mb").
	const MB = 1024 * 1024;
	if (bytes >= MB) return (bytes / MB).toFixed(bytes % MB ? 1 : 0) + " MB";
	if (bytes >= 1024) return (bytes / 1024).toFixed(bytes % 1024 ? 1 : 0) + " kB";
	return bytes + " B";
}

function refuse(key, vars = {}) {
	const template = rules.messages?.[key] ?? "push refused";
	fail(
		template
			.replaceAll("{path}", () => vars.path ?? "")
			.replaceAll("{limit}", () => vars.limit ?? ""),
	);
}

function git(args, input) {
	const result = spawnSync("git", [...GIT, ...args], {
		input,
		maxBuffer: 1 << 30,
	});
	if (result.status !== 0) {
		fail("git " + args[0] + " failed: " + (result.stderr ?? "").toString("utf8"));
	}
	return result.stdout.toString("utf8");
}

if (!rules.enrolled) refuse("notEnrolled");
if (rules.closed) refuse("closed");
if (rules.full) refuse("repositoryFull");

let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
const updates = stdin
	.split("\n")
	.filter(Boolean)
	.map((line) => {
		const [, next, ref] = line.split(" ");
		return { next, ref };
	});

for (const update of updates) {
	if (update.ref !== "refs/heads/main") refuse("wrongRef");
}

const tips = updates.map((update) => update.next).filter((sha) => sha !== ZERO);
if (tips.length === 0) process.exit(0);

// Objects that arrive with this push: not reachable from any existing ref.
const fresh = git(["rev-list", "--objects", ...tips, "--not", "--all"])
	.split("\n")
	.filter(Boolean)
	.map((line) => {
		const space = line.indexOf(" ");
		return space < 0
			? { sha: line, path: "" }
			: { sha: line.slice(0, space), path: line.slice(space + 1) };
	});

const named = fresh.filter((object) => object.path);
if (named.length > 0) {
	const checked = git(
		["cat-file", "--batch-check"],
		named.map((object) => object.sha).join("\n") + "\n",
	)
		.split("\n")
		.filter(Boolean);
	named.forEach((object, index) => {
		const [, type, bytes] = checked[index].split(" ");
		if (type === "blob" && Number(bytes) > rules.maxFileBytes) {
			refuse("fileTooLarge", {
				path: object.path,
				limit: size(rules.maxFileBytes),
			});
		}
	});
}

function denied(file) {
	const parts = file.split("/");
	for (let end = 1; end <= parts.length; end++) {
		const prefix = parts.slice(0, end).join("/");
		if (rules.deny.some((glob) => path.matchesGlob(prefix, glob))) return true;
	}
	return false;
}

const commits = git(["rev-list", ...tips, "--not", "--all"]).split("\n").filter(Boolean);
for (const commit of commits) {
	const raw = git([
		"diff-tree", "-r", "-z", "-m", "--root", "--no-renames", "--no-commit-id", "--raw", commit,
	]).split("\0");
	for (let index = 0; index + 1 < raw.length; index += 2) {
		const meta = raw[index];
		const file = raw[index + 1];
		if (meta.endsWith(" D")) continue;
		if (denied(file)) refuse("pathDenied", { path: file });
	}
}
`;

/// Wraps `value` in single quotes for `sh`.
function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** The folder with the shared hooks, which every receive call points git at. */
export function hooksDirectory(): string {
	// Absolute: git resolves a relative `core.hooksPath` against the repository,
	// would find no hook there and accept the push with no rules.
	return path.resolve(REPOSITORY_ROOT, "_hooks");
}

/// Writes `content` to `target` unless it already holds exactly that.
async function ensureFile(target: string, content: string): Promise<void> {
	try {
		if ((await readFile(target, "utf8")) === content) return;
	} catch {
		// Missing or unreadable: write it.
	}
	const temporary = `${target}.${randomBytes(6).toString("hex")}.tmp`;
	try {
		await writeFile(temporary, content, { mode: 0o755 });
		await rename(temporary, target);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}

/** Installs the shared `pre-receive` hook and returns its folder. */
export async function installPreReceiveHook(): Promise<string> {
	const dir = hooksDirectory();
	await mkdir(dir, { recursive: true });
	const script = path.join(dir, "pre-receive.mjs");
	await ensureFile(script, HOOK_SCRIPT);
	await ensureFile(
		path.join(dir, "pre-receive"),
		`#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(script)} "$@"\n`,
	);
	return dir;
}
