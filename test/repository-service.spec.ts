import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { UserActor } from "@/auth/actor";
import { SYSTEM } from "@/auth/actor";
import { InvalidData, NotAllowed } from "@/core/error";
import { MAX_REPOSITORY_FILES, type RepositoryEntry } from "@/core/schemas";
import type { Repository, RepositoryPK } from "@/db";
import { db } from "@/db";
import { persistedCalendarEventFactory } from "@/fixtures/calendar-event.factory";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import {
	persistedRepositoryFactory,
	repositoryTree,
	type TreeFileSpec,
} from "@/fixtures/repository.factory";
import { persistedTimeSlotFactory } from "@/fixtures/time-slot.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";
import { hashBytes } from "@/utils/content-hash";
import { TEST_RESOURCE_ROOT } from "./env";

// A random suffix, not an incrementing counter: sibling spec files share one
// test database, so their own counters would collide with this one.
function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

//
// Setup shared by every batch
//

/// One course for the whole file: a fresh course pulls in a fresh edition, and
/// the edition factory cycles through only 20 slugs.
let instructor: UserActor;
let courseId: Repository["courseId"];

/// A second shared course, with one enrolled student, for the read rules.
let student: UserActor;
let classCourseId: Repository["courseId"];

test.beforeAll(async () => {
	const user = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	instructor = { username: user.username, role: user.role, name: user.name };
	const course = await persistedCourseFactory.create({
		instructor: user.username,
	});
	courseId = course.id;

	const classCourse = await persistedCourseFactory.create(
		{ instructor: user.username },
		{ transient: { students: 1 } },
	);
	const enrolled = classCourse.students[0] as (typeof classCourse.students)[0];
	student = {
		username: enrolled.username,
		role: enrolled.role,
		name: enrolled.name,
	};
	classCourseId = classCourse.id;
});

/// An empty repository with a random slug, and the key to address it by.
async function newRepository(
	course: Repository["courseId"] = courseId,
): Promise<{
	repository: Repository;
	pk: RepositoryPK;
}> {
	const repository = await persistedRepositoryFactory.create({
		course,
		slug: tag("repo"),
	});
	return { repository, pk: { id: repository.id } };
}

/// Uploads the files of `spec` and commits them as `actor`.
async function push(
	pk: RepositoryPK,
	spec: Record<string, TreeFileSpec>,
	message?: string,
): Promise<Repository> {
	const { files, tree } = repositoryTree(spec);
	await db.repository.addFiles(pk, files, { actor: instructor });
	return db.repository.commit(pk, { tree, message }, { actor: instructor });
}

//
// Git as the oracle
//

type GitCommitFields = {
	tree: string;
	parents: string[];
	author: string;
	committer: string;
	message: string;
};

/// A scratch git repository under `test/.tmp/`, to compute shas the way git
/// does.
function makeOracleRepository(): string {
	const dir = path.join(TEST_RESOURCE_ROOT, "repository-service", tag("git"));
	mkdirSync(dir, { recursive: true });
	execFileSync("git", ["init", "--quiet", dir]);
	return dir;
}

/// The sha1 git gives to the root tree of `spec`.
function gitTreeSha(spec: Record<string, TreeFileSpec>): string {
	const dir = makeOracleRepository();
	const git = (args: string[], input?: Buffer) =>
		execFileSync("git", ["-C", dir, ...args], { input })
			.toString()
			.trim();
	for (const [file, value] of Object.entries(spec)) {
		const { content, mode } =
			typeof value === "string" || Buffer.isBuffer(value)
				? { content: value, mode: "100644" }
				: value;
		const sha = git(["hash-object", "-w", "--stdin"], Buffer.from(content));
		git(["update-index", "--add", "--cacheinfo", `${mode},${sha},${file}`]);
	}
	return git(["write-tree"]);
}

/// The sha1 git gives to a blob with these bytes.
function gitBlobSha(content: string): string {
	return execFileSync("git", ["hash-object", "--stdin"], {
		input: Buffer.from(content),
	})
		.toString()
		.trim();
}

/// Reads a whole stream into memory.
async function readAll(
	stream: AsyncIterable<Buffer | string>,
): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks);
}

/// Reads a stored commit through `readObject`, checking that the stream is the
/// uncompressed object named by `sha`. The commit text is parsed here, by hand,
/// so these tests do not depend on `parseCommit`.
async function readCommit(
	repository: Repository,
	sha: string,
): Promise<GitCommitFields> {
	const handle = {
		id: repository.id,
		slug: repository.slug,
		head: repository.head,
	};
	const stream = await db.repository.readObject(handle, sha);
	expect(stream, `object ${sha} is served`).not.toBeNull();
	const object = await readAll(stream as AsyncIterable<Buffer>);
	expect(createHash("sha1").update(object).digest("hex")).toBe(sha);

	const nul = object.indexOf(0);
	const header = object.subarray(0, nul).toString("latin1");
	const body = object.subarray(nul + 1).toString("utf-8");
	expect(header).toBe(`commit ${Buffer.byteLength(body)}`);

	const [headers = "", ...messageParts] = body.split("\n\n");
	const fields: GitCommitFields = {
		tree: "",
		parents: [],
		author: "",
		committer: "",
		message: messageParts.join("\n\n"),
	};
	for (const line of headers.split("\n")) {
		const space = line.indexOf(" ");
		const key = line.slice(0, space);
		const value = line.slice(space + 1);
		if (key === "tree") fields.tree = value;
		else if (key === "parent") fields.parents.push(value);
		else if (key === "author") fields.author = value;
		else if (key === "committer") fields.committer = value;
	}
	return fields;
}

//
// Batch 1: commits and head
//

test.describe("commit: first commit", () => {
	const spec = {
		"README.md": "# Lab 1\n",
		"src/main.py": "print('hi')\n",
		"src/util/io.py": "def read(): ...\n",
		"run.sh": { content: "#!/bin/sh\necho ok\n", mode: "100755" as const },
	};

	test("fills head, tree, message and committedAt from the new commit", async () => {
		const { pk } = await newRepository();
		const before = Math.floor(Date.now() / 1000) * 1000;

		const committed = await push(pk, spec, "Add the first lab");

		expect(committed.head).toMatch(/^[0-9a-f]{40}$/);
		expect(committed.tree).toBe(gitTreeSha(spec));
		expect(committed.message?.trimEnd()).toBe("Add the first lab");
		expect(committed.committedAt).toBeInstanceOf(Date);
		expect(committed.committedAt?.getTime()).toBeGreaterThanOrEqual(before);
		expect(committed.committedAt?.getTime()).toBeLessThanOrEqual(
			Date.now() + 1000,
		);

		const found = await db.repository.findOne(pk, { actor: instructor });
		expect(found).toEqual(committed);
	});

	test("stores a parentless commit of the expected tree, signed by the actor", async () => {
		const { pk } = await newRepository();

		const committed = await push(pk, spec, "Add the first lab");

		const commit = await readCommit(committed, committed.head as string);
		expect(commit.tree).toBe(gitTreeSha(spec));
		expect(commit.parents).toEqual([]);
		const signature = `${instructor.name} <${instructor.username}@codehood> `;
		expect(commit.author.startsWith(signature)).toBe(true);
		expect(commit.committer.startsWith(signature)).toBe(true);
		expect(commit.message.trimEnd()).toBe("Add the first lab");
	});

	test("defaults the message to Update YYYY-MM-DD", async () => {
		const { pk } = await newRepository();

		const committed = await push(pk, spec);

		expect(committed.message?.trimEnd()).toMatch(/^Update \d{4}-\d{2}-\d{2}$/);
	});
});

test.describe("commit: same tree as the head", () => {
	test("creates no commit and returns the repository as it is", async () => {
		const { pk } = await newRepository();
		const spec = { "README.md": "# Lab\n", "a/b.py": "x\n" };
		const first = await push(pk, spec, "First");

		const again = await push(pk, spec, "A different message");

		expect(again.head).toBe(first.head);
		expect(again.message).toBe(first.message);
		expect(again.committedAt).toEqual(first.committedAt);
		expect(again).toEqual(first);
		const found = await db.repository.findOne(pk, { actor: instructor });
		expect(found?.head).toBe(first.head);
	});
});

test.describe("commit: second commit", () => {
	test("has the first commit as its only parent and the new tree", async () => {
		const { pk } = await newRepository();
		const first = await push(pk, { "README.md": "# Lab\n" }, "First");
		const spec = { "README.md": "# Lab\n", "src/new.py": "y = 1\n" };

		const second = await push(pk, spec, "Second");

		expect(second.head).not.toBe(first.head);
		expect(second.tree).toBe(gitTreeSha(spec));
		expect(second.message?.trimEnd()).toBe("Second");
		const commit = await readCommit(second, second.head as string);
		expect(commit.parents).toEqual([first.head]);
		expect(commit.tree).toBe(gitTreeSha(spec));
		const old = await readCommit(second, first.head as string);
		expect(old.parents).toEqual([]);
	});
});

//
// Batch 2: tree rules, files the server already has, abandoned uploads
//

/// The sha-256 hashes attached to the repository, in no particular order.
async function attachedHashes(repository: Repository): Promise<string[]> {
	const attachments = await db.attachment.findMany(
		{ type: "REPOSITORY", attachedTo: [repository.id] },
		{ actor: instructor },
	);
	return attachments.map((attachment) => attachment.hash);
}

/// Uploads one file and returns its hash, for building hand-made trees.
async function uploadOne(pk: RepositoryPK, content: string): Promise<string> {
	const { files, tree } = repositoryTree({ file: content });
	await db.repository.addFiles(pk, files, { actor: instructor });
	return (tree[0] as RepositoryEntry).hash;
}

test.describe("commit: refused trees", () => {
	/// Each case maps the hash of an uploaded file to the offending tree.
	const cases: Record<string, (hash: string) => RepositoryEntry[]> = {
		"a repeated path": (hash) => [
			{ path: "a.txt", mode: "100644", hash },
			{ path: "a.txt", mode: "100644", hash },
		],
		"paths that differ only in letter case": (hash) => [
			{ path: "docs/Readme.md", mode: "100644", hash },
			{ path: "docs/README.md", mode: "100644", hash },
		],
		"a file that is also a directory, file first": (hash) => [
			{ path: "src", mode: "100644", hash },
			{ path: "src/main.py", mode: "100644", hash },
		],
		"a file that is also a directory, directory first": (hash) => [
			{ path: "src/main.py", mode: "100644", hash },
			{ path: "src", mode: "100644", hash },
		],
		"a file that is a directory in another letter case": (hash) => [
			{ path: "src/main.py", mode: "100644", hash },
			{ path: "SRC", mode: "100644", hash },
		],
		"more files than the limit": (hash) =>
			Array.from({ length: MAX_REPOSITORY_FILES + 1 }, (_, i) => ({
				path: `file-${i}.txt`,
				mode: "100644" as const,
				hash,
			})),
		"a path that climbs out of the repository": (hash) => [
			{ path: "../x", mode: "100644", hash },
		],
		"a path inside .git": (hash) => [
			{ path: ".git/config", mode: "100644", hash },
		],
	};

	for (const [name, makeTree] of Object.entries(cases)) {
		test(`refuses ${name} and records no commit`, async () => {
			const { pk } = await newRepository();
			const hash = await uploadOne(pk, "content\n");

			await expect(
				db.repository.commit(
					pk,
					{ tree: makeTree(hash) },
					{ actor: instructor },
				),
			).rejects.toBeInstanceOf(InvalidData);

			const found = await db.repository.findOne(pk, { actor: instructor });
			expect(found?.head).toBeNull();
		});
	}

	test("refuses a hash that is neither attached to the repository nor on the server", async () => {
		const { pk } = await newRepository();
		const unknown = hashBytes(Buffer.from(tag("never uploaded")));

		await expect(
			db.repository.commit(
				pk,
				{ tree: [{ path: "a.txt", mode: "100644", hash: unknown }] },
				{ actor: instructor },
			),
		).rejects.toBeInstanceOf(InvalidData);

		const found = await db.repository.findOne(pk, { actor: instructor });
		expect(found?.head).toBeNull();
	});
});

test.describe("commit: a file another course already put on the server", () => {
	test("is not listed as missing and is committed without addFiles", async () => {
		const otherCourse = await persistedCourseFactory.create({
			instructor: instructor.username,
		});
		const donor = await persistedRepositoryFactory.create({
			course: otherCourse.id,
			slug: tag("donor"),
		});
		const shared = repositoryTree({ "data.csv": `${tag("rows")}\n` });
		await db.repository.addFiles({ id: donor.id }, shared.files, {
			actor: instructor,
		});
		const [{ hash }] = shared.tree as [RepositoryEntry];
		const unknown = hashBytes(Buffer.from(tag("never uploaded")));
		const { repository, pk } = await newRepository();

		const missing = await db.blob.missing([hash, unknown], {
			actor: instructor,
		});
		const committed = await db.repository.commit(
			pk,
			{ tree: shared.tree },
			{ actor: instructor },
		);

		expect(missing).toEqual([unknown]);
		expect(committed.head).toMatch(/^[0-9a-f]{40}$/);
		expect(await attachedHashes(repository)).toContain(hash);
		expect(await attachedHashes(donor)).toContain(hash);
	});
});

test.describe("commit: uploads no commit uses", () => {
	test("detaches an abandoned upload and keeps the files of the commit", async () => {
		const { repository, pk } = await newRepository();
		const used = repositoryTree({ "used.txt": "used\n" });
		const abandoned = repositoryTree({ "abandoned.txt": "abandoned\n" });
		await db.repository.addFiles(
			pk,
			{ ...used.files, ...abandoned.files },
			{ actor: instructor },
		);
		const [usedEntry] = used.tree as [RepositoryEntry];
		const [abandonedEntry] = abandoned.tree as [RepositoryEntry];
		expect(await attachedHashes(repository)).toContain(abandonedEntry.hash);

		await db.repository.commit(pk, { tree: used.tree }, { actor: instructor });

		const attached = await attachedHashes(repository);
		expect(attached).toContain(usedEntry.hash);
		expect(attached).not.toContain(abandonedEntry.hash);
	});

	test("keeps the blob of an old version attached and readable", async () => {
		const { pk } = await newRepository();
		const first = await push(pk, { "old.txt": "old\n", "keep.txt": "keep\n" });
		const second = await push(pk, { "keep.txt": "keep\n", "new.txt": "new\n" });
		const oldHash = hashBytes(Buffer.from("old\n"));

		expect(second.head).not.toBe(first.head);
		expect(await attachedHashes(second)).toContain(oldHash);
		const handle = { id: second.id, slug: second.slug, head: second.head };
		const stream = await db.repository.readObject(handle, gitBlobSha("old\n"));
		expect(stream).not.toBeNull();
		const object = await readAll(stream as AsyncIterable<Buffer>);
		expect(object.toString("latin1")).toBe("blob 4\0old\n");
	});
});

//
// Batch 3: title, who can see and change what, objects of other repositories
//

test.describe("commit: title", () => {
	test("is the H1 of the root README.md, and follows it on the next commit", async () => {
		const { pk } = await newRepository();

		const first = await push(pk, { "README.md": "# Intro to Loops\n\ntext\n" });
		const second = await push(pk, { "README.md": "# Intro to Recursion\n" });

		expect(first.title).toBe("Intro to Loops");
		expect(second.title).toBe("Intro to Recursion");
		const found = await db.repository.findOne(pk, { actor: instructor });
		expect(found?.title).toBe("Intro to Recursion");
	});

	test("falls back to the slug without a root README.md", async () => {
		const { repository, pk } = await newRepository();

		const committed = await push(pk, {
			"docs/README.md": "# Not the root\n",
			"main.py": "x\n",
		});

		expect(committed.title).toBe(repository.slug);
	});

	test("falls back to the slug when the README.md has no H1, and back again", async () => {
		const { repository, pk } = await newRepository();

		const withoutHeading = await push(pk, {
			"README.md": "just text\n\n## Only a subtitle\n",
		});
		const withHeading = await push(pk, { "README.md": "# Now titled\n" });
		const removed = await push(pk, { "main.py": "x\n" });

		expect(withoutHeading.title).toBe(repository.slug);
		expect(withHeading.title).toBe("Now titled");
		expect(removed.title).toBe(repository.slug);
	});
});

test.describe("an enrolled student", () => {
	test("does not see a repository without a commit, and sees it after one", async () => {
		const { repository, pk } = await newRepository(classCourseId);

		const beforeOne = await db.repository.findOne(pk, { actor: student });
		const beforeMany = await db.repository.findMany(
			{ course: classCourseId },
			{ actor: student },
		);
		const teacherBefore = await db.repository.findOne(pk, {
			actor: instructor,
		});
		await push(pk, { "README.md": "# Visible\n" });
		const afterOne = await db.repository.findOne(pk, { actor: student });
		const afterMany = await db.repository.findMany(
			{ course: classCourseId },
			{ actor: student },
		);

		expect(beforeOne).toBeNull();
		expect(beforeMany.map((r) => r.id)).not.toContain(repository.id);
		expect(teacherBefore?.id).toBe(repository.id);
		expect(afterOne?.title).toBe("Visible");
		expect(afterMany.map((r) => r.id)).toContain(repository.id);
	});

	test("cannot create, upload, commit, delete or rotate the token", async () => {
		const { repository, pk } = await newRepository(classCourseId);
		const { files, tree } = repositoryTree({ "a.txt": "a\n" });
		await push(pk, { "README.md": "# Committed\n" });
		const asStudent = { actor: student };

		const attempts = {
			upsert: db.repository.upsert(
				{ course: classCourseId, slug: repository.slug },
				asStudent,
			),
			addFiles: db.repository.addFiles(pk, files, asStudent),
			commit: db.repository.commit(pk, { tree }, asStudent),
			delete: db.repository.delete(pk, asStudent),
			rotateToken: db.repository.rotateToken(pk, asStudent),
		};

		for (const [operation, attempt] of Object.entries(attempts)) {
			await expect(attempt, operation).rejects.toBeInstanceOf(NotAllowed);
		}
		const found = await db.repository.findOne(pk, { actor: instructor });
		expect(found?.title).toBe("Committed");
	});
});

test.describe("readObject: objects of another repository", () => {
	test("serves its own objects but neither the blob nor the commit nor the tree of another", async () => {
		const mine = await newRepository();
		const theirs = await newRepository();
		const myContent = `${tag("mine")}\n`;
		const theirContent = `${tag("theirs")}\n`;
		const myCommit = await push(mine.pk, { "mine.txt": myContent });
		const theirCommit = await push(theirs.pk, { "theirs.txt": theirContent });
		const handle = {
			id: myCommit.id,
			slug: myCommit.slug,
			head: myCommit.head,
		};

		const ownTree = await db.repository.readObject(
			handle,
			myCommit.tree as string,
		);
		const ownBlob = await db.repository.readObject(
			handle,
			gitBlobSha(myContent),
		);
		const theirBlob = await db.repository.readObject(
			handle,
			gitBlobSha(theirContent),
		);
		const theirHead = await db.repository.readObject(
			handle,
			theirCommit.head as string,
		);
		const theirTree = await db.repository.readObject(
			handle,
			theirCommit.tree as string,
		);

		expect(ownTree).not.toBeNull();
		expect(ownBlob).not.toBeNull();
		expect(theirBlob).toBeNull();
		expect(theirHead).toBeNull();
		expect(theirTree).toBeNull();
	});
});

//
// Batch 4: zip, clone token, calendar event links
//

/// The blob bytes behind a hash, as stored on the server.
async function blobBytes(hash: string): Promise<Buffer> {
	const blob = await db.blob.findOne({ hash }, { actor: instructor });
	expect(blob, `blob ${hash} exists`).not.toBeNull();
	const bytes = await db.blob.readBlob(blob as NonNullable<typeof blob>);
	expect(bytes, `blob ${hash} is readable`).not.toBeNull();
	return bytes as Buffer;
}

/// Lists the entries of a zip with the real `unzip`.
function zipEntries(bytes: Buffer): string[] {
	const dir = path.join(TEST_RESOURCE_ROOT, "repository-service", tag("zip"));
	mkdirSync(dir, { recursive: true });
	const file = path.join(dir, "archive.zip");
	writeFileSync(file, bytes);
	const listing = execFileSync("unzip", ["-Z1", file]).toString();
	return listing.split("\n").filter((line) => line !== "");
}

/// The clone token inside a clone URL (`<origin>/git/<token>/<slug>.git`).
function tokenOf(repository: Repository): string {
	const match = /\/git\/([^/]+)\/[^/]+\.git$/.exec(repository.cloneUrl);
	expect(match, `token in ${repository.cloneUrl}`).not.toBeNull();
	return (match as RegExpExecArray)[1] as string;
}

test.describe("batch 4: zip", () => {
	const spec = {
		"README.md": "# Zipped\n",
		"src/main.py": "print(1)\n",
		"run.sh": { content: "#!/bin/sh\n", mode: "100755" as const },
	};

	test("builds a zip rooted at the slug, once, until the tree changes", async () => {
		const { repository, pk } = await newRepository();
		const committed = await push(pk, spec);

		const hash = await db.repository.zip(pk, { actor: instructor });
		const again = await db.repository.zip(pk, { actor: instructor });

		expect(hash).toMatch(/^[0-9a-f]{64}$/);
		expect(again).toBe(hash);
		const bytes = await blobBytes(hash as string);
		expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
		expect(zipEntries(bytes).sort()).toEqual([
			`${repository.slug}/README.md`,
			`${repository.slug}/run.sh`,
			`${repository.slug}/src/main.py`,
		]);
		expect(await attachedHashes(committed)).toContain(hash);
	});

	test("a commit that changes the tree drops the cached zip and its attachment", async () => {
		const { pk } = await newRepository();
		const first = await push(pk, spec);
		const oldZip = (await db.repository.zip(pk, {
			actor: instructor,
		})) as string;

		const second = await push(pk, { ...spec, "extra.txt": "more\n" });
		const newZip = (await db.repository.zip(pk, {
			actor: instructor,
		})) as string;

		expect(newZip).not.toBe(oldZip);
		expect(await attachedHashes(second)).toContain(newZip);
		expect(await attachedHashes(second)).not.toContain(oldZip);
		expect(zipEntries(await blobBytes(newZip))).toContain(
			`${first.slug}/extra.txt`,
		);
	});

	test("has no result before the first commit", async () => {
		const { pk } = await newRepository();

		expect(await db.repository.zip(pk, { actor: instructor })).toBeNull();
	});

	test("is not charged to anyone's quota", async () => {
		const { pk } = await newRepository();
		await push(pk, spec);
		const before = await db.attachment.usageBytes(instructor.username);

		await db.repository.zip(pk, { actor: instructor });

		expect(await db.attachment.usageBytes(instructor.username)).toBe(before);
	});

	test("survives the cleanup of a later push that leaves the tree as it is", async () => {
		const { pk } = await newRepository();
		const committed = await push(pk, spec);
		const zip = (await db.repository.zip(pk, { actor: instructor })) as string;

		const abandoned = repositoryTree({ "abandoned.txt": `${tag("x")}\n` });
		await db.repository.addFiles(pk, abandoned.files, { actor: instructor });
		const { tree } = repositoryTree(spec);
		await db.repository.commit(pk, { tree }, { actor: instructor });

		expect(await attachedHashes(committed)).toContain(zip);
		expect(await db.repository.zip(pk, { actor: instructor })).toBe(zip);
	});
});

test.describe("batch 4: clone token", () => {
	test("rotating makes the old token stop resolving and the new one resolve", async () => {
		const { repository, pk } = await newRepository();
		const committed = await push(pk, { "a.txt": "a\n" });
		const oldToken = tokenOf(repository);
		expect(await db.repository.findByToken(oldToken, repository.slug)).toEqual({
			id: repository.id,
			slug: repository.slug,
			head: committed.head,
		});

		const rotated = await db.repository.rotateToken(pk, { actor: instructor });
		const newToken = tokenOf(rotated);

		expect(newToken).not.toBe(oldToken);
		expect(rotated.cloneUrl).not.toBe(repository.cloneUrl);
		expect(
			await db.repository.findByToken(oldToken, repository.slug),
		).toBeNull();
		expect(await db.repository.findByToken(newToken, repository.slug)).toEqual({
			id: repository.id,
			slug: repository.slug,
			head: committed.head,
		});
		const found = await db.repository.findOne(pk, { actor: instructor });
		expect(found?.cloneUrl).toBe(rotated.cloneUrl);
	});

	test("a token with the wrong slug or a malformed token resolves to nothing", async () => {
		const { repository } = await newRepository();
		const other = await newRepository();
		const token = tokenOf(repository);

		expect(
			await db.repository.findByToken(token, other.repository.slug),
		).toBeNull();
		expect(await db.repository.findByToken(token, "no-such-slug")).toBeNull();
		expect(
			await db.repository.findByToken("not a token!", repository.slug),
		).toBeNull();
		expect(await db.repository.findByToken("", repository.slug)).toBeNull();
	});
});

const WEEKDAYS = [
	"MONDAY",
	"TUESDAY",
	"WEDNESDAY",
	"THURSDAY",
	"FRIDAY",
	"SATURDAY",
	"SUNDAY",
] as const;

let slotsCreated = 0;

/// A one-hour time slot of the shared course at a day and hour no earlier slot
/// of this file used, because slots of one course cannot overlap.
async function newSlot() {
	const index = slotsCreated++;
	return persistedTimeSlotFactory.create({
		course: courseId,
		day: WEEKDAYS[index % WEEKDAYS.length],
		start: { hour: Math.floor(index / WEEKDAYS.length) % 24, minute: 0 },
		duration: { hours: 1 },
	});
}

async function eventSlugs(id: number): Promise<string[]> {
	const event = await db.calendarEvent.findOne(
		{ id: id as never },
		{ actor: instructor },
	);
	expect(event, `event ${id} exists`).not.toBeNull();
	return (event?.repositories ?? []).map((r) => r.slug).sort();
}

test.describe("batch 4: calendar events link repositories", () => {
	test("create links the listed repositories", async () => {
		const a = await newRepository();
		const b = await newRepository();
		const slot = await newSlot();

		const event = await persistedCalendarEventFactory.create({
			course: courseId,
			timeSlot: slot.id,
			repositories: [a.repository.slug, b.repository.slug],
		});

		expect(await eventSlugs(event.id)).toEqual(
			[a.repository.slug, b.repository.slug].sort(),
		);
	});

	test("upsert links on creation and replaces the set on the next call", async () => {
		const a = await newRepository();
		const b = await newRepository();
		const slot = await newSlot();
		const input = {
			course: courseId,
			timeSlot: slot.id,
			week: 3,
			kind: "REGULAR" as const,
			title: "Lab",
		};

		const created = await db.calendarEvent.upsert(
			{ ...input, repositories: [a.repository.slug] },
			{ actor: instructor },
		);
		const replaced = await db.calendarEvent.upsert(
			{ ...input, repositories: [b.repository.slug] },
			{ actor: instructor },
		);

		expect(replaced.id).toBe(created.id);
		expect(await eventSlugs(created.id)).toEqual([b.repository.slug]);
	});

	test("update replaces the set, keeps it for null or omitted, and clears it for []", async () => {
		const a = await newRepository();
		const b = await newRepository();
		const slot = await newSlot();
		const event = await persistedCalendarEventFactory.create({
			course: courseId,
			timeSlot: slot.id,
			repositories: [a.repository.slug],
		});
		const pk = { id: event.id };
		const update = (input: {
			repositories?: string[] | null;
			title?: string;
		}) => db.calendarEvent.update(pk, input, { actor: instructor });

		await update({ repositories: [b.repository.slug] });
		const replaced = await eventSlugs(event.id);
		await update({ repositories: null });
		const keptByNull = await eventSlugs(event.id);
		await update({ title: "Renamed" });
		const keptByOmission = await eventSlugs(event.id);
		await update({ repositories: [] });
		const cleared = await eventSlugs(event.id);

		expect(replaced).toEqual([b.repository.slug]);
		expect(keptByNull).toEqual([b.repository.slug]);
		expect(keptByOmission).toEqual([b.repository.slug]);
		expect(cleared).toEqual([]);
	});

	test("refuses a slug the course does not have, on create, update and upsert", async () => {
		const slot = await newSlot();
		const foreign = await newRepository(classCourseId);
		const event = await persistedCalendarEventFactory.create({
			course: courseId,
			timeSlot: slot.id,
		});
		const input = {
			course: courseId,
			timeSlot: slot.id,
			week: 9,
			kind: "REGULAR" as const,
			title: "Lab",
		};
		const slugs = [
			["a slug that exists nowhere", tag("ghost")],
			["a slug of another course", foreign.repository.slug],
		] as const;

		for (const [label, slug] of slugs) {
			const attempts = {
				create: db.calendarEvent.create(
					{ ...input, repositories: [slug] },
					{ actor: instructor },
				),
				update: db.calendarEvent.update(
					{ id: event.id },
					{ repositories: [slug] },
					{ actor: instructor },
				),
				upsert: db.calendarEvent.upsert(
					{ ...input, week: 10, repositories: [slug] },
					{ actor: instructor },
				),
			};
			for (const [operation, attempt] of Object.entries(attempts)) {
				await expect(
					attempt,
					`${operation} with ${label}`,
				).rejects.toBeInstanceOf(InvalidData);
			}
		}
		expect(await eventSlugs(event.id)).toEqual([]);
	});
});

//
// Batch 5: deleting a repository
//

test.describe("batch 5: delete", () => {
	test("removes the links and the git objects, keeps the event, and lets the GC take only its own blobs", async () => {
		const exclusive = `${tag("exclusive")}\n`;
		const shared = `${tag("shared")}\n`;
		const doomed = await newRepository();
		const survivor = await newRepository();
		const doomedCommit = await push(doomed.pk, {
			"exclusive.txt": exclusive,
			"shared.txt": shared,
		});
		await push(survivor.pk, { "shared.txt": shared });
		const slot = await newSlot();
		const event = await persistedCalendarEventFactory.create({
			course: courseId,
			timeSlot: slot.id,
			repositories: [doomed.repository.slug, survivor.repository.slug],
		});
		const handle = {
			id: doomedCommit.id,
			slug: doomedCommit.slug,
			head: doomedCommit.head,
		};
		const exclusiveHash = hashBytes(Buffer.from(exclusive));
		const sharedHash = hashBytes(Buffer.from(shared));

		await db.repository.delete(doomed.pk, { actor: instructor });
		const collected = await db.blob.collectGarbage({
			actor: SYSTEM,
			olderThan: new Date(Date.now() + 1000),
		});

		expect(
			await db.repository.findOne(doomed.pk, { actor: instructor }),
		).toBeNull();
		expect(await eventSlugs(event.id)).toEqual([survivor.repository.slug]);
		expect(
			await db.repository.readObject(handle, doomedCommit.head as string),
		).toBeNull();
		expect(
			await db.repository.readObject(handle, doomedCommit.tree as string),
		).toBeNull();
		expect(collected).toContain(exclusiveHash);
		expect(collected).not.toContain(sharedHash);
		const sharedBlob = await db.blob.findOne(
			{ hash: sharedHash },
			{ actor: instructor },
		);
		expect(sharedBlob?.deletedAt ?? null).toBeNull();
		expect(await attachedHashes(survivor.repository)).toContain(sharedHash);
	});

	test("deleting a repository that does not exist is a no-op", async () => {
		const { pk } = await newRepository();
		await db.repository.delete(pk, { actor: instructor });

		await expect(
			db.repository.delete(pk, { actor: instructor }),
		).resolves.toBeUndefined();
	});
});
