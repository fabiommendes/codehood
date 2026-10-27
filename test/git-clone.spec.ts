import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db, type Repository } from "@/db";
import { repositoryTree } from "@/fixtures/repository.factory";
import { TEST_BASE_URL, TEST_RESOURCE_ROOT } from "./env";

/// The real `git` binary cloning and pulling from the test server over the
/// dumb HTTP protocol, and the git routes' error answers.

function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

const cloneRoot = path.join(TEST_RESOURCE_ROOT, "git-clone");
mkdirSync(cloneRoot, { recursive: true });
const workDir = mkdtempSync(path.join(cloneRoot, "run-"));

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		env: {
			PATH: process.env.PATH,
			HOME: workDir,
			GIT_CONFIG_GLOBAL: "/dev/null",
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_TERMINAL_PROMPT: "0",
		},
	}).toString("utf8");
}

/// The server builds `cloneUrl` from its public origin, which in the test run
/// is not the port the test server listens on; only its path is meaningful.
function urlOf(repository: Repository): string {
	return `${TEST_BASE_URL}${new URL(repository.cloneUrl).pathname}`;
}

async function makeCourse() {
	const instructor = await db.user.create(
		{
			email: `${tag("ins")}@codehood.test`,
			username: tag("ins"),
			name: "Instructor",
			role: "INSTRUCTOR",
			password: "correct-horse-battery-staple",
			githubId: tag("gh"),
			schoolId: tag("sc"),
		},
		FULL_ACCESS,
	);
	const discipline = tag("disc");
	await db.discipline.create(
		{ slug: discipline, name: discipline },
		FULL_ACCESS,
	);
	if (!(await db.edition.findOne({ slug: "2026-1" }))) {
		await db.edition.create(
			{
				slug: "2026-1",
				name: "2026-1",
				startAt: new Date("2026-01-01"),
				endAt: new Date("2030-12-31"),
			},
			FULL_ACCESS,
		);
	}
	const course = await db.course.create(
		{
			discipline,
			instructor: instructor.username,
			edition: "2026-1",
			startAt: new Date("2026-01-05T12:00:00Z"),
			endAt: new Date("2026-05-01"),
		},
		FULL_ACCESS,
	);
	return { instructor, course };
}

type Setup = Awaited<ReturnType<typeof makeCourse>>;

const FIRST = {
	"README.md": "# Clone Lab\n",
	"run.sh": { content: "#!/bin/sh\necho 1\n", mode: "100755" as const },
	"src/app.py": "print(1)\n",
	"notes.txt": "notes v1\n",
};

/// Pushes `spec` as a new commit through the service.
async function push(
	setup: Setup,
	slug: string,
	spec: Parameters<typeof repositoryTree>[0],
	message: string,
): Promise<Repository> {
	const opts = { actor: setup.instructor };
	const pk = { course: setup.course.id, slug };
	await db.repository.upsert(pk, opts);
	const { files, tree } = repositoryTree(spec);
	await db.repository.addFiles(pk, files, opts);
	return db.repository.commit(pk, { tree, message }, opts);
}

async function clone(repository: Repository): Promise<string> {
	const target = path.join(workDir, tag("clone-"));
	git(workDir, ["clone", "--quiet", urlOf(repository), target]);
	git(target, ["config", "user.name", "Student"]);
	git(target, ["config", "user.email", "student@example.com"]);
	return target;
}

test.describe("git clone", () => {
	test("brings the files, the modes and a history git accepts", async () => {
		const setup = await makeCourse();
		const repository = await push(setup, tag("lab"), FIRST, "first push");

		const target = await clone(repository);

		expect(readFileSync(path.join(target, "README.md"), "utf8")).toBe(
			"# Clone Lab\n",
		);
		expect(readFileSync(path.join(target, "src/app.py"), "utf8")).toBe(
			"print(1)\n",
		);
		expect(statSync(path.join(target, "run.sh")).mode & 0o111).not.toBe(0);
		expect(statSync(path.join(target, "notes.txt")).mode & 0o111).toBe(0);
		expect(git(target, ["rev-parse", "HEAD"]).trim()).toBe(repository.head);
		expect(git(target, ["log", "--format=%s"]).trim()).toBe("first push");
		expect(git(target, ["ls-files", "-s", "run.sh"])).toMatch(/^100755 /);
		expect(() => git(target, ["fsck", "--strict"])).not.toThrow();
		expect(git(target, ["status", "--porcelain"]).trim()).toBe("");
	});

	test("git pull brings the new commit over an uncommitted change elsewhere", async () => {
		const setup = await makeCourse();
		const slug = tag("pull");
		const first = await push(setup, slug, FIRST, "first");
		const target = await clone(first);
		writeFileSync(path.join(target, "notes.txt"), "my own notes\n");

		const second = await push(
			setup,
			slug,
			{ ...FIRST, "src/app.py": "print(2)\n" },
			"fix app",
		);
		git(target, ["pull", "--quiet"]);

		expect(readFileSync(path.join(target, "src/app.py"), "utf8")).toBe(
			"print(2)\n",
		);
		expect(readFileSync(path.join(target, "notes.txt"), "utf8")).toBe(
			"my own notes\n",
		);
		expect(git(target, ["rev-parse", "HEAD"]).trim()).toBe(second.head);
		expect(git(target, ["rev-parse", "HEAD^"]).trim()).toBe(first.head);
	});

	test("git pull --no-rebase merges with a local commit", async () => {
		const setup = await makeCourse();
		const slug = tag("merge");
		const first = await push(setup, slug, FIRST, "first");
		const target = await clone(first);
		writeFileSync(path.join(target, "notes.txt"), "my own notes\n");
		git(target, ["commit", "--quiet", "-am", "student notes"]);

		const second = await push(
			setup,
			slug,
			{ ...FIRST, "src/app.py": "print(2)\n" },
			"fix app",
		);
		git(target, ["pull", "--quiet", "--no-rebase", "--no-edit"]);

		expect(readFileSync(path.join(target, "src/app.py"), "utf8")).toBe(
			"print(2)\n",
		);
		expect(readFileSync(path.join(target, "notes.txt"), "utf8")).toBe(
			"my own notes\n",
		);
		const parents = git(target, ["rev-list", "--parents", "-n", "1", "HEAD"])
			.trim()
			.split(" ");
		expect(parents).toHaveLength(3);
		expect(parents).toContain(second.head);
	});

	test("an up to date clone pulls nothing", async () => {
		const setup = await makeCourse();
		const repository = await push(setup, tag("idle"), FIRST, "first");
		const target = await clone(repository);

		git(target, ["pull", "--quiet"]);

		expect(git(target, ["rev-parse", "HEAD"]).trim()).toBe(repository.head);
	});
});

test.describe("git routes", () => {
	test("serve info/refs, HEAD, packs and loose objects with the right headers", async ({
		request,
	}) => {
		const setup = await makeCourse();
		const repository = await push(setup, tag("routes"), FIRST, "first");
		const base = urlOf(repository);
		const head = repository.head ?? "";

		const refs = await request.get(`${base}/info/refs`);
		expect(refs.status()).toBe(200);
		expect(refs.headers()["content-type"]).toContain("text/plain");
		expect(refs.headers()["cache-control"]).toContain("no-cache");
		expect(await refs.text()).toBe(`${head}\trefs/heads/main\n`);

		const smart = await request.get(
			`${base}/info/refs?service=git-upload-pack`,
		);
		expect(smart.headers()["content-type"]).toContain("text/plain");
		expect(await smart.text()).toBe(`${head}\trefs/heads/main\n`);

		const headFile = await request.get(`${base}/HEAD`);
		expect(headFile.status()).toBe(200);
		expect(await headFile.text()).toBe("ref: refs/heads/main\n");

		const packs = await request.get(`${base}/objects/info/packs`);
		expect(packs.status()).toBe(200);
		expect((await packs.body()).length).toBe(0);

		const loose = await request.get(
			`${base}/objects/${head.slice(0, 2)}/${head.slice(2)}`,
		);
		expect(loose.status()).toBe(200);
		expect(loose.headers()["content-type"]).toContain(
			"application/x-git-loose-object",
		);
		expect(loose.headers()["cache-control"]).toContain("immutable");
		expect(inflateSync(await loose.body()).toString("latin1")).toMatch(
			/^commit \d+\0tree [0-9a-f]{40}\n/,
		);
	});

	test("answer 404 to a rotated token, a wrong slug and a wrong token", async ({
		request,
	}) => {
		const setup = await makeCourse();
		const slug = tag("rot");
		const repository = await push(setup, slug, FIRST, "first");
		const oldBase = urlOf(repository);
		expect((await request.get(`${oldBase}/info/refs`)).status()).toBe(200);

		await db.repository.rotateToken(
			{ course: setup.course.id, slug },
			{ actor: setup.instructor },
		);
		const fresh = await db.repository.findOne(
			{ course: setup.course.id, slug },
			{ actor: setup.instructor },
		);

		expect((await request.get(`${oldBase}/info/refs`)).status()).toBe(404);
		expect((await request.get(`${oldBase}/HEAD`)).status()).toBe(404);
		const newBase = urlOf(fresh as Repository);
		expect(newBase).not.toBe(oldBase);
		expect((await request.get(`${newBase}/info/refs`)).status()).toBe(200);
		const wrongSlug = newBase.replace(`${slug}.git`, `${tag("other")}.git`);
		expect((await request.get(`${wrongSlug}/info/refs`)).status()).toBe(404);
		const wrongToken = newBase.replace(/\/git\/[^/]+\//, "/git/not-a-token/");
		expect((await request.get(`${wrongToken}/info/refs`)).status()).toBe(404);
	});

	test("answer 404 for a repository with no commit", async ({ request }) => {
		const setup = await makeCourse();
		const slug = tag("empty");
		const repository = await db.repository.upsert(
			{ course: setup.course.id, slug },
			{ actor: setup.instructor },
		);
		const base = urlOf(repository);

		expect((await request.get(`${base}/info/refs`)).status()).toBe(404);
		expect((await request.get(`${base}/HEAD`)).status()).toBe(404);
	});

	test("answer 404 for a missing object and for an object of another repository", async ({
		request,
	}) => {
		const setup = await makeCourse();
		const mine = await push(setup, tag("mine"), FIRST, "first");
		const other = await push(
			setup,
			tag("other"),
			{ "other.txt": "only in the other repository\n" },
			"other",
		);
		const base = urlOf(mine);
		const foreign = other.head ?? "";

		const absent = await request.get(`${base}/objects/00/${"0".repeat(38)}`);
		const stranger = await request.get(
			`${base}/objects/${foreign.slice(0, 2)}/${foreign.slice(2)}`,
		);

		expect(absent.status()).toBe(404);
		expect(stranger.status()).toBe(404);
	});
});
