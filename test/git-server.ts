import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream";
import { createGunzip } from "node:zlib";
import {
	advertiseRefs,
	bareRepositoryPath,
	GitBusyError,
	receivePack,
	uploadPack,
} from "@/services/git/bare";
import type { PushRules } from "@/services/git/hook";
import {
	blobSha,
	buildTrees,
	type GitFileEntry,
	type GitObjectKind,
	objectSha,
	serializeCommit,
} from "@/services/git/objects";

/// Support for the specs that drive the bare repositories of teams with the
/// real `git` binary, through a smart HTTP server that lives in the test
/// process.

//
// Isolated git environment
//

/// A throwaway `HOME` shared by every git call of this process, so the
/// developer's own configuration never leaks into a test.
const GIT_HOME = mkdtempSync(path.join(os.tmpdir(), "codehood-git-home-"));
const GIT_GLOBAL_CONFIG = path.join(GIT_HOME, "gitconfig");
writeFileSync(
	GIT_GLOBAL_CONFIG,
	[
		"[init]",
		"\tdefaultBranch = main",
		"[user]",
		"\tname = Test Student",
		"\temail = student@example.com",
		"[commit]",
		"\tgpgsign = false",
		"[advice]",
		"\tdefaultBranchName = false",
		"",
	].join("\n"),
);

const GIT_ENV: NodeJS.ProcessEnv = {
	PATH: process.env.PATH,
	HOME: GIT_HOME,
	GIT_CONFIG_GLOBAL: GIT_GLOBAL_CONFIG,
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_TERMINAL_PROMPT: "0",
	GIT_AUTHOR_NAME: "Test Student",
	GIT_AUTHOR_EMAIL: "student@example.com",
	GIT_AUTHOR_DATE: "2023-11-14T22:13:20+0000",
	GIT_COMMITTER_NAME: "Test Student",
	GIT_COMMITTER_EMAIL: "student@example.com",
	GIT_COMMITTER_DATE: "2023-11-14T22:13:20+0000",
	// The git server lives on loopback; a proxy would swallow the request.
	NO_PROXY: "127.0.0.1,localhost",
	no_proxy: "127.0.0.1,localhost",
};

export type GitResult = { code: number; stdout: string; stderr: string };

/**
 * Runs the git binary in `cwd` with an isolated environment.
 *
 * It is asynchronous on purpose: the HTTP server of {@link startGitServer}
 * lives in this very process, and a blocking call would deadlock it.
 *
 * @throws Error when git exits non-zero and `allowFail` is not set.
 */
export async function git(
	cwd: string,
	args: string[],
	options: { allowFail?: boolean; input?: Buffer | string } = {},
): Promise<GitResult> {
	const child = spawn("git", args, { cwd, env: GIT_ENV });
	const out: Buffer[] = [];
	const err: Buffer[] = [];
	child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
	child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
	child.stdin.on("error", () => {});
	child.stdin.end(options.input);
	const code = await new Promise<number>((resolve, reject) => {
		child.on("error", reject);
		child.on("close", (status) => resolve(status ?? -1));
	});
	const result = {
		code,
		stdout: Buffer.concat(out).toString("utf8"),
		stderr: Buffer.concat(err).toString("utf8"),
	};
	if (code !== 0 && !options.allowFail) {
		throw new Error(
			`git ${args.join(" ")} exited ${code}\n${result.stderr}${result.stdout}`,
		);
	}
	return result;
}

//
// Ids and scratch directories
//

/// Spec files of one run share the repository root and may be loaded in the
/// same process, so ids start from a random base and then count up.
let nextTeamId = 1_000_000 + Math.floor(Math.random() * 2 ** 40);

const createdTeams = new Set<number>();
const workDirs: string[] = [];

/** A team id that no other spec file of the run uses. */
export function freshTeamId(): number {
	const id = nextTeamId++;
	createdTeams.add(id);
	return id;
}

/** A new empty directory outside the project, removed by {@link cleanupGitTest}. */
export function workDir(label = "work"): string {
	const dir = mkdtempSync(path.join(os.tmpdir(), `codehood-git-${label}-`));
	workDirs.push(dir);
	return dir;
}

/** Removes the repositories of every {@link freshTeamId} and every {@link workDir}. */
export function cleanupGitTest(): void {
	for (const id of createdTeams) {
		rmSync(bareRepositoryPath(id), { recursive: true, force: true });
	}
	createdTeams.clear();
	for (const dir of workDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
}

//
// Rules and server
//

/** Rules that accept an enrolled student's push to `main`, with recognisable messages. */
export function defaultRules(overrides: Partial<PushRules> = {}): PushRules {
	return {
		closed: false,
		enrolled: true,
		maxFileBytes: 10_000_000,
		maxRepoBytes: 100_000_000,
		deny: [],
		...overrides,
		messages: {
			wrongRef: "MSG-WRONG-REF only main is accepted",
			closed: "MSG-CLOSED the assignment is closed",
			notEnrolled: "MSG-NOT-ENROLLED no active enrollment",
			fileTooLarge: "MSG-FILE-TOO-LARGE {path} is over {limit}",
			pathDenied: "MSG-PATH-DENIED {path} is not allowed",
			repositoryFull: "MSG-REPOSITORY-FULL no room left",
			...overrides.messages,
		},
	};
}

export type GitServer = {
	/** The remote URL for a team and key; git appends `/info/refs` and friends. */
	url(teamId: number, key: string): string;
	close(): Promise<void>;
};

const ROUTE =
	/^\/(\d+)\/([^/]+)\/(info\/refs|git-upload-pack|git-receive-pack)$/;

async function handle(
	req: IncomingMessage,
	res: ServerResponse,
	rules: (teamId: number) => PushRules,
): Promise<void> {
	const url = new URL(req.url ?? "/", "http://localhost");
	const match = ROUTE.exec(url.pathname);
	if (!match) {
		res.writeHead(404).end();
		return;
	}
	const teamId = Number(match[1]);
	const key = decodeURIComponent(match[2] as string);
	const route = match[3] as string;
	try {
		if (route === "info/refs") {
			const service = url.searchParams.get("service");
			if (service !== "git-upload-pack" && service !== "git-receive-pack") {
				res.writeHead(403).end();
				return;
			}
			// `Git-Protocol` is not forwarded: the client falls back to protocol v0,
			// the one the advertisement of `bare.ts` speaks.
			const body = await advertiseRefs(teamId, service, key);
			res
				.writeHead(200, {
					"Content-Type": `application/x-${service}-advertisement`,
					"Cache-Control": "no-cache",
				})
				.end(body);
			return;
		}
		const input =
			req.headers["content-encoding"] === "gzip"
				? req.pipe(createGunzip())
				: req;
		// Both throw `GitBusyError` here, before any header is written.
		const output =
			route === "git-upload-pack"
				? uploadPack(teamId, input, key)
				: receivePack(teamId, input, key, rules(teamId));
		res.writeHead(200, {
			"Content-Type": `application/x-${route}-result`,
			"Cache-Control": "no-cache",
		});
		pipeline(output, res, () => {});
	} catch (error) {
		if (error instanceof GitBusyError) {
			res
				.writeHead(429, { "Retry-After": String(error.retryAfterSeconds) })
				.end("busy");
			return;
		}
		res.writeHead(500).end(String(error));
	}
}

/** Serves the smart HTTP protocol of the bare repositories on a free loopback port. */
export async function startGitServer(
	rules: (teamId: number) => PushRules,
): Promise<GitServer> {
	const server: Server = createServer((req, res) => {
		void handle(req, res, rules);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: (teamId, key) =>
			`http://127.0.0.1:${port}/${teamId}/${encodeURIComponent(key)}`,
		close: () =>
			new Promise<void>((resolve) => {
				server.close(() => resolve());
				server.closeAllConnections();
			}),
	};
}

//
// Working copies
//

/** Clones `url` into a new work directory and returns it. */
export async function cloneInto(url: string): Promise<string> {
	const dir = path.join(workDir("clone"), "repo");
	await git(path.dirname(dir), ["clone", "--quiet", url, dir]);
	return dir;
}

/** Writes `files` (relative path to content) into `dir` and commits them all. */
export async function commitFiles(
	dir: string,
	files: Record<string, string | Buffer>,
	message = "update",
): Promise<string> {
	for (const [relative, content] of Object.entries(files)) {
		const target = path.join(dir, relative);
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, content);
	}
	await git(dir, ["add", "-A"]);
	await git(dir, ["commit", "--quiet", "-m", message]);
	return (await git(dir, ["rev-parse", "HEAD"])).stdout.trim();
}

/** Random bytes that no compressor shrinks. */
export function incompressible(size: number): Buffer {
	return randomBytes(size);
}

//
// Seeds
//

export type SeedObject = { kind: GitObjectKind; body: Buffer };

const SIGNATURE = {
	name: "Template",
	email: "template@example.com",
	date: new Date(1_700_000_000_000),
};

/** Blobs, trees and the commit of a flat-to-nested file map, with the commit's sha. */
export function buildSeed(files: Record<string, string | Buffer>): {
	head: string;
	objects: SeedObject[];
} {
	const objects: SeedObject[] = [];
	const entries: GitFileEntry[] = [];
	for (const [filePath, content] of Object.entries(files)) {
		const body = Buffer.from(content);
		objects.push({ kind: "blob", body });
		entries.push({ path: filePath, mode: "100644", gitSha: blobSha(body) });
	}
	const { root, trees } = buildTrees(entries);
	for (const tree of trees) objects.push({ kind: "tree", body: tree.body });
	const commit = serializeCommit({
		tree: root,
		parents: [],
		author: SIGNATURE,
		committer: SIGNATURE,
		message: "template\n",
	});
	objects.push({ kind: "commit", body: commit });
	return { head: objectSha("commit", commit), objects };
}

/** The `seed` argument of `createBareRepository` for `head` and `objects`. */
export function seedOf(
	head: string,
	objects: SeedObject[],
): { head: string; objects: AsyncIterable<SeedObject> } {
	return {
		head,
		objects: (async function* () {
			for (const object of objects) yield object;
		})(),
	};
}
