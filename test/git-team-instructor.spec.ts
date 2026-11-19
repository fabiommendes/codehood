import path from "node:path";
import { db } from "@/db";
import { persistedUserFactory } from "@/fixtures/user.factory";
import { readMain } from "@/services/git/bare";
import {
	type AssignmentFixture,
	apiKeyFor,
	assignmentFixture,
	gitWithKey,
	instructorGitUrl,
	setAssignmentColumns,
	teamOf,
} from "./assignment-e2e";
import {
	actorOf,
	assignmentPk,
	cleanupAssignmentScenarios,
	hoursFromNow,
	realPush,
	stopRealPush,
	tag,
} from "./assignment-scenario";
import { TEST_BASE_URL } from "./env";
import { expect, test } from "./fixtures";
import { cleanupGitTest, commitFiles, git, workDir } from "./git-server";

/// The instructor reading the repository of any team of the course with an API
/// key, and never writing to it.

test.afterAll(async () => {
	await stopRealPush();
	cleanupGitTest();
	await cleanupAssignmentScenarios();
});

const UPLOAD_PACK = "git-upload-pack";
const RECEIVE_PACK = "git-receive-pack";

/// An empty team: an instructor puts it together with nobody in it.
async function emptyTeam(fixture: AssignmentFixture) {
	return db.team.createFor(
		assignmentPk(fixture),
		{ name: tag("empty"), members: [] },
		{ actor: fixture.instructor },
	);
}

async function cloneWithKey(key: string, url: string) {
	const parent = workDir("instructor");
	const dir = path.join(parent, "repo");
	await gitWithKey(key, parent, ["clone", "--quiet", url, dir]);
	return dir;
}

function authorized(key: string): Record<string, string> {
	return { Authorization: `Bearer ${key}` };
}

test.describe("the instructor reads", () => {
	test.setTimeout(120_000);

	test("clones the tip of main, of a team without members and of a closed assignment", async () => {
		const fixture = await assignmentFixture({
			template: { "README.md": "# Template\n" },
			students: 2,
		});
		const key = await apiKeyFor(fixture.instructor);
		const student = fixture.students[0];
		if (!student) throw new Error("no student");
		const team = await teamOf(fixture, student);
		const pushed = await realPush(team, { "work.txt": "done\n" });

		const dir = await cloneWithKey(
			key,
			instructorGitUrl(fixture, team.publicId),
		);
		expect((await git(dir, ["rev-parse", "HEAD"])).stdout.trim()).toBe(pushed);
		expect(await readMain(team.id)).toBe(pushed);

		const nobody = await emptyTeam(fixture);
		const template = await cloneWithKey(
			key,
			instructorGitUrl(fixture, nobody.publicId),
		);
		expect((await git(template, ["rev-parse", "HEAD"])).stdout.trim()).toBe(
			await readMain(nobody.id),
		);

		await setAssignmentColumns(fixture, { closesAt: hoursFromNow(-1) });
		await gitWithKey(key, dir, ["fetch", "--quiet", "origin"]);
		const closed = await cloneWithKey(
			key,
			instructorGitUrl(fixture, team.publicId),
		);
		expect((await git(closed, ["rev-parse", "HEAD"])).stdout.trim()).toBe(
			pushed,
		);
	});

	test("cannot push: the receive-pack door is a 404 and git push fails", async () => {
		const fixture = await assignmentFixture({
			template: { "README.md": "# Template\n" },
			students: 1,
		});
		const key = await apiKeyFor(fixture.instructor);
		const student = fixture.students[0];
		if (!student) throw new Error("no student");
		const team = await teamOf(fixture, student);
		const url = instructorGitUrl(fixture, team.publicId);
		const before = await readMain(team.id);

		const advert = await fetch(`${url}/info/refs?service=${RECEIVE_PACK}`, {
			headers: authorized(key),
		});
		expect(advert.status).toBe(404);
		const post = await fetch(`${url}/${RECEIVE_PACK}`, {
			method: "POST",
			headers: {
				...authorized(key),
				"Content-Type": `application/x-${RECEIVE_PACK}-request`,
			},
			body: "0000",
		});
		expect(post.status).toBe(404);

		const dir = await cloneWithKey(key, url);
		await commitFiles(dir, { "hack.txt": "no\n" });
		const result = await gitWithKey(key, dir, ["push", "origin", "HEAD:main"], {
			allowFail: true,
		});
		expect(result.code).not.toBe(0);
		expect(await readMain(team.id)).toBe(before);
	});
});

test.describe("who is turned away", () => {
	test.setTimeout(120_000);

	test("no key is 401 without a challenge; a student, a stranger and another assignment's team are 404", async () => {
		const fixture = await assignmentFixture({
			template: { "README.md": "# Template\n" },
			students: 2,
		});
		const other = await assignmentFixture({
			template: { "README.md": "# Template\n" },
			students: 1,
		});
		const student = fixture.students[0];
		const otherStudent = other.students[0];
		if (!student || !otherStudent) throw new Error("no student");
		const team = await teamOf(fixture, student);
		const foreign = await teamOf(other, otherStudent);
		const url = instructorGitUrl(fixture, team.publicId);
		expect(url.startsWith(TEST_BASE_URL)).toBe(true);
		const advert = `${url}/info/refs?service=${UPLOAD_PACK}`;

		const own = await apiKeyFor(fixture.instructor);
		expect((await fetch(advert, { headers: authorized(own) })).status).toBe(
			200,
		);

		const anonymous = await fetch(advert);
		expect(anonymous.status).toBe(401);
		expect(anonymous.headers.get("www-authenticate")).toBeNull();
		const bogus = await fetch(advert, { headers: authorized("not-a-key") });
		expect(bogus.status).toBe(401);
		expect(bogus.headers.get("www-authenticate")).toBeNull();
		const bare = workDir("anonymous");
		const refused = await git(
			bare,
			["clone", "--quiet", url, path.join(bare, "c")],
			{
				allowFail: true,
			},
		);
		expect(refused.code).not.toBe(0);
		// Git reports a 401 with no challenge as a failed credential prompt.
		expect(refused.stderr).toMatch(/401|could not read Username/);

		const studentKey = await apiKeyFor(student);
		expect(
			(await fetch(advert, { headers: authorized(studentKey) })).status,
		).toBe(404);

		const stranger = actorOf(
			await persistedUserFactory.create({ role: "INSTRUCTOR" }),
		);
		const strangerKey = await apiKeyFor(stranger);
		expect(
			(await fetch(advert, { headers: authorized(strangerKey) })).status,
		).toBe(404);

		const crossed = instructorGitUrl(fixture, foreign.publicId);
		expect(
			(
				await fetch(`${crossed}/info/refs?service=${UPLOAD_PACK}`, {
					headers: authorized(own),
				})
			).status,
		).toBe(404);
	});
});
