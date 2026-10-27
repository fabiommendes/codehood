import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { inflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import {
	blobSha,
	buildTrees,
	compareTreeEntries,
	type GitCommit,
	type GitFileEntry,
	type GitObjectKind,
	type GitSignature,
	type GitTreeEntry,
	looseObject,
	objectHeader,
	objectSha,
	objectStream,
	parseCommit,
	parseTree,
	serializeCommit,
	serializeTree,
} from "@/services/git/objects";
import { TEST_RESOURCE_ROOT } from "./env";
import vectors from "./fixtures/git-vectors.json" with { type: "json" };

/// Git object encoding checked against the real `git` binary and against the
/// shared vector table (`test/fixtures/git-vectors.json`), which the Python
/// CLI consumes too. Every expected sha comes from git, never from this code.

//
// Vectors
//

type VectorContent = { content?: string; contentBase64?: string };
type VectorBlob = VectorContent & { name: string; sha: string };
type VectorFile = VectorContent & {
	path: string;
	mode: "100644" | "100755";
	sha: string;
};
type VectorTree = {
	name: string;
	files: VectorFile[];
	rootSha: string;
	/// Directory path (`""` is the root) to tree sha.
	directories: Record<string, string>;
};
type VectorSignature = {
	name: string;
	email: string;
	timestamp: number;
	timezoneOffset: number;
};
type VectorCommit = {
	name: string;
	tree: string;
	parents: string[];
	author: VectorSignature;
	committer: VectorSignature;
	message: string;
	sha: string;
};

const blobVectors = vectors.blobs as VectorBlob[];
const treeVectors = vectors.trees as unknown as VectorTree[];
const commitVectors = vectors.commits as VectorCommit[];

function bytesOf(vector: VectorContent): Buffer {
	return vector.content !== undefined
		? Buffer.from(vector.content, "utf8")
		: Buffer.from(vector.contentBase64 ?? "", "base64");
}

function fileEntries(tree: VectorTree): GitFileEntry[] {
	return tree.files.map((f) => ({
		path: f.path,
		mode: f.mode,
		gitSha: f.sha,
	}));
}

function signatureOf(vector: VectorSignature): GitSignature {
	return {
		name: vector.name,
		email: vector.email,
		date: new Date(vector.timestamp * 1000),
		timezoneOffset: vector.timezoneOffset,
	};
}

function commitOf(vector: VectorCommit): GitCommit {
	return {
		tree: vector.tree,
		parents: vector.parents,
		author: signatureOf(vector.author),
		committer: signatureOf(vector.committer),
		message: vector.message,
	};
}

//
// Git oracle
//

const oracleRoot = path.join(TEST_RESOURCE_ROOT, "git-oracle");
mkdirSync(oracleRoot, { recursive: true });
const oracleDir = mkdtempSync(path.join(oracleRoot, "repo-"));

function git(args: string[], input?: Buffer | string, env = {}): Buffer {
	return execFileSync("git", ["-c", "core.quotepath=off", ...args], {
		cwd: oracleDir,
		input,
		maxBuffer: 256 * 1024 * 1024,
		env: {
			PATH: process.env.PATH,
			HOME: oracleDir,
			GIT_CONFIG_GLOBAL: "/dev/null",
			GIT_CONFIG_NOSYSTEM: "1",
			...env,
		},
	});
}

function gitText(args: string[], input?: Buffer | string, env = {}): string {
	return git(args, input, env).toString("utf8").trim();
}

function oracleBlob(bytes: Buffer): string {
	return gitText(["hash-object", "-w", "--stdin"], bytes);
}

function oracleTree(
	files: readonly { path: string; mode: string; sha: string }[],
): string {
	git(["read-tree", "--empty"]);
	const info = files.map((f) => `${f.mode} ${f.sha}\t${f.path}\n`).join("");
	git(["update-index", "--add", "--index-info"], info);
	return gitText(["write-tree"]);
}

function gitDate(signature: VectorSignature): string {
	const offset = signature.timezoneOffset;
	const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
	const minutes = String(Math.abs(offset) % 60).padStart(2, "0");
	return `${signature.timestamp} ${offset < 0 ? "-" : "+"}${hours}${minutes}`;
}

function oracleCommit(commit: VectorCommit): string {
	return gitText(
		[
			"commit-tree",
			commit.tree,
			...commit.parents.flatMap((parent) => ["-p", parent]),
		],
		commit.message,
		{
			GIT_AUTHOR_NAME: commit.author.name,
			GIT_AUTHOR_EMAIL: commit.author.email,
			GIT_AUTHOR_DATE: gitDate(commit.author),
			GIT_COMMITTER_NAME: commit.committer.name,
			GIT_COMMITTER_EMAIL: commit.committer.email,
			GIT_COMMITTER_DATE: gitDate(commit.committer),
		},
	);
}

/// Entries of one tree as `git ls-tree` lists them, in git's own order.
function oracleEntries(treeSha: string): GitTreeEntry[] {
	return gitText(["ls-tree", treeSha])
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [meta, name] = line.split("\t") as [string, string];
			const [mode, , sha] = meta.split(" ") as [string, string, string];
			return {
				name,
				mode: (mode === "040000" ? "40000" : mode) as GitTreeEntry["mode"],
				sha,
			};
		});
}

/// Body of an object as git stores it, without the header.
function oracleBody(kind: GitObjectKind, sha: string): Buffer {
	return git(["cat-file", kind, sha]);
}

/// Writes every vector blob and tree into the oracle repository.
function seedOracle(): void {
	for (const blob of blobVectors) oracleBlob(bytesOf(blob));
	for (const tree of treeVectors) {
		for (const file of tree.files) oracleBlob(bytesOf(file));
		oracleTree(tree.files);
	}
	for (const commit of commitVectors) oracleCommit(commit);
}

test.beforeAll(() => {
	git(["init", "-q"]);
	seedOracle();
});

//
// Helpers
//

async function collect(stream: Readable): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks);
}

function sha1(bytes: Buffer): string {
	return createHash("sha1").update(bytes).digest("hex");
}

function entry(
	name: string,
	mode: GitTreeEntry["mode"] = "100644",
	sha = "0".repeat(40),
): GitTreeEntry {
	return { name, mode, sha };
}

/// Deterministic pseudo-random generator, so a failure reproduces.
function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
	}
	return copy;
}

const NAME_PIECES = ["a", "b", "A", "-", ".", "_", "0", "é", "x y", "z"];

/// A random file list in which no path is a directory prefix of another.
function randomFiles(random: () => number): GitFileEntry[] {
	const files: GitFileEntry[] = [];
	const taken = new Set<string>();
	const count = 3 + Math.floor(random() * 12);
	for (let attempt = 0; files.length < count && attempt < 200; attempt++) {
		const depth = 1 + Math.floor(random() * 3);
		const segments = Array.from({ length: depth }, () => {
			const length = 1 + Math.floor(random() * 3);
			return Array.from(
				{ length },
				() => NAME_PIECES[Math.floor(random() * NAME_PIECES.length)],
			).join("");
		});
		if (segments.some((s) => s === "." || s === "..")) continue;
		const filePath = segments.join("/");
		const collides = [...taken].some(
			(other) =>
				other === filePath ||
				other.startsWith(`${filePath}/`) ||
				filePath.startsWith(`${other}/`),
		);
		if (collides) continue;
		taken.add(filePath);
		const content = Buffer.from(`content ${files.length} ${random()}`);
		files.push({
			path: filePath,
			mode: random() < 0.3 ? "100755" : "100644",
			gitSha: oracleBlob(content),
		});
	}
	return files;
}

//
// Blobs
//

test.describe("blob sha", () => {
	test("objectHeader is kind, space, size and NUL", () => {
		expect(objectHeader("blob", 5).toString("latin1")).toBe("blob 5\0");
		expect(objectHeader("tree", 0).toString("latin1")).toBe("tree 0\0");
		expect(objectHeader("commit", 1234).toString("latin1")).toBe(
			"commit 1234\0",
		);
	});

	test("blobSha of no bytes is git's empty blob", () => {
		expect(blobSha(Buffer.alloc(0))).toBe(
			"e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",
		);
	});

	test("objectSha of a tree with no entries is git's empty tree", () => {
		expect(objectSha("tree", Buffer.alloc(0))).toBe(
			"4b825dc642cb6eb9a060e54bf8d69288fbee4904",
		);
	});

	for (const blob of blobVectors) {
		test(`blobSha matches git for ${blob.name}`, () => {
			expect(blobSha(bytesOf(blob))).toBe(blob.sha);
		});
	}

	test("blobSha matches git for a 5 MB file", () => {
		const bytes = Buffer.alloc(5 * 1024 * 1024);
		for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + (i >> 8)) & 255;

		expect(blobSha(bytes)).toBe(oracleBlob(bytes));
	});
});

//
// Tree order
//

test.describe("tree order", () => {
	const dashed = entry("a-b");
	const dotted = entry("a.txt");
	const directory = entry("a", "40000");

	test("a-b, a.txt and the directory a sort in that order", () => {
		const orders = [
			[dashed, dotted, directory],
			[dashed, directory, dotted],
			[dotted, dashed, directory],
			[dotted, directory, dashed],
			[directory, dashed, dotted],
			[directory, dotted, dashed],
		];
		for (const order of orders) {
			expect([...order].sort(compareTreeEntries).map((e) => e.name)).toEqual([
				"a-b",
				"a.txt",
				"a",
			]);
		}
	});

	test("compareTreeEntries is negative, positive and zero as expected", () => {
		expect(compareTreeEntries(dashed, dotted)).toBeLessThan(0);
		expect(compareTreeEntries(dotted, directory)).toBeLessThan(0);
		expect(compareTreeEntries(directory, dashed)).toBeGreaterThan(0);
		expect(compareTreeEntries(dotted, dashed)).toBeGreaterThan(0);
		expect(compareTreeEntries(dotted, entry("a.txt"))).toBe(0);
	});

	test("a file sorts before a longer name and a directory before a name starting above slash", () => {
		expect(compareTreeEntries(entry("a"), entry("a.txt"))).toBeLessThan(0);
		expect(compareTreeEntries(entry("a", "40000"), entry("a0"))).toBeLessThan(
			0,
		);
	});

	test("names compare by bytes, not by locale", () => {
		expect(compareTreeEntries(entry("Z"), entry("a"))).toBeLessThan(0);
		expect(compareTreeEntries(entry("é"), entry("z"))).toBeGreaterThan(0);
	});

	test("the order of the git vector tree is the order git lists", () => {
		const vector = treeVectors.find((t) => t.name.startsWith("git order"));
		expect(vector).toBeDefined();
		const gitNames = oracleEntries(vector?.rootSha ?? "").map((e) => e.name);

		expect(gitNames).toEqual(["a-b", "a.txt", "a"]);
	});
});

//
// Tree serialisation
//

test.describe("serializeTree and parseTree", () => {
	test("serializeTree writes mode, name, NUL and the raw sha", () => {
		const body = serializeTree([entry("f", "100644", "ab".repeat(20))]);

		expect(body).toEqual(
			Buffer.concat([Buffer.from("100644 f\0"), Buffer.alloc(20, 0xab)]),
		);
	});

	test("serializeTree writes a directory mode without a leading zero", () => {
		const body = serializeTree([entry("d", "40000", "cd".repeat(20))]);

		expect(body).toEqual(
			Buffer.concat([Buffer.from("40000 d\0"), Buffer.alloc(20, 0xcd)]),
		);
	});

	test("serializeTree sorts entries and does not mutate the input", () => {
		const input = [entry("b"), entry("a")];
		const before = structuredClone(input);

		const body = serializeTree(input);

		expect(input).toEqual(before);
		expect(parseTree(body).map((e) => e.name)).toEqual(["a", "b"]);
	});

	for (const tree of treeVectors) {
		test(`serializeTree equals the tree object git wrote for ${tree.name}`, () => {
			const random = seededRandom(7);
			const rootEntries = oracleEntries(tree.rootSha);

			const body = serializeTree(shuffled(rootEntries, random));

			expect(body).toEqual(oracleBody("tree", tree.rootSha));
			expect(objectSha("tree", body)).toBe(tree.rootSha);
		});

		test(`parseTree reads the tree object git wrote for ${tree.name}`, () => {
			const body = oracleBody("tree", tree.rootSha);

			expect(parseTree(body)).toEqual(oracleEntries(tree.rootSha));
		});
	}

	test("parseTree of an empty body has no entries", () => {
		expect(parseTree(Buffer.alloc(0))).toEqual([]);
	});

	test("parseTree inverts serializeTree", () => {
		const entries = [
			entry("a-b", "100644", "11".repeat(20)),
			entry("a.txt", "100755", "22".repeat(20)),
			entry("a", "40000", "33".repeat(20)),
		];

		expect(parseTree(serializeTree(entries))).toEqual(entries);
	});

	const invalidEntries: [string, GitTreeEntry[]][] = [
		["duplicate names", [entry("a"), entry("a", "100755")]],
		["an empty name", [entry("")]],
		["a name with a slash", [entry("a/b")]],
		["a name with NUL", [entry("a\0b")]],
		["an uppercase sha", [entry("a", "100644", "A".repeat(40))]],
		["a short sha", [entry("a", "100644", "ab")]],
	];
	for (const [label, entries] of invalidEntries) {
		test(`serializeTree rejects ${label} with RangeError`, () => {
			expect(() => serializeTree(entries)).toThrow(RangeError);
		});
	}

	test("parseTree rejects a truncated sha with SyntaxError", () => {
		const body = serializeTree([entry("a", "100644", "ab".repeat(20))]);

		expect(() => parseTree(body.subarray(0, body.length - 3))).toThrow(
			SyntaxError,
		);
	});

	test("parseTree rejects an entry with no NUL with SyntaxError", () => {
		expect(() => parseTree(Buffer.from("100644 name"))).toThrow(SyntaxError);
	});
});

//
// Nested trees
//

test.describe("buildTrees", () => {
	for (const tree of treeVectors) {
		test(`root sha matches git for ${tree.name}`, () => {
			expect(buildTrees(fileEntries(tree)).root).toBe(tree.rootSha);
		});

		test(`every tree is listed once with its own sha for ${tree.name}`, () => {
			const { trees, root } = buildTrees(fileEntries(tree));

			expect(trees.map((t) => t.sha).sort()).toEqual(
				Object.values(tree.directories).sort(),
			);
			expect(trees.map((t) => t.sha)).toContain(root);
			for (const object of trees) {
				expect(objectSha("tree", object.body)).toBe(object.sha);
				expect(object.body).toEqual(oracleBody("tree", object.sha));
			}
		});

		test(`children come before parents for ${tree.name}`, () => {
			const { trees } = buildTrees(fileEntries(tree));
			const position = new Map(trees.map((t, i) => [t.sha, i]));

			trees.forEach((object, index) => {
				for (const child of parseTree(object.body)) {
					if (child.mode !== "40000") continue;
					expect(position.get(child.sha)).toBeLessThan(index);
				}
			});
		});
	}

	test("the result does not depend on the order of the files", () => {
		const tree = treeVectors.find((t) => t.name === "nested directories");
		expect(tree).toBeDefined();
		const files = fileEntries(tree as VectorTree);

		const forward = buildTrees(files);
		const reversed = buildTrees([...files].reverse());

		expect(reversed.root).toBe(forward.root);
		expect(reversed.trees.map((t) => t.sha).sort()).toEqual(
			forward.trees.map((t) => t.sha).sort(),
		);
	});

	test("random nested file lists get the same root as git", () => {
		const random = seededRandom(20260101);
		for (let round = 0; round < 25; round++) {
			const files = randomFiles(random);
			const expected = oracleTree(
				files.map((f) => ({ path: f.path, mode: f.mode, sha: f.gitSha })),
			);

			const { root } = buildTrees(shuffled(files, random));

			expect(root, JSON.stringify(files.map((f) => f.path))).toBe(expected);
		}
	});

	test("rejects an empty file list with RangeError", () => {
		expect(() => buildTrees([])).toThrow(RangeError);
	});

	test("rejects the same path twice with RangeError", () => {
		const gitSha = blobSha(Buffer.from("x"));

		expect(() =>
			buildTrees([
				{ path: "a.txt", mode: "100644", gitSha },
				{ path: "a.txt", mode: "100755", gitSha },
			]),
		).toThrow(RangeError);
	});

	test("rejects a file that is also a directory with RangeError", () => {
		const gitSha = blobSha(Buffer.from("x"));

		expect(() =>
			buildTrees([
				{ path: "a", mode: "100644", gitSha },
				{ path: "a/b.txt", mode: "100644", gitSha },
			]),
		).toThrow(RangeError);
	});
});

//
// Commits
//

test.describe("commit", () => {
	for (const commit of commitVectors) {
		test(`serializeCommit gives git's sha and bytes for ${commit.name}`, () => {
			const body = serializeCommit(commitOf(commit));

			expect(objectSha("commit", body)).toBe(commit.sha);
			expect(body).toEqual(oracleBody("commit", commit.sha));
		});

		test(`parseCommit reads the commit object git wrote for ${commit.name}`, () => {
			const parsed = parseCommit(oracleBody("commit", commit.sha));

			expect(parsed.tree).toBe(commit.tree);
			expect(parsed.parents).toEqual(commit.parents);
			expect(parsed.message).toBe(commit.message);
			for (const role of ["author", "committer"] as const) {
				expect(parsed[role].name).toBe(commit[role].name);
				expect(parsed[role].email).toBe(commit[role].email);
				expect(parsed[role].date.getTime()).toBe(commit[role].timestamp * 1000);
				expect(parsed[role].timezoneOffset ?? 0).toBe(
					commit[role].timezoneOffset,
				);
			}
		});

		test(`serializeCommit inverts parseCommit for ${commit.name}`, () => {
			const body = oracleBody("commit", commit.sha);

			expect(serializeCommit(parseCommit(body))).toEqual(body);
		});
	}

	test("a missing timezoneOffset is written as +0000", () => {
		const root = commitVectors[0] as VectorCommit;
		const body = serializeCommit({
			...commitOf(root),
			author: { ...signatureOf(root.author), timezoneOffset: undefined },
			committer: { ...signatureOf(root.committer), timezoneOffset: undefined },
		});

		expect(body).toEqual(oracleBody("commit", root.sha));
	});

	test("date loses sub-second precision", () => {
		const root = commitVectors[0] as VectorCommit;
		const author = {
			...signatureOf(root.author),
			date: new Date(root.author.timestamp * 1000 + 789),
		};

		const body = serializeCommit({ ...commitOf(root), author });

		expect(parseCommit(body).author.date.getTime()).toBe(
			root.author.timestamp * 1000,
		);
	});

	test("parseCommit skips a multi-line gpgsig header", () => {
		const merge = commitVectors[2] as VectorCommit;
		const plain = oracleBody("commit", merge.sha).toString("utf8");
		const signature =
			"gpgsig -----BEGIN PGP SIGNATURE-----\n \n abc\n -----END PGP SIGNATURE-----\n";
		const [headers, message] = plain.split("\n\n") as [string, string];
		const signed = Buffer.from(`${headers}\n${signature}\n${message}`);

		const parsed = parseCommit(signed);

		expect(parsed.message).toBe(merge.message);
		expect(parsed.parents).toEqual(merge.parents);
		expect(parsed.committer.name).toBe(merge.committer.name);
	});

	test("parseCommit rejects a body that is not a commit with SyntaxError", () => {
		expect(() => parseCommit(Buffer.from("not a commit"))).toThrow(SyntaxError);
	});

	test("parseCommit rejects a commit with no tree with SyntaxError", () => {
		const body = oracleBody("commit", (commitVectors[0] as VectorCommit).sha)
			.toString("utf8")
			.replace(/^tree .*\n/, "");

		expect(() => parseCommit(Buffer.from(body))).toThrow(SyntaxError);
	});
});

//
// Vector table
//

test.describe("vector table", () => {
	test("every sha in the table is what git computes", () => {
		for (const blob of blobVectors) {
			expect(oracleBlob(bytesOf(blob)), blob.name).toBe(blob.sha);
		}
		for (const tree of treeVectors) {
			for (const file of tree.files) {
				expect(oracleBlob(bytesOf(file)), file.path).toBe(file.sha);
			}
			expect(oracleTree(tree.files), tree.name).toBe(tree.rootSha);
		}
		for (const commit of commitVectors) {
			expect(oracleCommit(commit), commit.name).toBe(commit.sha);
		}
	});
});

//
// Loose objects
//

test.describe("objectStream and looseObject", () => {
	type Case = { label: string; kind: GitObjectKind; sha: string };
	const cases: Case[] = [
		...blobVectors.map((b) => ({
			label: `blob ${b.name}`,
			kind: "blob" as const,
			sha: b.sha,
		})),
		...treeVectors.map((t) => ({
			label: `tree ${t.name}`,
			kind: "tree" as const,
			sha: t.rootSha,
		})),
		...commitVectors.map((c) => ({
			label: `commit ${c.name}`,
			kind: "commit" as const,
			sha: c.sha,
		})),
	];

	for (const { label, kind, sha } of cases) {
		test(`objectStream is header plus body, hashing to ${label}`, async () => {
			const body = oracleBody(kind, sha);

			const bytes = await collect(objectStream(kind, body.length, body));

			expect(bytes).toEqual(
				Buffer.concat([objectHeader(kind, body.length), body]),
			);
			expect(sha1(bytes)).toBe(sha);
		});

		test(`inflated looseObject has git's content for ${label}`, async () => {
			const body = oracleBody(kind, sha);
			const chunks = Readable.from([
				body.subarray(0, Math.floor(body.length / 2)),
				body.subarray(Math.floor(body.length / 2)),
			]);

			const loose = await collect(
				looseObject(objectStream(kind, body.length, chunks)),
			);

			const inflated = inflateSync(loose);
			expect(inflated).toEqual(
				Buffer.concat([objectHeader(kind, body.length), body]),
			);
			expect(sha1(inflated)).toBe(sha);
		});
	}

	test("a loose object streamed from a large Readable is readable by git", async () => {
		const bytes = Buffer.alloc(3 * 1024 * 1024);
		for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7 + (i >> 9)) & 255;
		const sha = blobSha(bytes);

		const loose = await collect(
			looseObject(objectStream("blob", bytes.length, Readable.from([bytes]))),
		);

		const objectDir = path.join(oracleDir, ".git", "objects", sha.slice(0, 2));
		mkdirSync(objectDir, { recursive: true });
		writeFileSync(path.join(objectDir, sha.slice(2)), loose);
		expect(git(["cat-file", "blob", sha])).toEqual(bytes);
		expect(gitText(["cat-file", "-t", sha])).toBe("blob");
	});
});
