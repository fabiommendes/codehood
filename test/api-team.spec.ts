import { db } from "@/db";
import { prisma } from "@/db/client";
import {
	apiAs,
	assertNoSecrets,
	assignmentPk,
	assignmentUrl,
	disposeApiContexts,
	memberUrl,
	rosterOf,
	teamsUrl,
} from "./api-assignment-support";
import {
	type AssignmentFixture,
	assignmentFixture,
	setAssignmentColumns,
	teamOf,
} from "./assignment-e2e";
import {
	cleanupAssignmentScenarios,
	daysFromNow,
	fakeSha,
	folderExists,
	seedPushes,
	tag,
	tokenOf,
} from "./assignment-scenario";
import { expect, test } from "./fixtures";

/// The team routes over HTTP: composing teams as the instructor, the deadline
/// extension, the identity of a team in the path and what the bodies leave out.

test.afterAll(async () => {
	await disposeApiContexts();
	await cleanupAssignmentScenarios();
});

/// A team made through the service, as the instructor, with `members` in it.
function makeTeam(
	fixture: AssignmentFixture,
	members: string[] = [],
	name: string = tag("team"),
) {
	return db.team.createFor(
		assignmentPk(fixture),
		{ name, members },
		{ actor: fixture.instructor },
	);
}

type Listed = {
	publicId: string;
	name: string;
	dueAt: string;
	extended: boolean;
	members: { username: string; name: string }[];
	delivery: {
		onTime: {
			newSha: string;
			createdAt: string;
			username: string | null;
		} | null;
		late: { newSha: string; createdAt: string; username: string | null } | null;
	};
	sizeException: string | null;
};

async function listTeams(
	api: Awaited<ReturnType<typeof apiAs>>,
	fixture: AssignmentFixture,
): Promise<Listed[]> {
	const response = await api.get(teamsUrl(fixture));
	expect(response.status()).toBe(200);
	return (await response.json()).items;
}

test.describe("create", () => {
	test("a caller with no key cannot make a team", async ({ request }) => {
		const fixture = await assignmentFixture();

		const response = await request.post(teamsUrl(fixture), {
			data: { name: "Anon", members: [] },
		});

		expect(response.status()).toBe(401);
		expect(await prisma.team.count({ where: { name: "Anon" } })).toBe(0);
	});

	test("makes a team with no members and one with two students", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture({ students: 4 });
		const api = await apiAs(playwright, fixture.instructor);
		const [one, two] = rosterOf(fixture);

		const empty = await api.post(teamsUrl(fixture), {
			data: { name: "Empty", members: [] },
		});
		const pair = await api.post(teamsUrl(fixture), {
			data: { name: "Pair", members: [one.username, two.username] },
		});

		expect(empty.status()).toBe(200);
		expect((await empty.json()).members).toEqual([]);
		expect(pair.status()).toBe(200);
		const made = await pair.json();
		expect(made.name).toBe("Pair");
		expect(
			made.members.map((m: { username: string }) => m.username).sort(),
		).toEqual([one.username, two.username].sort());
		expect(made.publicId).toEqual(expect.any(String));
		const team = await prisma.team.findFirstOrThrow({
			where: { publicId: made.publicId },
		});
		expect(folderExists(team)).toBe(true);
	});

	test("a student with no enrollment in the course is a 400", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);

		const response = await api.post(teamsUrl(fixture), {
			data: { name: "Ghosts", members: [fixture.outsider.username] },
		});

		expect(response.status()).toBe(400);
		expect(await listTeams(api, fixture)).toEqual([]);
	});

	test("a student already in another team is a 400", async ({ playwright }) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);
		await makeTeam(fixture, [rosterOf(fixture)[0].username]);

		const response = await api.post(teamsUrl(fixture), {
			data: { name: "Again", members: [rosterOf(fixture)[0].username] },
		});

		expect(response.status()).toBe(400);
		expect(await listTeams(api, fixture)).toHaveLength(1);
	});

	test("an individual assignment takes no team from the instructor", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture({ teamMin: 1, teamMax: 1 });
		const api = await apiAs(playwright, fixture.instructor);

		const response = await api.post(teamsUrl(fixture), {
			data: { name: "Solo", members: [] },
		});

		expect(response.status()).toBe(400);
	});

	test("a repeated name is a 400", async ({ playwright }) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);
		await makeTeam(fixture, [], "Same");

		const response = await api.post(teamsUrl(fixture), {
			data: { name: "Same", members: [] },
		});

		expect(response.status()).toBe(400);
	});
});

test.describe("patch", () => {
	test("name and dueAt are written, and dueAt null clears the extension", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);
		const team = await makeTeam(fixture);
		const url = teamsUrl(fixture, team.publicId);
		const extension = daysFromNow(14).toISOString();

		const renamed = await api.patch(url, { data: { name: "Renamed" } });
		const extended = await api.patch(url, { data: { dueAt: extension } });
		const cleared = await api.patch(url, { data: { dueAt: null } });

		expect(renamed.status()).toBe(200);
		expect((await renamed.json()).name).toBe("Renamed");
		expect(extended.status()).toBe(200);
		const afterExtend = await extended.json();
		expect(new Date(afterExtend.dueAt).toISOString()).toBe(extension);
		expect(afterExtend.extended).toBe(true);
		expect(afterExtend.name).toBe("Renamed");
		expect(cleared.status()).toBe(200);
		const afterClear = await cleared.json();
		expect(afterClear.extended).toBe(false);
		expect(new Date(afterClear.dueAt).toISOString()).toBe(
			fixture.assignment.dueAt.toISOString(),
		);
	});

	test("a name another team has is a 400", async ({ playwright }) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);
		await makeTeam(fixture, [], "Taken");
		const team = await makeTeam(fixture);

		const response = await api.patch(teamsUrl(fixture, team.publicId), {
			data: { name: "Taken" },
		});

		expect(response.status()).toBe(400);
	});

	test("an individual assignment refuses a name and still takes a deadline", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture({ teamMin: 1, teamMax: 1 });
		const api = await apiAs(playwright, fixture.instructor);
		const team = await teamOf(fixture, rosterOf(fixture)[0]);
		const url = teamsUrl(fixture, team.publicId);

		const renamed = await api.patch(url, { data: { name: "Nope" } });
		const extended = await api.patch(url, {
			data: { dueAt: daysFromNow(10).toISOString() },
		});

		expect(renamed.status()).toBe(400);
		expect(extended.status()).toBe(200);
	});

	test("a deadline before the assignment's is accepted", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);
		const team = await makeTeam(fixture);
		const earlier = daysFromNow(1).toISOString();

		const response = await api.patch(teamsUrl(fixture, team.publicId), {
			data: { dueAt: earlier },
		});

		expect(response.status()).toBe(200);
		expect(new Date((await response.json()).dueAt).toISOString()).toBe(earlier);
	});
});

test.describe("members", () => {
	test("putting a student moves them and gives them a new token", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);
		const [student, mate] = rosterOf(fixture);
		const from = await makeTeam(fixture, [student.username]);
		const to = await makeTeam(fixture, [mate.username]);
		const before = await tokenOf(from, student.username);

		const moved = await api.put(
			memberUrl(fixture, to.publicId, student.username),
		);

		expect(moved.status()).toBe(200);
		const body = await moved.json();
		expect(
			body.members.map((m: { username: string }) => m.username).sort(),
		).toEqual([mate.username, student.username].sort());
		const after = await tokenOf(to, student.username);
		expect(after).not.toBeNull();
		expect(after).not.toBe(before);
		expect(await tokenOf(from, student.username)).toBeNull();
		const teams = await listTeams(api, fixture);
		expect(teams.find((t) => t.publicId === from.publicId)?.members).toEqual(
			[],
		);
	});

	test("repeating the same PUT keeps the token", async ({ playwright }) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);
		const student = rosterOf(fixture)[0];
		const team = await makeTeam(fixture);
		const url = memberUrl(fixture, team.publicId, student.username);
		expect((await api.put(url)).status()).toBe(200);
		const first = await tokenOf(team, student.username);

		const again = await api.put(url);

		expect(again.status()).toBe(200);
		expect(await tokenOf(team, student.username)).toBe(first);
	});

	test("a user with no enrollment cannot be put in a team", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);
		const team = await makeTeam(fixture);

		const response = await api.put(
			memberUrl(fixture, team.publicId, fixture.outsider.username),
		);

		expect(response.status()).toBe(400);
	});

	test("removing the last member leaves the team with its pushes and folder", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);
		const student = rosterOf(fixture)[0];
		const team = await makeTeam(fixture, [student.username]);
		await seedPushes(team, [
			{ sha: fakeSha("a"), createdAt: new Date(), username: student.username },
		]);

		const response = await api.delete(
			memberUrl(fixture, team.publicId, student.username),
		);

		expect(response.status()).toBe(200);
		const left = (await listTeams(api, fixture)).find(
			(t) => t.publicId === team.publicId,
		);
		expect(left?.members).toEqual([]);
		expect(await prisma.teamPush.count({ where: { teamId: team.id } })).toBe(1);
		expect(folderExists(team)).toBe(true);
		expect(await tokenOf(team, student.username)).toBeNull();
	});

	test("removing someone who is not in the team is a 404", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);
		const team = await makeTeam(fixture);

		const response = await api.delete(
			memberUrl(fixture, team.publicId, rosterOf(fixture)[0].username),
		);

		expect(response.status()).toBe(404);
	});
});

test.describe("delete", () => {
	test("removes the team and its folder, and its publicId answers 404 after", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);
		const team = await makeTeam(fixture, [rosterOf(fixture)[0].username]);
		expect(folderExists(team)).toBe(true);
		const url = teamsUrl(fixture, team.publicId);

		const response = await api.delete(url);

		expect(response.status()).toBe(200);
		expect(folderExists(team)).toBe(false);
		expect(await prisma.team.count({ where: { id: team.id } })).toBe(0);
		expect((await api.patch(url, { data: { name: "Late" } })).status()).toBe(
			404,
		);
		expect(await listTeams(api, fixture)).toEqual([]);
	});
});

test.describe("the team in the path", () => {
	test("the numeric id is not a team", async ({ playwright }) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);
		const team = await makeTeam(fixture);

		const patch = await api.patch(teamsUrl(fixture, team.id), {
			data: { name: "ById" },
		});
		const remove = await api.delete(teamsUrl(fixture, team.id));

		expect(patch.status()).toBe(404);
		expect(remove.status()).toBe(404);
		expect(await prisma.team.count({ where: { id: team.id } })).toBe(1);
	});

	test("the publicId of a team of another assignment is a 404", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture();
		const api = await apiAs(playwright, fixture.instructor);
		const student = rosterOf(fixture)[0];
		const sibling = tag("sibling");
		const created = await api.put(assignmentUrl(fixture, sibling), {
			data: {
				title: "Other",
				body: "x",
				dueAt: daysFromNow(7).toISOString(),
				teamMin: 1,
				teamMax: 3,
			},
		});
		expect(created.status()).toBe(200);
		const foreign = await makeTeam(fixture);
		const elsewhere = { ...fixture, slug: sibling };

		const responses = [
			await api.patch(teamsUrl(elsewhere, foreign.publicId), {
				data: { name: "X" },
			}),
			await api.delete(teamsUrl(elsewhere, foreign.publicId)),
			await api.put(memberUrl(elsewhere, foreign.publicId, student.username)),
			await api.delete(
				memberUrl(elsewhere, foreign.publicId, student.username),
			),
		];

		expect(responses.map((r) => r.status())).toEqual([404, 404, 404, 404]);
		expect(await prisma.team.count({ where: { id: foreign.id } })).toBe(1);
	});
});

test.describe("what the bodies carry", () => {
	test("no response carries a token, a join code or a base commit", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture({
			students: 4,
			template: { "README.md": "# Base\n" },
		});
		const api = await apiAs(playwright, fixture.instructor);
		const [a, b, c] = rosterOf(fixture);
		const seeded = await makeTeam(fixture, [a.username]);
		const url = teamsUrl(fixture, seeded.publicId);

		const created = await api.post(teamsUrl(fixture), {
			data: { name: "Fresh", members: [b.username] },
		});
		const patched = await api.patch(url, { data: { name: "Patched" } });
		const added = await api.put(
			memberUrl(fixture, seeded.publicId, c.username),
		);
		const removed = await api.delete(
			memberUrl(fixture, seeded.publicId, c.username),
		);
		const listed = await api.get(teamsUrl(fixture));
		const assignment = await api.get(assignmentUrl(fixture));

		for (const [label, response] of Object.entries({
			created,
			patched,
			added,
			removed,
			listed,
			assignment,
		})) {
			expect(response.status(), label).toBe(200);
			assertNoSecrets(await response.json(), label);
		}
	});
});

test.describe("listing", () => {
	test("brings members, deadline, deliveries and size exceptions per team", async ({
		playwright,
	}) => {
		const fixture = await assignmentFixture({
			students: 5,
			teamMin: 2,
			teamMax: 3,
		});
		const api = await apiAs(playwright, fixture.instructor);
		const [s0, s1, s2, s3, s4] = rosterOf(fixture);
		const due = daysFromNow(-2);
		await setAssignmentColumns(fixture, { dueAt: due });
		const onTimeAt = daysFromNow(-3);
		const lateAt = daysFromNow(-1);
		const above = await makeTeam(
			fixture,
			[s0, s1, s2, s3].map((s) => s.username),
			"Above",
		);
		const below = await makeTeam(fixture, [s4.username], "Below");
		const empty = await makeTeam(fixture, [], "Empty");
		await seedPushes(above, [
			{ sha: fakeSha("a"), createdAt: onTimeAt, username: s0.username },
			{ sha: fakeSha("b"), createdAt: lateAt, username: s1.username },
		]);
		const extension = daysFromNow(5);
		const patched = await api.patch(teamsUrl(fixture, below.publicId), {
			data: { dueAt: extension.toISOString() },
		});
		expect(patched.status()).toBe(200);

		const teams = await listTeams(api, fixture);

		const get = (publicId: string) =>
			teams.find((t) => t.publicId === publicId) as Listed;
		expect(teams.map((t) => t.name)).toEqual(
			expect.arrayContaining(["Above", "Below", "Empty"]),
		);
		const aboveRow = get(above.publicId);
		expect(aboveRow.members.map((m) => m.username).sort()).toEqual(
			[s0, s1, s2, s3].map((s) => s.username).sort(),
		);
		expect(aboveRow.members[0]?.name).toEqual(expect.any(String));
		expect(aboveRow.extended).toBe(false);
		expect(new Date(aboveRow.dueAt).getTime()).toBe(due.getTime());
		expect(aboveRow.delivery.onTime).toMatchObject({
			newSha: fakeSha("a"),
			username: s0.username,
		});
		expect(new Date(aboveRow.delivery.onTime?.createdAt ?? 0).getTime()).toBe(
			onTimeAt.getTime(),
		);
		expect(aboveRow.delivery.late).toMatchObject({
			newSha: fakeSha("b"),
			username: s1.username,
		});
		expect(aboveRow.sizeException).toBe("above");
		const belowRow = get(below.publicId);
		expect(belowRow.extended).toBe(true);
		expect(new Date(belowRow.dueAt).getTime()).toBe(extension.getTime());
		expect(belowRow.delivery).toEqual({ onTime: null, late: null });
		expect(belowRow.sizeException).toBe("below");
		expect(get(empty.publicId).sizeException).toBe("empty");
	});
});
