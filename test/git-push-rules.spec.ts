import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
	bareRepositoryPath,
	createBareRepository,
	readMain,
	repositoryBytes,
} from "@/services/git/bare";
import type { PushRules } from "@/services/git/hook";
import {
	buildSeed,
	cleanupGitTest,
	cloneInto,
	commitFiles,
	defaultRules,
	freshTeamId,
	type GitServer,
	git,
	incompressible,
	seedOf,
	startGitServer,
	workDir,
} from "./git-server";

/// Every refusal of a push, observed from the student's terminal: the real
/// `git push` against the bare repository, through the smart HTTP server of
/// the helper.

const rulesByTeam = new Map<number, PushRules>();
let server: GitServer;

test.beforeAll(async () => {
	server = await startGitServer((id) => rulesByTeam.get(id) ?? defaultRules());
});

test.afterAll(async () => {
	await server.close();
});

test.afterEach(() => {
	rulesByTeam.clear();
	cleanupGitTest();
});

type Team = { id: number; dir: string };

/** A repository (empty or seeded), the rules it starts under, and a clone of it. */
async function newTeam(
	options: {
		files?: Record<string, string | Buffer>;
		rules?: Partial<PushRules>;
	} = {},
): Promise<Team> {
	const id = freshTeamId();
	if (options.files) {
		const built = buildSeed(options.files);
		await createBareRepository(id, seedOf(built.head, built.objects));
	} else {
		await createBareRepository(id);
	}
	rulesByTeam.set(id, defaultRules(options.rules));
	return { id, dir: await cloneInto(server.url(id, "key")) };
}

function rules(team: Team, overrides: Partial<PushRules>): PushRules {
	const next = defaultRules(overrides);
	rulesByTeam.set(team.id, next);
	return next;
}

async function push(team: Team, ...args: string[]) {
	return git(team.dir, ["push", "origin", ...args], { allowFail: true });
}

async function firstPush(team: Team): Promise<string> {
	const sha = await commitFiles(team.dir, { "first.txt": "first\n" });
	const result = await push(team, "main");
	expect(result.code, result.stderr).toBe(0);
	return sha;
}

test.describe("hooks of the repository itself", () => {
	test("neither its own hooks nor a core.hooksPath in its config run, and the server hook still does", async () => {
		const team = await newTeam();
		const bare = bareRepositoryPath(team.id);
		const markers = workDir("markers");
		const hook = (name: string) =>
			`#!/bin/sh\ntouch "${path.join(markers, name)}"\nexit 1\n`;
		mkdirSync(path.join(bare, "hooks"), { recursive: true });
		for (const name of ["pre-receive", "post-update"]) {
			writeFileSync(path.join(bare, "hooks", name), hook(name), {
				mode: 0o755,
			});
		}
		const elsewhere = workDir("hookspath");
		writeFileSync(
			path.join(elsewhere, "pre-receive"),
			hook("path-pre-receive"),
			{
				mode: 0o755,
			},
		);
		await git(bare, ["config", "core.hooksPath", elsewhere]);

		await commitFiles(team.dir, { "a.txt": "a\n" });
		const accepted = await push(team, "main");
		expect(accepted.code, accepted.stderr).toBe(0);
		for (const name of ["pre-receive", "post-update", "path-pre-receive"]) {
			expect(existsSync(path.join(markers, name))).toBe(false);
		}

		const refused = await push(team, "HEAD:refs/heads/feature");
		expect(refused.code).not.toBe(0);
		expect(refused.stderr).toContain("remote: MSG-WRONG-REF");
	});
});

test.describe("malformed and rewritten history", () => {
	test("a tree with a .git entry is refused and main does not move", async () => {
		const team = await newTeam();
		const good = await firstPush(team);
		const blob = (
			await git(team.dir, ["hash-object", "-w", "--stdin"], { input: "x" })
		).stdout.trim();
		// mode, name, NUL, then the 20 raw bytes of the blob sha.
		const body = Buffer.concat([
			Buffer.from("100644 .git\0"),
			Buffer.from(blob, "hex"),
		]);
		const tree = (
			await git(
				team.dir,
				["hash-object", "-t", "tree", "--literally", "-w", "--stdin"],
				{
					input: body,
				},
			)
		).stdout.trim();
		const commit = (
			await git(team.dir, ["commit-tree", tree, "-p", good, "-m", "evil"])
		).stdout.trim();
		await git(team.dir, ["update-ref", "refs/heads/main", commit]);

		const result = await push(team, "main");
		expect(result.code).not.toBe(0);
		expect(await readMain(team.id)).toBe(good);
	});

	test("a force-push of rewritten history is refused", async () => {
		const team = await newTeam();
		const good = await firstPush(team);
		await git(team.dir, ["commit", "--amend", "--quiet", "-m", "rewritten"]);
		const result = await push(team, "--force", "main");
		expect(result.code).not.toBe(0);
		expect(await readMain(team.id)).toBe(good);
	});

	test("deleting main with an empty source is refused", async () => {
		const team = await newTeam();
		const good = await firstPush(team);
		const result = await push(team, ":main");
		expect(result.code).not.toBe(0);
		expect(await readMain(team.id)).toBe(good);
	});
});

test.describe("refs other than main", () => {
	test("a branch and a tag are refused with the wrong-ref message", async () => {
		const team = await newTeam();
		await firstPush(team);
		const branch = await push(team, "HEAD:refs/heads/feature");
		expect(branch.code).not.toBe(0);
		expect(branch.stderr).toContain(
			"remote: MSG-WRONG-REF only main is accepted",
		);

		await git(team.dir, ["tag", "v1"]);
		const tag = await push(team, "v1");
		expect(tag.code).not.toBe(0);
		expect(tag.stderr).toContain("remote: MSG-WRONG-REF only main is accepted");
	});

	test("main and a tag in one push are all refused and main does not move", async () => {
		const team = await newTeam();
		const good = await firstPush(team);
		await commitFiles(team.dir, { "second.txt": "2\n" });
		await git(team.dir, ["tag", "v1"]);
		const result = await push(team, "main", "v1");
		expect(result.code).not.toBe(0);
		expect(await readMain(team.id)).toBe(good);
	});
});

test.describe("closed assignment and enrollment", () => {
	test("a closed assignment refuses the push with its message and still clones", async () => {
		const team = await newTeam();
		await firstPush(team);
		rules(team, { closed: true });
		await commitFiles(team.dir, { "late.txt": "late\n" });
		const result = await push(team, "main");
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain(
			"remote: MSG-CLOSED the assignment is closed",
		);

		const again = await cloneInto(server.url(team.id, "key"));
		expect((await git(again, ["ls-files"])).stdout).toContain("first.txt");
	});

	test("a student without active enrollment is refused with its message", async () => {
		const team = await newTeam({ rules: { enrolled: false } });
		await commitFiles(team.dir, { "a.txt": "a\n" });
		const result = await push(team, "main");
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain(
			"remote: MSG-NOT-ENROLLED no active enrollment",
		);
		expect(await readMain(team.id)).toBeNull();
	});
});

test.describe("file size", () => {
	test("a big file added in one commit and removed in the next of the same push is refused, naming the path", async () => {
		const team = await newTeam({ rules: { maxFileBytes: 100_000 } });
		await commitFiles(team.dir, {
			"data/big.bin": incompressible(200_000),
			"ok.txt": "ok\n",
		});
		await git(team.dir, ["rm", "--quiet", "data/big.bin"]);
		await git(team.dir, ["commit", "--quiet", "-m", "remove it"]);
		const result = await push(team, "main");
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("remote: MSG-FILE-TOO-LARGE data/big.bin");
		expect(await readMain(team.id)).toBeNull();
	});

	test("a big file inherited from the template does not stop a change to another file", async () => {
		const team = await newTeam({
			files: { "big.bin": incompressible(200_000), "notes.txt": "v1\n" },
			rules: { maxFileBytes: 100_000 },
		});
		await commitFiles(team.dir, { "notes.txt": "v2\n" });
		const result = await push(team, "main");
		expect(result.code, result.stderr).toBe(0);
	});
});

test.describe("denied paths", () => {
	const deny = ["**/*.zip", "node_modules/**"];

	test("a nested zip is refused with the path-denied message and its path", async () => {
		const team = await newTeam({ rules: { deny } });
		await commitFiles(team.dir, { "a/b.zip": "zip", "ok.txt": "ok\n" });
		const result = await push(team, "main");
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("remote: MSG-PATH-DENIED a/b.zip");
		expect(await readMain(team.id)).toBeNull();
	});

	test("zip.txt, which only looks like a zip, is accepted", async () => {
		const team = await newTeam({ rules: { deny } });
		await commitFiles(team.dir, { "zip.txt": "not a zip\n" });
		const result = await push(team, "main");
		expect(result.code, result.stderr).toBe(0);
	});

	test("a path under node_modules is refused", async () => {
		const team = await newTeam({ rules: { deny } });
		await commitFiles(team.dir, { "node_modules/pkg/index.js": "x\n" });
		const result = await push(team, "main");
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain(
			"remote: MSG-PATH-DENIED node_modules/pkg/index.js",
		);
	});

	test("the first push into an empty repository is checked too", async () => {
		const team = await newTeam({ rules: { deny } });
		expect(await readMain(team.id)).toBeNull();
		await commitFiles(team.dir, { "x/y.zip": "zip" });
		const result = await push(team, "main");
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("remote: MSG-PATH-DENIED x/y.zip");
		expect(await readMain(team.id)).toBeNull();
	});
});

test.describe("repository size", () => {
	test("a repository already over its limit refuses any push with the full message", async () => {
		const team = await newTeam();
		await firstPush(team);
		rules(team, { maxRepoBytes: (await repositoryBytes(team.id)) - 1 });
		await commitFiles(team.dir, { "tiny.txt": "t\n" });
		const result = await push(team, "main");
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("remote: MSG-REPOSITORY-FULL no room left");
	});

	test("a pack bigger than the room left is refused by git and main does not move", async () => {
		const team = await newTeam();
		const good = await firstPush(team);
		rules(team, { maxRepoBytes: (await repositoryBytes(team.id)) + 100_000 });
		await commitFiles(team.dir, { "big.bin": incompressible(1_000_000) });
		const result = await push(team, "main");
		expect(result.code).not.toBe(0);
		expect(await readMain(team.id)).toBe(good);
	});
});

test.describe("messages", () => {
	test("accents in a message reach the student's terminal intact", async () => {
		const message = "Só a ramificação principal é aceita: ção ã";
		const team = await newTeam({
			rules: { messages: { wrongRef: message } as never },
		});
		await firstPush(team);
		const result = await push(team, "HEAD:refs/heads/outra");
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain(`remote: ${message}`);
	});
});
