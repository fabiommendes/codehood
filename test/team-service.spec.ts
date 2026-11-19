import { expect, test } from "@playwright/test";
import { SYSTEM, type UserActor } from "@/auth/actor";
import { InvalidData, NotAllowed, NotFound } from "@/core/error";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { makeTeamService } from "@/db/services/team.service";
import * as bare from "@/services/git/bare";
import { listPaths, readMain } from "@/services/git/bare";
import {
	addRepository,
	assignmentPk,
	assignmentScenario,
	changeAssignment,
	cleanupAssignmentScenarios,
	commitToRepository,
	createTeam,
	dropStudent,
	fakeSha,
	folderExists,
	hoursFromNow,
	realPush,
	reenroll,
	repositoryFolders,
	type Scenario,
	seedPushes,
	stopRealPush,
	tag,
	teamPk,
	tokenOf,
} from "./assignment-scenario";

/// `TeamService`: forming and leaving teams, the instructor's overrides,
/// tokens, pushes and what each reader may see. The repositories are real
/// folders of the worker's repository root.

test.afterAll(async () => {
	await stopRealPush();
	await cleanupAssignmentScenarios();
});

/// The student at `index`, narrowed.
function student(s: Scenario, index: number): UserActor {
	return s.students[index] as UserActor;
}

const asInstructor = (s: Scenario) => ({ actor: s.instructor });

async function join(s: Scenario, joinCode: string | null, actor: UserActor) {
	return db.team.join(
		assignmentPk(s),
		{ joinCode: joinCode as string },
		{ actor },
	);
}

/// A team made by the instructor, so the lock date and the size limits are out of the way.
async function staffTeam(
	s: Scenario,
	members: UserActor[],
	name = tag("team"),
) {
	return db.team.createFor(
		assignmentPk(s),
		{ name, members: members.map((m) => m.username) },
		asInstructor(s),
	);
}

async function memberNames(teamId: number): Promise<string[]> {
	const rows = await prisma.teamMember.findMany({
		where: { teamId },
		select: { username: true },
	});
	return rows.map((r) => r.username).sort();
}

function usernames(members: { username: string }[]): string[] {
	return members.map((m) => m.username).sort();
}

/// Every key of a JSON-like value, at any depth.
function keysDeep(value: unknown, into = new Set<string>()): Set<string> {
	if (Array.isArray(value)) {
		for (const item of value) keysDeep(item, into);
	} else if (value && typeof value === "object" && !(value instanceof Date)) {
		for (const [key, item] of Object.entries(value)) {
			into.add(key);
			keysDeep(item, into);
		}
	}
	return into;
}

//
// create
//

test.describe("create", () => {
	test("makes the creator a member with a token, a join code and an empty repository", async () => {
		const s = await assignmentScenario();
		const ana = student(s, 0);

		const team = await db.team.create(
			assignmentPk(s),
			{ name: "Alpha" },
			{ actor: ana },
		);

		expect(team.name).toBe("Alpha");
		expect(usernames(team.members)).toEqual([ana.username]);
		expect(team.token).toBe(await tokenOf(team, ana.username));
		expect(team.joinCode).toHaveLength(8);
		expect(folderExists(team)).toBe(true);
		expect(await readMain(team.id)).toBeNull();
		const row = await prisma.team.findUniqueOrThrow({ where: { id: team.id } });
		expect(row.baseSha).toBeNull();
	});

	test("in an individual assignment the name is the username and there is no code", async () => {
		const s = await assignmentScenario({ teamMin: 1, teamMax: 1 });
		const ana = student(s, 0);

		const team = await db.team.create(
			assignmentPk(s),
			{ name: "ignored" },
			{ actor: ana },
		);

		expect(team.name).toBe(ana.username);
		expect(team.joinCode).toBeNull();
		expect(folderExists(team)).toBe(true);
		const row = await prisma.team.findUniqueOrThrow({ where: { id: team.id } });
		expect(row.joinCode).toBeNull();
	});

	test("starts from the head of the template, without recording a push", async () => {
		const s = await assignmentScenario({
			template: { "README.md": "# Starter\n", "src/main.py": "print(1)\n" },
		});

		const team = await createTeam(s, student(s, 0));

		const head = s.template?.repository.head as string;
		expect(await readMain(team.id)).toBe(head);
		expect((await listPaths(team.id, head)).sort()).toEqual([
			"README.md",
			"src/main.py",
		]);
		expect(await prisma.teamPush.count({ where: { teamId: team.id } })).toBe(0);
		const row = await prisma.team.findUniqueOrThrow({ where: { id: team.id } });
		expect(row.baseSha).toBe(head);
		const listing = await db.team.listWithDeliveries(
			assignmentPk(s),
			asInstructor(s),
		);
		const delivery = listing.find((t) => t.id === team.id)?.delivery;
		expect(delivery?.onTime).toBeNull();
		expect(delivery?.late).toBeNull();
	});

	test("a template with no commit starts an empty repository", async () => {
		const s = await assignmentScenario({ template: "empty" });

		const team = await createTeam(s, student(s, 0));

		expect(await readMain(team.id)).toBeNull();
		const row = await prisma.team.findUniqueOrThrow({ where: { id: team.id } });
		expect(row.baseSha).toBeNull();
	});

	test("a later template commit reaches only the teams created after it", async () => {
		const s = await assignmentScenario({ template: { "v1.txt": "1\n" } });
		const early = await createTeam(s, student(s, 0));

		const next = await commitToRepository(
			s.template?.repository as never,
			{ "v2.txt": "2\n" },
			s.instructor,
		);
		const late = await createTeam(s, student(s, 1));

		expect(next.head).not.toBe(s.template?.repository.head);
		expect(await readMain(early.id)).toBe(s.template?.repository.head);
		expect(await readMain(late.id)).toBe(next.head);
		expect(await listPaths(late.id, next.head as string)).toEqual(["v2.txt"]);
	});

	test("is refused after teamsLockAt", async () => {
		const s = await assignmentScenario({ teamsLockAt: hoursFromNow(-1) });

		await expect(createTeam(s, student(s, 0))).rejects.toBeInstanceOf(
			NotAllowed,
		);
		expect(
			await prisma.team.count({ where: { assignmentId: s.assignment.id } }),
		).toBe(0);
	});

	test("is refused for a student who is already in a team of the assignment", async () => {
		const s = await assignmentScenario();
		const ana = student(s, 0);
		await createTeam(s, ana);

		await expect(createTeam(s, ana)).rejects.toBeInstanceOf(InvalidData);
		expect(
			await prisma.team.count({ where: { assignmentId: s.assignment.id } }),
		).toBe(1);
	});

	test("is refused for a repeated name", async () => {
		const s = await assignmentScenario();
		await createTeam(s, student(s, 0), "Alpha");

		await expect(createTeam(s, student(s, 1), "Alpha")).rejects.toBeInstanceOf(
			InvalidData,
		);
	});

	test("is refused for a dropped student", async () => {
		const s = await assignmentScenario({ dropped: 1 });

		await expect(
			createTeam(s, s.dropped[0] as UserActor),
		).rejects.toBeInstanceOf(NotFound);
	});

	test("is refused while the assignment is not open yet", async () => {
		const s = await assignmentScenario({ opensAt: hoursFromNow(4) });

		await expect(createTeam(s, student(s, 0))).rejects.toBeInstanceOf(NotFound);
	});

	test("leaves no row behind when the disk fails, and the error surfaces", async () => {
		const s = await assignmentScenario();
		const ana = student(s, 0);
		const failing = makeTeamService({
			...bare,
			createBareRepository: async () => {
				throw new Error("disk full");
			},
		});
		const foldersBefore = repositoryFolders();

		await expect(
			failing.create(assignmentPk(s), { name: "Alpha" }, { actor: ana }),
		).rejects.toThrow("disk full");

		expect(
			await prisma.team.count({ where: { assignmentId: s.assignment.id } }),
		).toBe(0);
		expect(
			await prisma.teamMember.count({
				where: { assignmentId: s.assignment.id },
			}),
		).toBe(0);
		expect(repositoryFolders()).toEqual(foldersBefore);
		const retry = await createTeam(s, ana, "Alpha");
		expect(folderExists(retry)).toBe(true);
	});

	test("two creations by the same student at once: one wins, one folder remains", async () => {
		const s = await assignmentScenario();
		const ana = student(s, 0);
		const before = new Set(repositoryFolders());

		const results = await Promise.allSettled([
			createTeam(s, ana, "Alpha"),
			createTeam(s, ana, "Beta"),
		]);

		const won = results.filter((r) => r.status === "fulfilled");
		const lost = results.filter((r) => r.status === "rejected");
		expect(won).toHaveLength(1);
		expect(lost).toHaveLength(1);
		expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(
			InvalidData,
		);
		const rows = await prisma.team.findMany({
			where: { assignmentId: s.assignment.id },
		});
		expect(rows).toHaveLength(1);
		const added = repositoryFolders().filter((name) => !before.has(name));
		expect(added).toEqual([`${rows[0]?.id}.git`]);
	});
});

//
// join
//

test.describe("join", () => {
	test("adds the student, with a token of their own", async () => {
		const s = await assignmentScenario();
		const team = await createTeam(s, student(s, 0));

		const joined = await join(s, team.joinCode, student(s, 1));

		expect(joined.id).toBe(team.id);
		expect(usernames(joined.members)).toEqual(
			[student(s, 0).username, student(s, 1).username].sort(),
		);
		expect(joined.token).not.toBe(team.token);
		expect(joined.token).toBe(await tokenOf(team, student(s, 1).username));
	});

	test("takes the code in any letter case", async () => {
		const s = await assignmentScenario();
		const team = await createTeam(s, student(s, 0));

		const joined = await join(
			s,
			(team.joinCode as string).toLowerCase(),
			student(s, 1),
		);

		expect(joined.id).toBe(team.id);
	});

	test("is refused when the team already has teamMax members", async () => {
		const s = await assignmentScenario({ teamMax: 2 });
		const team = await createTeam(s, student(s, 0));
		await join(s, team.joinCode, student(s, 1));

		await expect(join(s, team.joinCode, student(s, 2))).rejects.toBeInstanceOf(
			InvalidData,
		);
		expect(await memberNames(team.id)).toHaveLength(2);
	});

	test("is refused for a student already in another team", async () => {
		const s = await assignmentScenario();
		const a = await createTeam(s, student(s, 0));
		const b = await createTeam(s, student(s, 1));

		await expect(join(s, a.joinCode, student(s, 1))).rejects.toBeInstanceOf(
			InvalidData,
		);
		expect(await memberNames(b.id)).toEqual([student(s, 1).username]);
	});

	test("is refused for a code that belongs to another assignment, or to none", async () => {
		const s = await assignmentScenario();
		const other = await assignmentScenario();
		const foreign = await createTeam(other, student(other, 0));

		await expect(
			join(s, foreign.joinCode, student(s, 0)),
		).rejects.toBeInstanceOf(InvalidData);
		await expect(join(s, "ZZZZZZZZ", student(s, 0))).rejects.toBeInstanceOf(
			InvalidData,
		);
	});

	test("is refused after teamsLockAt", async () => {
		const s = await assignmentScenario();
		const team = await createTeam(s, student(s, 0));
		await changeAssignment(s, { teamsLockAt: hoursFromNow(-1) });

		await expect(join(s, team.joinCode, student(s, 1))).rejects.toBeInstanceOf(
			NotAllowed,
		);
	});

	test("is refused for a dropped student", async () => {
		const s = await assignmentScenario({ dropped: 1 });
		const team = await createTeam(s, student(s, 0));

		await expect(
			join(s, team.joinCode, s.dropped[0] as UserActor),
		).rejects.toBeInstanceOf(NotFound);
	});

	test("two students racing for the last seat: one gets in", async () => {
		const s = await assignmentScenario({ teamMax: 2 });
		const team = await createTeam(s, student(s, 0));

		const results = await Promise.allSettled([
			join(s, team.joinCode, student(s, 1)),
			join(s, team.joinCode, student(s, 2)),
		]);

		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		const lost = results.find(
			(r) => r.status === "rejected",
		) as PromiseRejectedResult;
		expect(lost.reason).toBeInstanceOf(InvalidData);
		expect(await memberNames(team.id)).toHaveLength(2);
	});
});

//
// leave
//

test.describe("leave", () => {
	test("a member who is not the last goes, and the old token stops resolving", async () => {
		const s = await assignmentScenario();
		const team = await createTeam(s, student(s, 0));
		const joined = await join(s, team.joinCode, student(s, 1));

		await db.team.leave(teamPk(team), { actor: student(s, 1) });

		expect(await memberNames(team.id)).toEqual([student(s, 0).username]);
		expect(
			await db.team.findByToken(joined.token, s.assignment.slug),
		).toBeNull();
		expect(
			await db.team.findByToken(team.token, s.assignment.slug),
		).not.toBeNull();
		const again = await createTeam(s, student(s, 1));
		expect(again.id).not.toBe(team.id);
	});

	test("the last member of a team with no push deletes the team and its folder", async () => {
		const s = await assignmentScenario();
		const team = await createTeam(s, student(s, 0));

		await db.team.leave(teamPk(team), { actor: student(s, 0) });

		expect(await prisma.team.count({ where: { id: team.id } })).toBe(0);
		expect(folderExists(team)).toBe(false);
	});

	test("the last member of a team with a push cannot leave", async () => {
		const s = await assignmentScenario();
		const team = await createTeam(s, student(s, 0));
		await seedPushes(team, [
			{
				sha: fakeSha("a"),
				createdAt: new Date(),
				username: student(s, 0).username,
			},
		]);

		await expect(
			db.team.leave(teamPk(team), { actor: student(s, 0) }),
		).rejects.toBeInstanceOf(InvalidData);

		expect(await memberNames(team.id)).toEqual([student(s, 0).username]);
		expect(folderExists(team)).toBe(true);
	});

	test("is refused after teamsLockAt", async () => {
		const s = await assignmentScenario();
		const team = await createTeam(s, student(s, 0));
		await join(s, team.joinCode, student(s, 1));
		await changeAssignment(s, { teamsLockAt: hoursFromNow(-1) });

		await expect(
			db.team.leave(teamPk(team), { actor: student(s, 1) }),
		).rejects.toBeInstanceOf(NotAllowed);
		expect(await memberNames(team.id)).toHaveLength(2);
	});

	test("is refused in an individual assignment", async () => {
		const s = await assignmentScenario({ teamMin: 1, teamMax: 1 });
		const team = await createTeam(s, student(s, 0));

		await expect(
			db.team.leave(teamPk(team), { actor: student(s, 0) }),
		).rejects.toBeInstanceOf(InvalidData);
		expect(folderExists(team)).toBe(true);
	});
});

//
// rotateToken
//

test.describe("rotateToken", () => {
	test("replaces the token of the caller only", async () => {
		const s = await assignmentScenario();
		const team = await createTeam(s, student(s, 0));
		const joined = await join(s, team.joinCode, student(s, 1));

		const rotated = await db.team.rotateToken(teamPk(team), {
			actor: student(s, 0),
		});

		expect(rotated.token).not.toBe(team.token);
		expect(await db.team.findByToken(team.token, s.assignment.slug)).toBeNull();
		const found = await db.team.findByToken(rotated.token, s.assignment.slug);
		expect(found?.member.username).toBe(student(s, 0).username);
		expect(await tokenOf(team, student(s, 1).username)).toBe(joined.token);
		expect(
			(await db.team.findByToken(joined.token, s.assignment.slug))?.member
				.username,
		).toBe(student(s, 1).username);
	});

	test("is refused for a student who is not in the team", async () => {
		const s = await assignmentScenario();
		const team = await createTeam(s, student(s, 0));

		await expect(
			db.team.rotateToken(teamPk(team), { actor: student(s, 1) }),
		).rejects.toBeInstanceOf(NotFound);
		expect(await tokenOf(team, student(s, 0).username)).toBe(team.token);
	});
});

//
// The instructor
//

test.describe("instructor: createFor", () => {
	test("makes a team with no members and its repository", async () => {
		const s = await assignmentScenario();

		const team = await db.team.createFor(
			assignmentPk(s),
			{ name: "Zero", members: [] },
			asInstructor(s),
		);

		expect(team.name).toBe("Zero");
		expect(team.members).toEqual([]);
		expect(folderExists(team)).toBe(true);
		expect(await prisma.team.count({ where: { id: team.id } })).toBe(1);
	});

	test("takes more students than teamMax, after teamsLockAt", async () => {
		const s = await assignmentScenario({
			teamMax: 3,
			students: 5,
			teamsLockAt: hoursFromNow(-1),
		});

		const team = await staffTeam(s, s.students);

		expect(team.members).toHaveLength(5);
		expect(await memberNames(team.id)).toHaveLength(5);
		expect(folderExists(team)).toBe(true);
	});

	test("refuses a student who is already in another team, and creates nothing", async () => {
		const s = await assignmentScenario();
		await createTeam(s, student(s, 0));

		await expect(
			staffTeam(s, [student(s, 1), student(s, 0)]),
		).rejects.toBeInstanceOf(InvalidData);

		expect(
			await prisma.team.count({ where: { assignmentId: s.assignment.id } }),
		).toBe(1);
		expect(
			await prisma.teamMember.count({
				where: {
					assignmentId: s.assignment.id,
					username: student(s, 1).username,
				},
			}),
		).toBe(0);
	});

	test("is refused in an individual assignment", async () => {
		const s = await assignmentScenario({ teamMin: 1, teamMax: 1 });

		await expect(staffTeam(s, [student(s, 0)])).rejects.toBeInstanceOf(
			InvalidData,
		);
	});
});

test.describe("instructor: what a student cannot do", () => {
	test("createFor, addMember, setDueAt and remove are NotAllowed, even for a member", async () => {
		const s = await assignmentScenario();
		const ana = student(s, 0);
		const team = await createTeam(s, ana);
		const as = { actor: ana };

		await expect(
			db.team.createFor(
				assignmentPk(s),
				{ name: "Mine", members: [student(s, 1).username] },
				as,
			),
		).rejects.toBeInstanceOf(NotAllowed);
		await expect(
			db.team.addMember(teamPk(team), student(s, 1).username, as),
		).rejects.toBeInstanceOf(NotAllowed);
		await expect(
			db.team.setDueAt(teamPk(team), hoursFromNow(100), as),
		).rejects.toBeInstanceOf(NotAllowed);
		await expect(db.team.remove(teamPk(team), as)).rejects.toBeInstanceOf(
			NotAllowed,
		);

		expect(await memberNames(team.id)).toEqual([ana.username]);
		expect(folderExists(team)).toBe(true);
	});

	test("rename, removeMember and listWithDeliveries are NotAllowed too", async () => {
		const s = await assignmentScenario();
		const ana = student(s, 0);
		const team = await createTeam(s, ana);
		const as = { actor: ana };

		await expect(
			db.team.rename(teamPk(team), "Other", as),
		).rejects.toBeInstanceOf(NotAllowed);
		await expect(
			db.team.removeMember(teamPk(team), ana.username, as),
		).rejects.toBeInstanceOf(NotAllowed);
		await expect(
			db.team.listWithDeliveries(assignmentPk(s), as),
		).rejects.toBeInstanceOf(NotAllowed);
	});
});

test.describe("instructor: addMember", () => {
	test("moves a student out of their team: new token, pushes stay, the origin's delivery is the same", async () => {
		const s = await assignmentScenario({ dueAt: hoursFromNow(-1) });
		const [ana, bia, caio] = [student(s, 0), student(s, 1), student(s, 2)];
		const origin = await staffTeam(s, [ana, bia]);
		const target = await staffTeam(s, [caio]);
		await seedPushes(origin, [
			{
				sha: fakeSha("1"),
				createdAt: hoursFromNow(-5),
				username: ana.username,
			},
			{
				sha: fakeSha("2"),
				createdAt: hoursFromNow(-3),
				username: bia.username,
			},
		]);
		const oldToken = (await tokenOf(origin, bia.username)) as string;
		const deliveryOf = async () =>
			(await db.team.listWithDeliveries(assignmentPk(s), asInstructor(s))).find(
				(t) => t.id === origin.id,
			)?.delivery;
		const before = await deliveryOf();

		await db.team.addMember(teamPk(target), bia.username, asInstructor(s));

		expect(await memberNames(origin.id)).toEqual([ana.username]);
		expect(await memberNames(target.id)).toEqual(
			[bia.username, caio.username].sort(),
		);
		const newToken = await tokenOf(target, bia.username);
		expect(newToken).not.toBeNull();
		expect(newToken).not.toBe(oldToken);
		expect(await db.team.findByToken(oldToken, s.assignment.slug)).toBeNull();
		expect(
			await prisma.teamPush.count({
				where: { teamId: origin.id, username: bia.username },
			}),
		).toBe(1);
		expect(await prisma.teamPush.count({ where: { teamId: target.id } })).toBe(
			0,
		);
		const after = await deliveryOf();
		expect(after?.onTime?.newSha).toBe(before?.onTime?.newSha);
		expect(after?.onTime?.newSha).toBe(fakeSha("2"));
	});

	test("puts a student with no team into the team, with a token", async () => {
		const s = await assignmentScenario();
		const team = await staffTeam(s, []);

		await db.team.addMember(
			teamPk(team),
			student(s, 0).username,
			asInstructor(s),
		);

		expect(await memberNames(team.id)).toEqual([student(s, 0).username]);
		expect(await tokenOf(team, student(s, 0).username)).not.toBeNull();
	});

	test("refuses a dropped student, a user who is not a student and an individual assignment", async () => {
		const s = await assignmentScenario({ dropped: 1 });
		const team = await staffTeam(s, []);
		const solo = await assignmentScenario({ teamMin: 1, teamMax: 1 });
		const soloTeam = await db.team.create(
			assignmentPk(solo),
			{ name: "x" },
			{ actor: student(solo, 0) },
		);

		await expect(
			db.team.addMember(
				teamPk(team),
				(s.dropped[0] as UserActor).username,
				asInstructor(s),
			),
		).rejects.toBeInstanceOf(InvalidData);
		await expect(
			db.team.addMember(teamPk(team), s.instructor.username, asInstructor(s)),
		).rejects.toBeInstanceOf(InvalidData);
		await expect(
			db.team.addMember(
				teamPk(soloTeam),
				student(solo, 1).username,
				asInstructor(solo),
			),
		).rejects.toBeInstanceOf(InvalidData);
		expect(await memberNames(team.id)).toEqual([]);
		expect(await memberNames(soloTeam.id)).toEqual([student(solo, 0).username]);
	});
});

test.describe("instructor: removeMember, remove, rename", () => {
	test("removing the last member keeps the team, its folder and its pushes", async () => {
		const s = await assignmentScenario();
		const ana = student(s, 0);
		const team = await staffTeam(s, [ana]);
		await seedPushes(team, [
			{ sha: fakeSha("1"), createdAt: new Date(), username: ana.username },
		]);

		await db.team.removeMember(teamPk(team), ana.username, asInstructor(s));

		expect(await memberNames(team.id)).toEqual([]);
		expect(await prisma.team.count({ where: { id: team.id } })).toBe(1);
		expect(await prisma.teamPush.count({ where: { teamId: team.id } })).toBe(1);
		expect(folderExists(team)).toBe(true);
	});

	test("removing a member makes the token useless", async () => {
		const s = await assignmentScenario();
		const team = await createTeam(s, student(s, 0));
		const joined = await join(s, team.joinCode, student(s, 1));

		await db.team.removeMember(
			teamPk(team),
			student(s, 1).username,
			asInstructor(s),
		);

		expect(
			await db.team.findByToken(joined.token, s.assignment.slug),
		).toBeNull();
		expect(await memberNames(team.id)).toEqual([student(s, 0).username]);
	});

	test("remove deletes the rows in cascade and the folder", async () => {
		const s = await assignmentScenario();
		const team = await staffTeam(s, [student(s, 0)]);
		await seedPushes(team, [
			{
				sha: fakeSha("1"),
				createdAt: new Date(),
				username: student(s, 0).username,
			},
		]);

		await db.team.remove(teamPk(team), asInstructor(s));

		expect(await prisma.team.count({ where: { id: team.id } })).toBe(0);
		expect(await prisma.teamMember.count({ where: { teamId: team.id } })).toBe(
			0,
		);
		expect(await prisma.teamPush.count({ where: { teamId: team.id } })).toBe(0);
		expect(folderExists(team)).toBe(false);
	});

	test("rename changes the name, and refuses a name another team has", async () => {
		const s = await assignmentScenario();
		const a = await staffTeam(s, [], "Alpha");
		await staffTeam(s, [], "Beta");

		await db.team.rename(teamPk(a), "Gamma", asInstructor(s));
		await expect(
			db.team.rename(teamPk(a), "Beta", asInstructor(s)),
		).rejects.toBeInstanceOf(InvalidData);

		const row = await prisma.team.findUniqueOrThrow({ where: { id: a.id } });
		expect(row.name).toBe("Gamma");
	});

	test("rename is refused in an individual assignment", async () => {
		const s = await assignmentScenario({ teamMin: 1, teamMax: 1 });
		const team = await createTeam(s, student(s, 0));

		await expect(
			db.team.rename(teamPk(team), "Different", asInstructor(s)),
		).rejects.toBeInstanceOf(InvalidData);
		const row = await prisma.team.findUniqueOrThrow({ where: { id: team.id } });
		expect(row.name).toBe(student(s, 0).username);
	});

	test("removeMember is refused in an individual assignment", async () => {
		const s = await assignmentScenario({ teamMin: 1, teamMax: 1 });
		const team = await createTeam(s, student(s, 0));

		await expect(
			db.team.removeMember(
				teamPk(team),
				student(s, 0).username,
				asInstructor(s),
			),
		).rejects.toBeInstanceOf(InvalidData);
	});

	test("setDueAt reclassifies the delivery, and null goes back to the assignment's date", async () => {
		const due = hoursFromNow(-2);
		const s = await assignmentScenario({
			dueAt: due,
			teamsLockAt: hoursFromNow(-3),
		});
		const team = await staffTeam(s, [student(s, 0)]);
		await seedPushes(team, [
			{
				sha: fakeSha("1"),
				createdAt: hoursFromNow(-1),
				username: student(s, 0).username,
			},
		]);
		const row = async () =>
			(await db.team.listWithDeliveries(assignmentPk(s), asInstructor(s))).find(
				(t) => t.id === team.id,
			);

		const strict = await row();
		const extension = hoursFromNow(5);
		await db.team.setDueAt(teamPk(team), extension, asInstructor(s));
		const extended = await row();
		await db.team.setDueAt(teamPk(team), null, asInstructor(s));
		const back = await row();

		expect(strict?.delivery.onTime).toBeNull();
		expect(strict?.delivery.late?.newSha).toBe(fakeSha("1"));
		expect(strict?.dueAt).toEqual(due);
		expect(extended?.delivery.onTime?.newSha).toBe(fakeSha("1"));
		expect(extended?.delivery.late).toBeNull();
		expect(extended?.dueAt).toEqual(extension);
		expect(back?.delivery.late?.newSha).toBe(fakeSha("1"));
		expect(back?.dueAt).toEqual(due);
	});
});

//
// Enrollment
//

test.describe("a dropped enrollment", () => {
	test("keeps the membership, turns the token off and back on", async () => {
		const s = await assignmentScenario();
		const ana = student(s, 0);
		const team = await createTeam(s, ana);

		await dropStudent(s, ana);
		const dropped = await db.team.findByToken(team.token, s.assignment.slug);
		await reenroll(s, ana);
		const back = await db.team.findByToken(team.token, s.assignment.slug);

		expect(await memberNames(team.id)).toEqual([ana.username]);
		expect(dropped?.enrolled).toBe(false);
		expect(dropped?.team.id).toBe(team.id);
		expect(back?.enrolled).toBe(true);
		expect(back?.team.id).toBe(team.id);
	});
});

//
// findByToken
//

test.describe("findByToken", () => {
	test("resolves the member, the team and the assignment", async () => {
		const s = await assignmentScenario();
		const team = await createTeam(s, student(s, 0));

		const found = await db.team.findByToken(team.token, s.assignment.slug);

		expect(found?.member.username).toBe(student(s, 0).username);
		expect(found?.team.id).toBe(team.id);
		expect(found?.assignment.id).toBe(s.assignment.id);
		expect(found?.enrolled).toBe(true);
	});

	test("is null for the wrong slug, a malformed token and the token of a repository", async () => {
		const s = await assignmentScenario();
		const other = await assignmentScenario();
		const team = await createTeam(s, student(s, 0));
		const repository = await addRepository(s, { "a.txt": "a\n" });
		const repositoryToken = (
			await prisma.repository.findUniqueOrThrow({
				where: { id: repository.id },
				select: { token: true },
			})
		).token;

		expect(
			await db.team.findByToken(team.token, other.assignment.slug),
		).toBeNull();
		expect(
			await db.team.findByToken("not a token!", s.assignment.slug),
		).toBeNull();
		expect(await db.team.findByToken("", s.assignment.slug)).toBeNull();
		expect(
			await db.team.findByToken(repositoryToken, repository.slug),
		).toBeNull();
		expect(
			await db.team.findByToken(repositoryToken, s.assignment.slug),
		).toBeNull();
	});

	test("the same slug in another course does not mix the tokens up", async () => {
		const a = await assignmentScenario();
		const b = await assignmentScenario();
		await db.assignment.upsert(
			{ ...b.input, slug: a.assignment.slug },
			asInstructor(b),
		);
		const teamA = await createTeam(a, student(a, 0));
		const bAssignment = await prisma.assignment.findFirstOrThrow({
			where: { courseId: b.courseId, slug: a.assignment.slug },
		});
		const teamB = await db.team.create(
			{ id: bAssignment.id as never },
			{ name: "B" },
			{ actor: student(b, 0) },
		);

		const foundA = await db.team.findByToken(teamA.token, a.assignment.slug);
		const foundB = await db.team.findByToken(teamB.token, a.assignment.slug);

		expect(foundA?.assignment.id).toBe(a.assignment.id);
		expect(foundB?.assignment.id).toBe(bAssignment.id);
		expect(foundB?.team.id).toBe(teamB.id);
	});
});

//
// Pushes
//

test.describe("recordPush and reconcile", () => {
	const system = { actor: SYSTEM } as const;
	const pushes = (teamId: number) =>
		prisma.teamPush.findMany({ where: { teamId }, orderBy: { id: "asc" } });

	test("records the first push with no oldSha and the next from the one before", async () => {
		const s = await assignmentScenario();
		const team = await createTeam(s, student(s, 0));
		const ana = student(s, 0).username;

		await db.team.recordPush(
			teamPk(team),
			{ username: ana, oldSha: null, newSha: fakeSha("a") },
			system,
		);
		await db.team.recordPush(
			teamPk(team),
			{ username: ana, oldSha: fakeSha("a"), newSha: fakeSha("b") },
			system,
		);

		const rows = await pushes(team.id);
		expect(rows.map((r) => [r.username, r.oldSha, r.newSha])).toEqual([
			[ana, null, fakeSha("a")],
			[ana, fakeSha("a"), fakeSha("b")],
		]);
	});

	test("does nothing when main is the sha of the last recorded push", async () => {
		const s = await assignmentScenario();
		const team = await createTeam(s, student(s, 0));
		const sha = await realPush(team, { "a.txt": "a\n" });
		await db.team.recordPush(
			teamPk(team),
			{ username: student(s, 0).username, oldSha: null, newSha: sha },
			system,
		);

		await db.team.reconcile(teamPk(team), system);

		expect(await pushes(team.id)).toHaveLength(1);
	});

	test("records the push that is missing, with no author and the last sha as oldSha", async () => {
		const s = await assignmentScenario();
		const team = await createTeam(s, student(s, 0));
		const first = await realPush(team, { "a.txt": "a\n" });
		await db.team.recordPush(
			teamPk(team),
			{ username: student(s, 0).username, oldSha: null, newSha: first },
			system,
		);
		const second = await realPush(team, { "b.txt": "b\n" });

		await db.team.reconcile(teamPk(team), system);

		const rows = await pushes(team.id);
		expect(rows).toHaveLength(2);
		expect(rows[1]?.username).toBeNull();
		expect(rows[1]?.oldSha).toBe(first);
		expect(rows[1]?.newSha).toBe(second);
	});

	test("an empty repository with no push has nothing to reconcile", async () => {
		const s = await assignmentScenario();
		const team = await createTeam(s, student(s, 0));

		await db.team.reconcile(teamPk(team), system);

		expect(await pushes(team.id)).toHaveLength(0);
	});

	test("a repository started from the template, with no push, has nothing to reconcile", async () => {
		const s = await assignmentScenario({ template: { "a.txt": "a\n" } });
		const team = await createTeam(s, student(s, 0));

		await db.team.reconcile(teamPk(team), system);

		expect(await pushes(team.id)).toHaveLength(0);
	});

	test("a push on top of the template that was never recorded is found", async () => {
		const s = await assignmentScenario({ template: { "a.txt": "a\n" } });
		const team = await createTeam(s, student(s, 0));
		const sha = await realPush(team, { "b.txt": "b\n" });

		await db.team.reconcile(teamPk(team), system);

		const rows = await pushes(team.id);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.newSha).toBe(sha);
		expect(rows[0]?.username).toBeNull();
	});

	test("two reconciles at once record one push", async () => {
		const s = await assignmentScenario();
		const team = await createTeam(s, student(s, 0));
		await realPush(team, { "a.txt": "a\n" });

		await Promise.all([
			db.team.reconcile(teamPk(team), system),
			db.team.reconcile(teamPk(team), system),
		]);

		expect(await pushes(team.id)).toHaveLength(1);
	});
});

test.describe("missingFiles", () => {
	test("lists the required paths the main branch lacks", async () => {
		const s = await assignmentScenario({
			restrictions: { require: ["a", "dir/b"] },
		});
		const team = await createTeam(s, student(s, 0));

		const empty = await db.team.missingFiles(teamPk(team), asInstructor(s));
		await realPush(team, { a: "1\n" });
		const partial = await db.team.missingFiles(teamPk(team), asInstructor(s));
		await realPush(team, { "dir/b": "2\n" });
		const complete = await db.team.missingFiles(teamPk(team), {
			actor: student(s, 0),
		});

		expect(empty).toEqual(["a", "dir/b"]);
		expect(partial).toEqual(["dir/b"]);
		expect(complete).toEqual([]);
	});

	test("is empty when the assignment requires nothing", async () => {
		const s = await assignmentScenario();
		const team = await createTeam(s, student(s, 0));

		expect(await db.team.missingFiles(teamPk(team), asInstructor(s))).toEqual(
			[],
		);
	});
});

//
// Listings
//

test.describe("summary", () => {
	test("counts teams, students with no team, on-time and late-only deliveries", async () => {
		const s = await assignmentScenario({
			students: 4,
			dropped: 1,
			dueAt: hoursFromNow(-2),
			teamsLockAt: hoursFromNow(-3),
		});
		const [s0, s1, s2] = [student(s, 0), student(s, 1), student(s, 2)];
		const onTime = await staffTeam(s, [s0]);
		const both = await staffTeam(s, [s1]);
		const lateOnly = await staffTeam(s, [s2]);
		await staffTeam(s, []);
		await seedPushes(onTime, [
			{ sha: fakeSha("1"), createdAt: hoursFromNow(-3) },
		]);
		await seedPushes(both, [
			{ sha: fakeSha("2"), createdAt: hoursFromNow(-3) },
			{ sha: fakeSha("3"), createdAt: hoursFromNow(-1) },
		]);
		await seedPushes(lateOnly, [
			{ sha: fakeSha("4"), createdAt: hoursFromNow(-1) },
		]);

		const summary = await db.team.summary(assignmentPk(s), asInstructor(s));

		expect(summary).toEqual({
			teams: 4,
			studentsWithoutTeam: 1,
			onTime: 2,
			lateOnly: 1,
		});
	});

	test("is for the instructor", async () => {
		const s = await assignmentScenario();

		await expect(
			db.team.summary(assignmentPk(s), { actor: student(s, 0) }),
		).rejects.toBeInstanceOf(NotAllowed);
	});
});

test.describe("listWithDeliveries", () => {
	test("marks each team that is outside the size range", async () => {
		const s = await assignmentScenario({
			teamMin: 2,
			teamMax: 3,
			students: 10,
		});
		const sizes = [0, 1, 2, 3, 4];
		let next = 0;
		const bySize = new Map<number, number>();
		for (const size of sizes) {
			const team = await staffTeam(
				s,
				s.students.slice(next, next + size),
				`size-${size}`,
			);
			next += size;
			bySize.set(size, team.id);
		}

		const listing = await db.team.listWithDeliveries(
			assignmentPk(s),
			asInstructor(s),
		);

		const exception = (size: number) =>
			listing.find((t) => t.id === bySize.get(size))?.sizeException;
		expect(exception(0)).toBe("empty");
		expect(exception(1)).toBe("below");
		expect(exception(2)).toBeNull();
		expect(exception(3)).toBeNull();
		expect(exception(4)).toBe("above");
	});

	test("judges each team by its own deadline", async () => {
		const s = await assignmentScenario({
			dueAt: hoursFromNow(-2),
			teamsLockAt: hoursFromNow(-3),
		});
		const plain = await staffTeam(s, [student(s, 0)]);
		const extended = await staffTeam(s, [student(s, 1)]);
		for (const team of [plain, extended]) {
			await seedPushes(team, [
				{ sha: fakeSha("9"), createdAt: hoursFromNow(-1) },
			]);
		}
		await db.team.setDueAt(teamPk(extended), hoursFromNow(3), asInstructor(s));

		const listing = await db.team.listWithDeliveries(
			assignmentPk(s),
			asInstructor(s),
		);

		const get = (id: number) => listing.find((t) => t.id === id);
		expect(get(plain.id)?.delivery.onTime).toBeNull();
		expect(get(plain.id)?.delivery.late).not.toBeNull();
		expect(get(extended.id)?.delivery.onTime).not.toBeNull();
		expect(get(extended.id)?.delivery.late).toBeNull();
	});

	test("never carries a token or a join code, at any depth", async () => {
		const s = await assignmentScenario();
		const team = await createTeam(s, student(s, 0));
		const joined = await join(s, team.joinCode, student(s, 1));
		await seedPushes(team, [
			{
				sha: fakeSha("1"),
				createdAt: new Date(),
				username: student(s, 0).username,
			},
		]);

		const listing = await db.team.listWithDeliveries(
			assignmentPk(s),
			asInstructor(s),
		);

		const keys = keysDeep(listing);
		expect(keys.has("token")).toBe(false);
		expect(keys.has("joinCode")).toBe(false);
		const text = JSON.stringify(listing);
		for (const secret of [team.token, joined.token, team.joinCode as string]) {
			expect(text).not.toContain(secret);
		}
		expect(listing).toHaveLength(1);
		expect(usernames(listing[0]?.members ?? [])).toEqual(
			[student(s, 0).username, student(s, 1).username].sort(),
		);
	});
});

//
// What a student sees
//

test.describe("findMine and visibility", () => {
	test("brings the join code and the reader's own token, and nobody else's", async () => {
		const s = await assignmentScenario();
		const ana = student(s, 0);
		const bia = student(s, 1);
		const team = await createTeam(s, ana);
		const joined = await join(s, team.joinCode, bia);

		const mine = await db.team.findMine(assignmentPk(s), { actor: ana });
		const hers = await db.team.findMine(assignmentPk(s), { actor: bia });

		expect(mine?.id).toBe(team.id);
		expect(mine?.joinCode).toBe(team.joinCode);
		expect(mine?.token).toBe(team.token);
		expect(JSON.stringify(mine)).not.toContain(joined.token);
		expect(keysDeep(mine?.members).has("token")).toBe(false);
		expect(hers?.token).toBe(joined.token);
		expect(JSON.stringify(hers)).not.toContain(team.token);
	});

	test("is null for a student with no team", async () => {
		const s = await assignmentScenario();
		await createTeam(s, student(s, 0));

		expect(
			await db.team.findMine(assignmentPk(s), { actor: student(s, 1) }),
		).toBeNull();
	});

	test("drops the join code after teamsLockAt", async () => {
		const s = await assignmentScenario();
		const team = await createTeam(s, student(s, 0));
		expect(team.joinCode).not.toBeNull();
		await changeAssignment(s, { teamsLockAt: hoursFromNow(-1) });

		const mine = await db.team.findMine(assignmentPk(s), {
			actor: student(s, 0),
		});

		expect(mine?.id).toBe(team.id);
		expect(mine?.joinCode).toBeNull();
		expect(mine?.token).toBe(team.token);
	});

	test("a student outside the team cannot read it", async () => {
		const s = await assignmentScenario();
		const team = await createTeam(s, student(s, 0));

		await expect(
			db.team.missingFiles(teamPk(team), { actor: student(s, 1) }),
		).rejects.toBeInstanceOf(NotFound);
		await expect(
			db.team.missingFiles(teamPk(team), { actor: s.outsider }),
		).rejects.toBeInstanceOf(NotFound);
	});

	test("a team member can read the team's missing files", async () => {
		const s = await assignmentScenario({ restrictions: { require: ["a"] } });
		const team = await createTeam(s, student(s, 0));

		expect(
			await db.team.missingFiles(teamPk(team), { actor: student(s, 0) }),
		).toEqual(["a"]);
	});
});

test.describe("pushCounts", () => {
	const at = (hours: number) => hoursFromNow(hours);

	test("counts the pushes of each team and leaves out a team with none", async () => {
		const s = await assignmentScenario();
		const two = await createTeam(s, student(s, 0));
		const one = await createTeam(s, student(s, 1));
		const none = await createTeam(s, student(s, 2));
		await seedPushes(two, [
			{ sha: fakeSha("a"), createdAt: at(-2) },
			{ sha: fakeSha("b"), createdAt: at(-1) },
		]);
		await seedPushes(one, [{ sha: fakeSha("c"), createdAt: at(-1) }]);

		const counts = await db.team.pushCounts(assignmentPk(s), asInstructor(s));

		expect(counts).toEqual({ [two.id]: 2, [one.id]: 1 });
		expect(counts[none.id]).toBeUndefined();
	});

	test("does not count the pushes of another assignment", async () => {
		const s = await assignmentScenario();
		const other = await assignmentScenario();
		const elsewhere = await createTeam(other, student(other, 0));
		await seedPushes(elsewhere, [{ sha: fakeSha("a"), createdAt: at(-1) }]);

		expect(await db.team.pushCounts(assignmentPk(s), asInstructor(s))).toEqual(
			{},
		);
	});

	test("is NotAllowed for a student and NotFound for a missing assignment", async () => {
		const s = await assignmentScenario();

		await expect(
			db.team.pushCounts(assignmentPk(s), { actor: student(s, 0) }),
		).rejects.toBeInstanceOf(NotAllowed);
		await expect(
			db.team.pushCounts(
				{ id: (2 ** 40) as typeof s.assignment.id },
				asInstructor(s),
			),
		).rejects.toBeInstanceOf(NotFound);
	});
});
