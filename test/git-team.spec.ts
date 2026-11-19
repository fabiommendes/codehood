import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { bareRepositoryPath, readMain } from "@/services/git/bare";
import {
	type AssignmentFixture,
	assignmentFixture,
	holdUploadPack,
	teamGitUrl,
	teamOf,
} from "./assignment-e2e";
import {
	addRepository,
	assignmentPk,
	cleanupAssignmentScenarios,
	dropStudent,
	expireTempToken,
	hoursFromNow,
	reenroll,
	tempTokenOf,
} from "./assignment-scenario";
import { TEST_BASE_URL } from "./env";
import { expect, test } from "./fixtures";
import {
	cleanupGitTest,
	cloneInto,
	commitFiles,
	git,
	incompressible,
	workDir,
} from "./git-server";

/// The real `git` binary cloning from, fetching from and pushing to the team
/// routes of the test server.

test.afterAll(async () => {
	cleanupGitTest();
	await cleanupAssignmentScenarios();
});

const PT = process.env.CODEHOOD_LOCALE === "pt-BR";

/// A stable fragment of each refusal message, in the locale of the instance.
const REFUSAL = {
	wrongRef: PT ? "branch main" : "main branch",
	closed: PT ? "encerrado para pushes" : "closed for pushes",
	fileTooLarge: PT ? "é maior que" : "is larger than",
	pathDenied: PT ? "não é permitido" : "is not allowed",
};

const UPLOAD_PACK = "git-upload-pack";
const RECEIVE_PACK = "git-receive-pack";

async function pushesOf(teamId: number) {
	return prisma.teamPush.findMany({
		where: { teamId },
		orderBy: { id: "asc" },
	});
}

async function advertise(
	url: string,
	service: typeof UPLOAD_PACK | typeof RECEIVE_PACK,
) {
	return fetch(`${url}/info/refs?service=${service}`, { redirect: "manual" });
}

/// Every way in is a 404 and a clone fails.
async function expectGone(url: string) {
	for (const service of [UPLOAD_PACK, RECEIVE_PACK] as const) {
		expect((await advertise(url, service)).status, service).toBe(404);
	}
	const dir = workDir("gone");
	const result = await git(
		dir,
		["clone", "--quiet", url, path.join(dir, "c")],
		{
			allowFail: true,
		},
	);
	expect(result.code).not.toBe(0);
}

async function teamFor(fixture: AssignmentFixture, index: number) {
	const student = fixture.students[index];
	if (!student) throw new Error("not enough students in the fixture");
	const team = await teamOf(fixture, student);
	return { team, student, url: teamGitUrl(team.token, fixture.slug) };
}

test.describe("pushes", () => {
	test.describe.configure({ mode: "serial" });
	test.setTimeout(120_000);

	let fixture: AssignmentFixture;
	let refused: { team: { id: number }; url: string } | null = null;

	test.beforeAll(async () => {
		fixture = await assignmentFixture({
			students: 6,
			restrictions: { maxFileBytes: 1000, deny: ["secret/**"] },
		});
	});

	test("a push records its author, the new tip and no old tip on an empty repository", async () => {
		const { team, student, url } = await teamFor(fixture, 0);
		const advert = await advertise(url, UPLOAD_PACK);
		expect(advert.status).toBe(200);
		expect(advert.headers.get("content-type")).toContain(
			"application/x-git-upload-pack-advertisement",
		);

		const dir = await cloneInto(url);
		const sha = await commitFiles(dir, { "README.md": "# Mine\n" });
		await git(dir, ["push", "--quiet", "origin", "HEAD:main"]);

		expect(await readMain(team.id)).toBe(sha);
		const pushes = await pushesOf(team.id);
		expect(pushes).toHaveLength(1);
		expect(pushes[0]).toMatchObject({
			username: student.username,
			newSha: sha,
			oldSha: null,
		});
	});

	test("a push with the temporary token is recorded under its owner, and refused once it expires", async () => {
		const { team, student, url } = await teamFor(fixture, 5);
		await db.team.createTempToken({ id: team.id }, { actor: student });
		const temp = (await tempTokenOf(team, student.username)) as string;
		const tempUrl = teamGitUrl(temp, fixture.slug);

		const dir = await cloneInto(tempUrl);
		const first = await commitFiles(dir, { "README.md": "# Lab\n" });
		await git(dir, ["push", "--quiet", "origin", "HEAD:main"]);

		expect(await readMain(team.id)).toBe(first);
		expect(await pushesOf(team.id)).toMatchObject([
			{ username: student.username, newSha: first, oldSha: null },
		]);

		await expireTempToken(team, student.username);
		await commitFiles(dir, { "late.txt": "left behind\n" });
		const refused = await git(dir, ["push", "origin", "HEAD:main"], {
			allowFail: true,
		});

		expect(refused.code).not.toBe(0);
		await expectGone(tempUrl);
		expect(await readMain(team.id)).toBe(first);
		expect(await pushesOf(team.id)).toHaveLength(1);
		expect((await advertise(url, UPLOAD_PACK)).status).toBe(200);

		await db.team.createTempToken({ id: team.id }, { actor: student });
		await db.team.revokeTempToken({ id: team.id }, { actor: student });
		const revoked = (await tempTokenOf(team, student.username)) as
			| string
			| null;
		expect(revoked).toBeNull();
	});

	test("two members push in turn, and a push without a pull is refused", async () => {
		const first = fixture.students[1];
		const second = fixture.students[2];
		if (!first || !second) throw new Error("not enough students");
		const team = await teamOf(fixture, first);
		const joined = await db.team.join(
			assignmentPk(fixture),
			{ joinCode: team.joinCode as string },
			{ actor: second },
		);
		const urlA = teamGitUrl(team.token, fixture.slug);
		const urlB = teamGitUrl(joined.token, fixture.slug);

		const a = await cloneInto(urlA);
		const base = await commitFiles(a, { "a.txt": "a1\n" });
		await git(a, ["push", "--quiet", "origin", "HEAD:main"]);
		const b = await cloneInto(urlB);

		const a2 = await commitFiles(a, { "a.txt": "a2\n" });
		await git(a, ["push", "--quiet", "origin", "HEAD:main"]);
		await commitFiles(b, { "b.txt": "b1\n" });
		const stale = await git(b, ["push", "origin", "HEAD:main"], {
			allowFail: true,
		});
		expect(stale.code).not.toBe(0);
		expect(await readMain(team.id)).toBe(a2);

		await git(b, [
			"pull",
			"--quiet",
			"--no-rebase",
			"--no-edit",
			"origin",
			"main",
		]);
		const merged = (await git(b, ["rev-parse", "HEAD"])).stdout.trim();
		await git(b, ["push", "--quiet", "origin", "HEAD:main"]);

		const pushes = await pushesOf(team.id);
		expect(pushes.map((p) => p.username)).toEqual([
			first.username,
			first.username,
			second.username,
		]);
		expect(pushes[0]?.newSha).toBe(base);
		expect(pushes[2]).toMatchObject({ oldSha: a2, newSha: merged });
	});

	test("refused pushes say why and leave main and the push log alone", async () => {
		const { team, url } = await teamFor(fixture, 3);
		refused = { team, url };
		const dir = await cloneInto(url);
		const tip = await commitFiles(dir, { "README.md": "# Mine\n" });
		await git(dir, ["push", "--quiet", "origin", "HEAD:main"]);
		const pushCount = (await pushesOf(team.id)).length;

		async function expectRefused(args: string[], fragments: string[]) {
			const result = await git(dir, ["push", ...args], { allowFail: true });
			expect(result.code).not.toBe(0);
			for (const fragment of fragments) {
				expect(result.stderr).toContain(fragment);
			}
			expect(await readMain(team.id)).toBe(tip);
			expect(await pushesOf(team.id)).toHaveLength(pushCount);
			await git(dir, ["reset", "--quiet", "--hard", tip]);
		}

		await commitFiles(dir, { "other.txt": "x\n" });
		await expectRefused(
			["origin", "HEAD:other"],
			["remote:", REFUSAL.wrongRef],
		);

		await git(dir, ["commit", "--quiet", "--amend", "-m", "rewritten"]);
		await expectRefused(["--force", "origin", "HEAD:main"], []);

		await commitFiles(dir, { "big.bin": incompressible(3000) });
		await expectRefused(
			["origin", "HEAD:main"],
			["remote:", REFUSAL.fileTooLarge, "big.bin"],
		);

		await commitFiles(dir, { "secret/key.txt": "hunter2\n" });
		await expectRefused(
			["origin", "HEAD:main"],
			["remote:", REFUSAL.pathDenied, "secret/key.txt"],
		);

		await commitFiles(dir, { "late.txt": "late\n" });
		await prisma.assignment.update({
			where: { id: fixture.assignment.id },
			data: { closesAt: hoursFromNow(-1) },
		});
		await expectRefused(["origin", "HEAD:main"], ["remote:", REFUSAL.closed]);
	});

	test("clone and fetch still work after the assignment closes", async () => {
		if (!refused) throw new Error("the previous test makes the team");
		const { team, url } = refused;
		const dir = await cloneInto(url);
		expect(
			readFileSync(path.join(dir, "README.md"), "utf8").length,
		).toBeGreaterThan(0);
		await git(dir, ["fetch", "--quiet", "origin"]);
		expect((await git(dir, ["rev-parse", "origin/main"])).stdout.trim()).toBe(
			await readMain(team.id),
		);
	});
});

test.describe("template", () => {
	test.setTimeout(120_000);

	test("the first push starts from the template commit", async () => {
		const fixture = await assignmentFixture({
			template: { "README.md": "# Template\n", "src/main.py": "print(1)\n" },
		});
		const { team, student, url } = await teamFor(fixture, 0);
		const row = await prisma.team.findUniqueOrThrow({ where: { id: team.id } });
		expect(row.baseSha).toMatch(/^[0-9a-f]{40}$/);

		const dir = await cloneInto(url);
		expect(readFileSync(path.join(dir, "README.md"), "utf8")).toBe(
			"# Template\n",
		);
		expect(readFileSync(path.join(dir, "src/main.py"), "utf8")).toBe(
			"print(1)\n",
		);
		const sha = await commitFiles(dir, { "src/main.py": "print(2)\n" });
		await git(dir, ["push", "--quiet", "origin", "HEAD:main"]);

		const pushes = await pushesOf(team.id);
		expect(pushes).toHaveLength(1);
		expect(pushes[0]).toMatchObject({
			username: student.username,
			oldSha: row.baseSha,
			newSha: sha,
		});
	});
});

test.describe("doors that stay shut", () => {
	test.setTimeout(120_000);

	test("an unknown token, a wrong slug, an unopened assignment, a dropped student, a rotated token and a missing folder are all 404", async () => {
		const fixture = await assignmentFixture({ students: 4 });
		const { team, student, url } = await teamFor(fixture, 0);
		expect((await advertise(url, UPLOAD_PACK)).status).toBe(200);

		await expectGone(teamGitUrl("x".repeat(32), fixture.slug));
		await expectGone(teamGitUrl(team.token, "no-such-assignment"));

		await prisma.assignment.update({
			where: { id: fixture.assignment.id },
			data: { opensAt: hoursFromNow(3) },
		});
		await expectGone(url);
		await prisma.assignment.update({
			where: { id: fixture.assignment.id },
			data: { opensAt: null },
		});
		expect((await advertise(url, UPLOAD_PACK)).status).toBe(200);

		await dropStudent(fixture, student);
		await expectGone(url);
		await reenroll(fixture, student);
		expect((await advertise(url, UPLOAD_PACK)).status).toBe(200);

		const rotated = await db.team.rotateToken(
			{ id: team.id },
			{ actor: student },
		);
		await expectGone(url);
		expect(
			(await advertise(teamGitUrl(rotated.token, fixture.slug), UPLOAD_PACK))
				.status,
		).toBe(200);

		const other = fixture.students[1];
		if (!other) throw new Error("not enough students");
		const lost = await teamOf(fixture, other);
		await rm(bareRepositoryPath(lost.id), { recursive: true, force: true });
		await expectGone(teamGitUrl(lost.token, fixture.slug));
	});

	test("the dumb protocol is not served for teams", async () => {
		const fixture = await assignmentFixture();
		const { url } = await teamFor(fixture, 0);
		for (const rest of [
			"info/refs",
			"HEAD",
			"objects/info/packs",
			"objects/4b/825dc642cb6eb9a060e54bf8d69288fbee4904",
		]) {
			expect((await fetch(`${url}/${rest}`)).status, rest).toBe(404);
		}
	});

	test("the instructor's course repository is still cloned over the dumb protocol and never takes a push", async () => {
		const fixture = await assignmentFixture({ students: 1 });
		const repository = await addRepository(fixture, {
			"README.md": "# Course repository\n",
		});
		const url = `${TEST_BASE_URL}${new URL(repository.cloneUrl).pathname}`;

		const dir = await cloneInto(url);
		expect(readFileSync(path.join(dir, "README.md"), "utf8")).toBe(
			"# Course repository\n",
		);
		expect((await git(dir, ["rev-parse", "HEAD"])).stdout.trim()).toBe(
			repository.head,
		);

		expect((await advertise(url, RECEIVE_PACK)).status).toBe(404);
		const post = await fetch(`${url}/${RECEIVE_PACK}`, {
			method: "POST",
			headers: { "Content-Type": `application/x-${RECEIVE_PACK}-request` },
			body: "0000",
		});
		expect(post.status).toBe(404);
		await commitFiles(dir, { "hack.txt": "no\n" });
		const result = await git(dir, ["push", "origin", "HEAD:main"], {
			allowFail: true,
		});
		expect(result.code).not.toBe(0);
	});

	test("a POST without Origin and with the git content type is not stopped by the origin check", async () => {
		const fixture = await assignmentFixture();
		const { url } = await teamFor(fixture, 0);
		for (const service of [UPLOAD_PACK, RECEIVE_PACK]) {
			const response = await fetch(`${url}/${service}`, {
				method: "POST",
				headers: { "Content-Type": `application/x-${service}-request` },
				body: "0000",
			});
			expect(response.status, service).not.toBe(403);
			expect(response.status, service).not.toBe(404);
		}
		expect(url.startsWith(TEST_BASE_URL)).toBe(true);
	});
});

test.describe("transport", () => {
	test.describe.configure({ mode: "serial" });
	test.setTimeout(180_000);

	let fixture: AssignmentFixture;

	test.beforeAll(async () => {
		fixture = await assignmentFixture({ students: 4 });
	});

	test("a fetch with a long list of local commits sends a gzip body and works", async () => {
		const { team, url } = await teamFor(fixture, 0);
		const dir = await cloneInto(url);
		await commitFiles(dir, { "README.md": "# Gzip\n" });
		await git(dir, ["push", "--quiet", "origin", "HEAD:main"]);
		const mine = await cloneInto(url);
		for (let i = 0; i < 60; i++) {
			await git(mine, [
				"commit",
				"--quiet",
				"--allow-empty",
				"-m",
				`local ${i}`,
			]);
		}
		const remote = await commitFiles(dir, { "remote.txt": "new\n" });
		await git(dir, ["push", "--quiet", "origin", "HEAD:main"]);

		await git(mine, ["fetch", "--quiet", "origin"]);
		expect((await git(mine, ["rev-parse", "origin/main"])).stdout.trim()).toBe(
			remote,
		);
		expect(await readMain(team.id)).toBe(remote);
	});

	test("a 2 MB push of incompressible data is accepted", async () => {
		const { team, student, url } = await teamFor(fixture, 1);
		const dir = await cloneInto(url);
		const sha = await commitFiles(dir, {
			"data.bin": incompressible(2 * 1024 * 1024),
		});
		await git(dir, ["push", "--quiet", "origin", "HEAD:main"]);

		expect(await readMain(team.id)).toBe(sha);
		const pushes = await pushesOf(team.id);
		expect(pushes[0]).toMatchObject({
			username: student.username,
			newSha: sha,
		});
	});

	test("a missing push record is recreated, with no author, by the next access", async () => {
		const { team, url } = await teamFor(fixture, 2);
		const dir = await cloneInto(url);
		const sha = await commitFiles(dir, { "README.md": "# Lost\n" });
		await git(dir, ["push", "--quiet", "origin", "HEAD:main"]);
		await prisma.teamPush.deleteMany({ where: { teamId: team.id } });

		expect((await advertise(url, UPLOAD_PACK)).status).toBe(200);

		await expect
			.poll(async () => (await pushesOf(team.id)).length, { timeout: 10_000 })
			.toBe(1);
		const [push] = await pushesOf(team.id);
		expect(push).toMatchObject({ username: null, newSha: sha, oldSha: null });
	});

	test("a second operation of the same token is 429 with Retry-After until the first ends", async () => {
		const { url } = await teamFor(fixture, 3);
		const held = await holdUploadPack(url);
		try {
			let busy: Response | null = null;
			await expect
				.poll(
					async () => {
						const response = await advertise(url, UPLOAD_PACK);
						if (response.status === 429) busy = response;
						return response.status;
					},
					{ timeout: 15_000 },
				)
				.toBe(429);
			const retry = Number(
				(busy as Response | null)?.headers.get("retry-after"),
			);
			expect(retry).toBeGreaterThan(0);
		} finally {
			held.release();
		}

		await expect
			.poll(async () => (await advertise(url, UPLOAD_PACK)).status, {
				timeout: 15_000,
			})
			.toBe(200);
	});
});
