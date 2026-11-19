import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough, type Readable } from "node:stream";
import { deflateSync } from "node:zlib";
import { REPOSITORY_ROOT } from "@/core/constants";
import {
	type HookRules,
	installPreReceiveHook,
	PUSH_RULES_ENV,
	type PushRules,
} from "./hook";
import { type GitObjectKind, objectHeader, objectSha } from "./objects";

/// Bare repositories of teams on disk, driven by the `git` binary: creation,
/// seeding, reading and the smart HTTP services.

/// Operations that may run at once in this process.
const MAX_OPERATIONS = 4;

/// Longest an operation may run, in milliseconds.
const DEFAULT_TIMEOUT_MS = 60_000;

/// What a refused caller is told to wait, in seconds.
const RETRY_AFTER_SECONDS = 2;

/// Oldest git this server works with.
const MIN_GIT = { major: 2, minor: 30 };

/** Thrown when the ceiling of simultaneous git operations is reached. */
export class GitBusyError extends Error {
	readonly retryAfterSeconds = RETRY_AFTER_SECONDS;

	constructor() {
		super("Too many git operations in progress");
		this.name = "GitBusyError";
	}
}

/** Emitted by the output stream of an operation that ran out of time. */
export class GitTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`Git operation timed out after ${timeoutMs} ms`);
		this.name = "GitTimeoutError";
	}
}

/** Options of a git operation. */
export type GitOperationOptions = { timeoutMs?: number };

/** An object to write into a new repository. */
export type SeedObject = { kind: GitObjectKind; body: Buffer };

/** The objects of a template commit and the sha `main` must point to. */
export type RepositorySeed = {
	head: string;
	objects: AsyncIterable<SeedObject> | Iterable<SeedObject>;
};

//
// Paths and environment
//

/** The folder of the repository of team `teamId`. */
export function bareRepositoryPath(teamId: number): string {
	if (!Number.isSafeInteger(teamId) || teamId <= 0) {
		throw new Error(`Invalid team id: ${String(teamId)}`);
	}
	// Absolute: git resolves a relative path against its own working directory.
	return path.resolve(REPOSITORY_ROOT, `${teamId}.git`);
}

/// The environment of every git process: nothing of the user's or system's
/// configuration, and no inherited `GIT_*` variables.
function gitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
	return {
		PATH: process.env.PATH,
		LC_ALL: "C",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_TERMINAL_PROMPT: "0",
		...extra,
	};
}

type GitOutput = { code: number; stdout: Buffer; stderr: string };

/// Runs git with an argument list and waits for it to finish.
function runGit(
	args: string[],
	options: { input?: Buffer; cwd?: string } = {},
): Promise<GitOutput> {
	return new Promise((resolve, reject) => {
		const child = spawn("git", args, {
			env: gitEnv(),
			cwd: options.cwd,
			stdio: ["pipe", "pipe", "pipe"],
		});
		const out: Buffer[] = [];
		const err: Buffer[] = [];
		child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
		child.stdin.on("error", () => {});
		child.stdin.end(options.input);
		child.on("error", reject);
		child.on("close", (code) =>
			resolve({
				code: code ?? -1,
				stdout: Buffer.concat(out),
				stderr: Buffer.concat(err).toString("utf8"),
			}),
		);
	});
}

/// Like {@link runGit}, but throws when git exits non-zero.
async function mustGit(
	args: string[],
	options: { input?: Buffer; cwd?: string } = {},
): Promise<Buffer> {
	const result = await runGit(args, options);
	if (result.code !== 0) {
		throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
	}
	return result.stdout;
}

//
// Lifecycle
//

/**
 * Creates the bare repository of a team, optionally seeded with a commit.
 *
 * @throws Error when the team already has a repository or the seed is incomplete.
 */
export async function createBareRepository(
	teamId: number,
	seed?: RepositorySeed,
): Promise<void> {
	const dir = bareRepositoryPath(teamId);
	await mkdir(REPOSITORY_ROOT, { recursive: true });
	// Fails with EEXIST when the repository is already there, and leaves it alone.
	await mkdir(dir);
	try {
		await mustGit([
			"init",
			"--bare",
			"--quiet",
			"--template=",
			"--object-format=sha1",
			"--initial-branch=main",
			dir,
		]);
		const settings: [string, string][] = [
			["receive.fsckObjects", "true"],
			["receive.denyNonFastForwards", "true"],
			["receive.denyDeletes", "true"],
			["receive.autogc", "false"],
			["pack.threads", "1"],
		];
		for (const [key, value] of settings) {
			await mustGit(["config", key, value], { cwd: dir });
		}
		if (seed) await seedRepository(dir, seed);
	} catch (error) {
		await rm(dir, { recursive: true, force: true });
		throw error;
	}
}

/// Writes the seed objects, checks `head` is complete and points `main` at it.
async function seedRepository(
	dir: string,
	seed: RepositorySeed,
): Promise<void> {
	// Loose objects written directly: a process per object would take seconds
	// on a template with thousands of files.
	for await (const { kind, body } of seed.objects) {
		const sha = objectSha(kind, body);
		const folder = path.join(dir, "objects", sha.slice(0, 2));
		await mkdir(folder, { recursive: true });
		await writeFile(
			path.join(folder, sha.slice(2)),
			deflateSync(Buffer.concat([objectHeader(kind, body.length), body])),
		);
	}
	await mustGit(["rev-list", "--objects", seed.head], { cwd: dir });
	await mustGit(["fsck", "--no-dangling"], { cwd: dir });
	await mustGit(["update-ref", "refs/heads/main", seed.head], { cwd: dir });
}

/** Deletes the repository of a team, if it exists. */
export async function removeBareRepository(teamId: number): Promise<void> {
	await rm(bareRepositoryPath(teamId), { recursive: true, force: true });
}

//
// Reading
//

/** The sha `main` points to, or null when it does not exist yet. */
export async function readMain(teamId: number): Promise<string | null> {
	const result = await runGit([
		"--git-dir",
		bareRepositoryPath(teamId),
		"rev-parse",
		"--verify",
		"--quiet",
		"refs/heads/main",
	]);
	if (result.code === 1) return null;
	if (result.code !== 0)
		throw new Error(`git rev-parse failed: ${result.stderr}`);
	return result.stdout.toString("utf8").trim();
}

/**
 * Lists every file path of the tree at `revision`, raw and without a checkout.
 *
 * @throws Error when the revision does not exist.
 */
export async function listPaths(
	teamId: number,
	revision: string,
): Promise<string[]> {
	if (!revision || revision.startsWith("-")) {
		throw new Error(`Invalid revision: ${revision}`);
	}
	const out = await mustGit([
		"--git-dir",
		bareRepositoryPath(teamId),
		"ls-tree",
		"-r",
		"-z",
		"--name-only",
		revision,
	]);
	return out.toString("utf8").split("\0").filter(Boolean);
}

/**
 * The subject line of each commit in `shas`, by sha, read without a checkout.
 *
 * A sha the repository lacks is left out of the result.
 */
export async function commitSubjects(
	teamId: number,
	shas: readonly string[],
): Promise<Map<string, string>> {
	const subjects = new Map<string, string>();
	const wanted = [...new Set(shas)].filter((sha) => /^[0-9a-f]{40}$/.test(sha));
	await Promise.all(
		wanted.map(async (sha) => {
			const result = await runGit([
				"--git-dir",
				bareRepositoryPath(teamId),
				"log",
				"--no-walk",
				"--format=%s",
				sha,
				"--",
			]);
			if (result.code === 0) {
				subjects.set(sha, result.stdout.toString("utf8").split("\n")[0] ?? "");
			}
		}),
	);
	return subjects;
}

/** The total size in bytes of every file of the repository of a team. */
export async function repositoryBytes(teamId: number): Promise<number> {
	return directoryBytes(bareRepositoryPath(teamId));
}

async function directoryBytes(dir: string): Promise<number> {
	let total = 0;
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) total += await directoryBytes(full);
		else if (entry.isFile()) total += (await stat(full)).size;
	}
	return total;
}

//
// Git version
//

/** Reads major and minor from the output of `git --version`, or null. */
export function parseGitVersion(
	text: string,
): { major: number; minor: number } | null {
	const match = /git version (\d+)\.(\d+)/.exec(text);
	if (!match) return null;
	return { major: Number(match[1]), minor: Number(match[2]) };
}

/**
 * Checks that the git binary exists and is 2.30 or newer.
 *
 * @throws Error when git is missing, unreadable or too old.
 */
export async function assertGitVersion(binary = "git"): Promise<void> {
	const text = await new Promise<string>((resolve, reject) => {
		execFile(binary, ["--version"], { env: gitEnv() }, (error, stdout) => {
			if (error) {
				reject(
					new Error(
						`The git binary (${binary}) is not available: ${error.message}`,
					),
				);
			} else resolve(stdout);
		});
	});
	const version = parseGitVersion(text);
	if (!version)
		throw new Error(`Cannot read the git version from "${text.trim()}"`);
	const old =
		version.major < MIN_GIT.major ||
		(version.major === MIN_GIT.major && version.minor < MIN_GIT.minor);
	if (old) {
		throw new Error(
			`git ${MIN_GIT.major}.${MIN_GIT.minor} or newer is required, found ${version.major}.${version.minor}`,
		);
	}
}

//
// Ceilings
//

let running = 0;
const runningKeys = new Set<string>();

/// Takes a slot for `key` and returns the function that frees it.
function acquire(key: string): () => void {
	if (running >= MAX_OPERATIONS || runningKeys.has(key)) {
		throw new GitBusyError();
	}
	running++;
	runningKeys.add(key);
	let freed = false;
	return () => {
		if (freed) return;
		freed = true;
		running--;
		runningKeys.delete(key);
	};
}

//
// Smart HTTP
//

type Spec = { args: string[]; env: NodeJS.ProcessEnv };

/// Runs one stateless git service under the ceilings and the timeout.
///
/// The slot is freed on the first of: the process closing, the output stream
/// closing (normal end, error or destroyed by the consumer) and the timeout.
function operate(
	key: string,
	timeoutMs: number,
	prepare: () => Promise<Spec>,
	input?: Readable,
): Readable {
	const release = acquire(key);
	const out = new PassThrough();
	let child: ChildProcess | undefined;
	let bytes = 0;

	const kill = () => {
		if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
			return;
		}
		try {
			process.kill(-child.pid, "SIGKILL");
		} catch {
			child.kill("SIGKILL");
		}
	};
	const timer = setTimeout(() => {
		out.destroy(new GitTimeoutError(timeoutMs));
		kill();
		release();
	}, timeoutMs);
	const finish = () => {
		clearTimeout(timer);
		release();
	};
	out.once("close", () => {
		kill();
		finish();
	});
	// A failing request body fails the response; without a listener the
	// error would be thrown at the process.
	input?.on("error", (error) => out.destroy(error));

	void (async () => {
		let spec: Spec;
		try {
			spec = await prepare();
		} catch (error) {
			out.destroy(error as Error);
			return;
		}
		if (out.destroyed) return;
		const proc = spawn("git", spec.args, {
			env: spec.env,
			detached: true,
			stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
		});
		child = proc;
		const stderr: Buffer[] = [];
		proc.stderr?.on("data", (chunk: Buffer) => {
			stderr.push(chunk);
			if (stderr.length > 64) stderr.shift();
		});
		proc.stdout?.on("data", (chunk: Buffer) => {
			bytes += chunk.length;
		});
		proc.stdout?.pipe(out, { end: false });
		proc.once("error", (error) => {
			finish();
			out.destroy(error);
		});
		proc.once("close", (code) => {
			finish();
			if (out.destroyed) return;
			// A refusal travels in the body, so only an empty failure is an error.
			if (code !== 0 && bytes === 0) {
				out.destroy(
					new Error(
						`git exited with ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`,
					),
				);
			} else out.end();
		});
		if (input && proc.stdin) {
			const stdin = proc.stdin;
			stdin.on("error", () => {});
			input.pipe(stdin);
			const closeStdin = () => {
				if (!input.readableEnded) stdin.end();
			};
			if (input.destroyed) closeStdin();
			else input.once("close", closeStdin);
		}
	})();
	return out;
}

/// Reads a whole stream into a buffer.
async function collect(stream: Readable): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks);
}

/** The ref advertisement of a smart HTTP `info/refs` response. */
export async function advertiseRefs(
	teamId: number,
	service: "git-upload-pack" | "git-receive-pack",
	key: string,
	options: GitOperationOptions = {},
): Promise<Buffer> {
	const dir = bareRepositoryPath(teamId);
	const output = operate(
		key,
		options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		async () => ({
			args: [service.slice(4), "--stateless-rpc", "--advertise-refs", dir],
			env: gitEnv(),
		}),
	);
	const body = await collect(output);
	const line = `# service=${service}\n`;
	const length = (line.length + 4).toString(16).padStart(4, "0");
	return Buffer.concat([Buffer.from(`${length}${line}0000`), body]);
}

/**
 * Serves a fetch or clone request: `input` is the request body, the result the response.
 *
 * @throws GitBusyError when the ceilings are reached.
 */
export function uploadPack(
	teamId: number,
	input: Readable,
	key: string,
	options: GitOperationOptions = {},
): Readable {
	const dir = bareRepositoryPath(teamId);
	return operate(
		key,
		options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		async () => ({
			args: ["upload-pack", "--stateless-rpc", dir],
			env: gitEnv(),
		}),
		input,
	);
}

/**
 * Receives a push under `rules`: `input` is the request body, the result the response.
 *
 * @throws GitBusyError when the ceilings are reached.
 */
export function receivePack(
	teamId: number,
	input: Readable,
	key: string,
	rules: PushRules,
	options: GitOperationOptions = {},
): Readable {
	const dir = bareRepositoryPath(teamId);
	return operate(
		key,
		options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		async () => {
			const hooks = await installPreReceiveHook();
			const room = rules.maxRepoBytes - (await repositoryBytes(teamId));
			// A limit of zero would turn the check off in git, so a full
			// repository is left to the hook.
			const full = room <= 0;
			const hookRules: HookRules = { ...rules, full };
			const args = ["-c", `core.hooksPath=${hooks}`];
			if (!full) args.push("-c", `receive.maxInputSize=${room}`);
			args.push("receive-pack", "--stateless-rpc", dir);
			return {
				args,
				env: gitEnv({ [PUSH_RULES_ENV]: JSON.stringify(hookRules) }),
			};
		},
		input,
	);
}
