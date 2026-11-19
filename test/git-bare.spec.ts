import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
	assertGitVersion,
	bareRepositoryPath,
	commitSubjects,
	createBareRepository,
	listPaths,
	parseGitVersion,
	readMain,
	removeBareRepository,
	repositoryBytes,
} from "@/services/git/bare";
import { TEST_REPOSITORY_ROOT } from "./env";
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
} from "./git-server";

/// The lifecycle of a bare repository on disk, checked against the real `git`
/// binary: configuration, seeding from a template, listing and removal.

let server: GitServer;

test.beforeAll(async () => {
	server = await startGitServer(() => defaultRules());
});

test.afterAll(async () => {
	await server.close();
});

test.afterEach(() => {
	cleanupGitTest();
});

test.describe("bareRepositoryPath", () => {
	test("builds <root>/<id>.git for a positive integer id", () => {
		expect(bareRepositoryPath(42)).toBe(
			path.join(TEST_REPOSITORY_ROOT, "42.git"),
		);
	});

	// An id that reaches the filesystem unchecked could escape the root.
	for (const bad of [0, -1, 1.5, Number.NaN, 2 ** 53, "1/../x" as never]) {
		test(`throws for the malicious id ${String(bad)}`, () => {
			expect(() => bareRepositoryPath(bad)).toThrow();
		});
	}
});

test.describe("createBareRepository", () => {
	test("applies the receive and pack settings, main as HEAD and sha1 objects", async () => {
		const id = freshTeamId();
		await createBareRepository(id);
		const dir = bareRepositoryPath(id);
		const config = async (key: string) =>
			(await git(dir, ["config", "--get", key])).stdout.trim();
		expect(await config("receive.fsckObjects")).toBe("true");
		expect(await config("receive.denyNonFastForwards")).toBe("true");
		expect(await config("receive.denyDeletes")).toBe("true");
		expect(await config("receive.autogc")).toBe("false");
		expect(await config("pack.threads")).toBe("1");
		expect((await git(dir, ["symbolic-ref", "HEAD"])).stdout.trim()).toBe(
			"refs/heads/main",
		);
		expect(
			(await git(dir, ["rev-parse", "--show-object-format"])).stdout.trim(),
		).toBe("sha1");
	});

	test("throws for an id that already has a repository and keeps its main", async () => {
		const id = freshTeamId();
		const built = buildSeed({ "a.txt": "a" });
		await createBareRepository(id, seedOf(built.head, built.objects));
		await expect(createBareRepository(id)).rejects.toThrow();
		expect(await readMain(id)).toBe(built.head);
	});

	test("seeds objects faithfully: readMain and a clone give the template's sha and files", async () => {
		const id = freshTeamId();
		const built = buildSeed({
			"README.md": "# template\n",
			"src/main.py": "print('hi')\n",
			"src/lib/util.py": "x = 1\n",
		});
		await createBareRepository(id, seedOf(built.head, built.objects));
		expect(await readMain(id)).toBe(built.head);

		const dir = await cloneInto(server.url(id, "key"));
		expect((await git(dir, ["rev-parse", "HEAD"])).stdout.trim()).toBe(
			built.head,
		);
		expect((await git(dir, ["ls-files"])).stdout.split("\n").sort()).toEqual([
			"",
			"README.md",
			"src/lib/util.py",
			"src/main.py",
		]);
		expect((await git(dir, ["show", "HEAD:src/main.py"])).stdout).toBe(
			"print('hi')\n",
		);
	});

	test("throws for an incomplete seed and leaves no folder behind", async () => {
		const id = freshTeamId();
		const built = buildSeed({
			"src/a.txt": "a",
			"src/b.txt": "b",
			"c.txt": "c",
		});
		// Objects come blobs first, then trees, the root last: drop a subtree.
		const trees = built.objects.filter((o) => o.kind === "tree");
		const missing = trees[0];
		const objects = built.objects.filter((o) => o !== missing);
		await expect(
			createBareRepository(id, seedOf(built.head, objects)),
		).rejects.toThrow();
		expect(existsSync(bareRepositoryPath(id))).toBe(false);
	});

	test("without a seed readMain is null and an empty clone works", async () => {
		const id = freshTeamId();
		await createBareRepository(id);
		expect(await readMain(id)).toBeNull();
		const dir = await cloneInto(server.url(id, "key"));
		expect((await git(dir, ["status", "--short"])).stdout).toBe("");
	});
});

test.describe("listPaths", () => {
	test("lists file paths raw: nested, with space, accents and double quotes", async () => {
		const id = freshTeamId();
		const files = {
			"a/b/c.txt": "1",
			"with space.txt": "2",
			"açaí/é.txt": "3",
			'say "hi".txt': "4",
			"top.txt": "5",
		};
		const built = buildSeed(files);
		await createBareRepository(id, seedOf(built.head, built.objects));
		const paths = await listPaths(id, "refs/heads/main");
		expect([...paths].sort()).toEqual(Object.keys(files).sort());
		// A sha is a revision too.
		expect([...(await listPaths(id, built.head))].sort()).toEqual(
			Object.keys(files).sort(),
		);
	});
});

test.describe("commitSubjects", () => {
	test("reads the first line of each commit message by sha", async () => {
		const id = freshTeamId();
		const built = buildSeed({ "a.txt": "1" });
		await createBareRepository(id, seedOf(built.head, built.objects));
		const subjects = await commitSubjects(id, [
			built.head,
			built.head,
			"0".repeat(40),
			"--not-a-sha",
		]);
		expect([...subjects.keys()]).toEqual([built.head]);
		expect(subjects.get(built.head)).toBeTruthy();
	});
});

test.describe("repositoryBytes", () => {
	test("grows after a push of 1 MB of random data", async () => {
		const id = freshTeamId();
		await createBareRepository(id);
		const before = await repositoryBytes(id);
		const dir = await cloneInto(server.url(id, "key"));
		await commitFiles(dir, { "big.bin": incompressible(1_000_000) });
		await git(dir, ["push", "--quiet", "origin", "main"]);
		expect(await repositoryBytes(id)).toBeGreaterThan(before + 900_000);
	});
});

test.describe("removeBareRepository", () => {
	test("deletes the folder", async () => {
		const id = freshTeamId();
		await createBareRepository(id);
		expect(existsSync(bareRepositoryPath(id))).toBe(true);
		await removeBareRepository(id);
		expect(existsSync(bareRepositoryPath(id))).toBe(false);
	});

	test("throws for an invalid id", async () => {
		await expect(removeBareRepository(0)).rejects.toThrow();
		await expect(removeBareRepository("../x" as never)).rejects.toThrow();
	});
});

test.describe("git version", () => {
	test("parseGitVersion reads major and minor, ignoring suffixes", () => {
		expect(parseGitVersion("git version 2.29.0")).toEqual({
			major: 2,
			minor: 29,
		});
		expect(parseGitVersion("git version 2.30.0")).toEqual({
			major: 2,
			minor: 30,
		});
		expect(parseGitVersion("git version 2.56.1.windows.1")).toEqual({
			major: 2,
			minor: 56,
		});
		expect(parseGitVersion("not a version")).toBeNull();
		expect(parseGitVersion("")).toBeNull();
	});

	test("assertGitVersion rejects a missing binary with a message that names git", async () => {
		await expect(assertGitVersion("/nonexistent/git")).rejects.toThrow(/git/i);
	});

	test("assertGitVersion accepts the git of this machine", async () => {
		await expect(assertGitVersion()).resolves.toBeUndefined();
	});
});
