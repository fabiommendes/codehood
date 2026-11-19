import { expect, test } from "@playwright/test";
import {
	ASSIGNMENT_MAX_FILE_BYTES,
	ASSIGNMENT_MAX_REPO_BYTES,
} from "@/core/constants";
import {
	InvalidData,
	NotAllowed,
	NotFound,
	PreconditionFailed,
} from "@/core/error";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { listPaths, readMain } from "@/services/git/bare";
import {
	addRepository,
	assignmentPk,
	assignmentScenario,
	changeAssignment,
	cleanupAssignmentScenarios,
	createTeam,
	daysFromNow,
	folderExists,
	hoursFromNow,
	tag,
	teamPk,
} from "./assignment-scenario";

/// `AssignmentService`: who sees an assignment, upsert, and what removing one
/// does to its teams and their repositories on disk.

test.afterAll(async () => {
	await cleanupAssignmentScenarios();
});

/// What the REST layer turns into a 409.
async function expectConflict(attempt: Promise<unknown>) {
	await expect(attempt).rejects.toMatchObject({ status: 409 });
}

test.describe("who sees an assignment", () => {
	test("a student does not see one that opens in the future, the instructor does", async () => {
		const s = await assignmentScenario({ opensAt: hoursFromNow(5) });
		const [first] = s.students;
		if (!first) throw new Error("the scenario has no student");
		const student = { actor: first };
		const instructor = { actor: s.instructor };

		await expect(
			db.assignment.findOne(assignmentPk(s), student),
		).rejects.toBeInstanceOf(NotFound);
		const listed = await db.assignment.findMany(
			{ course: s.courseId },
			student,
		);
		const seenByInstructor = await db.assignment.findOne(
			assignmentPk(s),
			instructor,
		);
		const listedByInstructor = await db.assignment.findMany(
			{ course: s.courseId },
			instructor,
		);

		expect(listed.map((a) => a.id)).not.toContain(s.assignment.id);
		expect(seenByInstructor.slug).toBe(s.assignment.slug);
		expect(listedByInstructor.map((a) => a.id)).toContain(s.assignment.id);
	});

	test("a student reads one whose opensAt is past or null", async () => {
		const past = await assignmentScenario({ opensAt: hoursFromNow(-5) });
		const open = await assignmentScenario();

		for (const s of [past, open]) {
			const [first] = s.students;
			if (!first) throw new Error("the scenario has no student");
			const student = { actor: first };
			const found = await db.assignment.findOne(assignmentPk(s), student);
			const listed = await db.assignment.findMany(
				{ course: s.courseId },
				student,
			);
			expect(found.slug).toBe(s.assignment.slug);
			expect(listed.map((a) => a.id)).toContain(s.assignment.id);
		}
	});

	test("a student of another course and a dropped student cannot read it", async () => {
		const s = await assignmentScenario({ dropped: 1 });

		for (const actor of [s.outsider, s.dropped[0] as typeof s.outsider]) {
			await expect(
				db.assignment.findOne(assignmentPk(s), { actor }),
			).rejects.toBeInstanceOf(NotFound);
			await expect(
				db.assignment.findMany({ course: s.courseId }, { actor }),
			).rejects.toBeInstanceOf(NotAllowed);
		}
	});

	test("the read model carries the template as a slug", async () => {
		const s = await assignmentScenario({ template: { "a.txt": "a\n" } });

		const found = await db.assignment.findOne(assignmentPk(s), {
			actor: s.instructor,
		});

		expect(found.template).toBe(s.template?.slug);
		expect(found.teamMax).toBe(3);
		expect(found.dueAt).toEqual(s.input.dueAt);
	});
});

test.describe("upsert", () => {
	test("a student cannot upsert or remove", async () => {
		const s = await assignmentScenario();
		const [first] = s.students;
		if (!first) throw new Error("the scenario has no student");
		const student = { actor: first };

		await expect(
			db.assignment.upsert({ ...s.input, title: "Hijacked" }, student),
		).rejects.toBeInstanceOf(NotAllowed);
		await expect(
			db.assignment.upsert({ ...s.input, slug: tag("new") }, student),
		).rejects.toBeInstanceOf(NotAllowed);
		await expect(
			db.assignment.remove(assignmentPk(s), {}, student),
		).rejects.toBeInstanceOf(NotAllowed);

		const found = await db.assignment.findOne(assignmentPk(s), {
			actor: s.instructor,
		});
		expect(found.title).toBe("Project");
	});

	test("twice with the same slug leaves one row, updated", async () => {
		const s = await assignmentScenario();

		const again = await changeAssignment(s, { title: "Renamed", teamMax: 4 });

		expect(again.id).toBe(s.assignment.id);
		expect(again.title).toBe("Renamed");
		expect(again.teamMax).toBe(4);
		expect(
			await prisma.assignment.count({
				where: { courseId: s.courseId, slug: s.input.slug },
			}),
		).toBe(1);
	});

	test("refuses a template that does not exist or belongs to another course", async () => {
		const s = await assignmentScenario();
		const other = await assignmentScenario();
		const foreign = await addRepository(other, { "a.txt": "a\n" });

		await expect(
			changeAssignment(s, { template: tag("ghost") }),
		).rejects.toBeInstanceOf(InvalidData);
		await expect(
			changeAssignment(s, { template: foreign.slug }),
		).rejects.toBeInstanceOf(InvalidData);
		expect(
			(await db.assignment.findOne(assignmentPk(s), { actor: s.instructor }))
				.template,
		).toBeNull();
	});

	test("refuses restrictions above the limits of the instance, accepts the limits themselves", async () => {
		const s = await assignmentScenario();

		await expect(
			changeAssignment(s, {
				restrictions: { maxFileBytes: ASSIGNMENT_MAX_FILE_BYTES + 1 },
			}),
		).rejects.toBeInstanceOf(InvalidData);
		await expect(
			changeAssignment(s, {
				restrictions: { maxRepoBytes: ASSIGNMENT_MAX_REPO_BYTES + 1 },
			}),
		).rejects.toBeInstanceOf(InvalidData);
		const accepted = await changeAssignment(s, {
			restrictions: {
				maxFileBytes: ASSIGNMENT_MAX_FILE_BYTES,
				maxRepoBytes: ASSIGNMENT_MAX_REPO_BYTES,
				deny: ["*.zip"],
			},
		});

		expect(accepted.restrictions?.maxFileBytes).toBe(ASSIGNMENT_MAX_FILE_BYTES);
		expect(accepted.restrictions?.deny).toEqual(["*.zip"]);
	});

	test("stores the checkpoints ordered by date, and an empty list clears them", async () => {
		const s = await assignmentScenario();
		const late = { slug: "typer", title: "Typer", at: daysFromNow(4) };
		const early = { slug: "parser", title: "Parser", at: daysFromNow(2) };

		const stored = await changeAssignment(s, { checkpoints: [late, early] });
		const kept = await changeAssignment(s, { title: "Renamed" });
		const cleared = await changeAssignment(s, { checkpoints: [] });
		const row = await prisma.assignment.findUniqueOrThrow({
			where: { id: s.assignment.id },
		});

		expect(stored.checkpoints).toEqual([early, late]);
		expect(kept.checkpoints).toEqual([early, late]);
		expect(cleared.checkpoints).toEqual([]);
		expect(row.checkpoints).toBeNull();
	});

	test("refuses a checkpoint that breaks a rule against the stored dates", async () => {
		const s = await assignmentScenario({ opensAt: hoursFromNow(-5) });
		const checkpoint = (slug: string, at: Date) => ({ slug, title: slug, at });

		await expect(
			changeAssignment(s, {
				opensAt: undefined,
				checkpoints: [checkpoint("early", hoursFromNow(-6))],
			}),
		).rejects.toBeInstanceOf(InvalidData);
		await expect(
			changeAssignment(s, {
				checkpoints: [checkpoint("late", daysFromNow(8))],
			}),
		).rejects.toBeInstanceOf(InvalidData);
		await expect(
			changeAssignment(s, {
				checkpoints: [
					checkpoint("twice", daysFromNow(1)),
					checkpoint("twice", daysFromNow(2)),
				],
			}),
		).rejects.toBeInstanceOf(InvalidData);
	});

	test("refuses a new deadline that falls at or before a stored checkpoint", async () => {
		const s = await assignmentScenario();
		await changeAssignment(s, {
			checkpoints: [{ slug: "parser", title: "Parser", at: daysFromNow(3) }],
		});

		await expect(
			changeAssignment(s, { dueAt: daysFromNow(2) }),
		).rejects.toBeInstanceOf(InvalidData);
	});

	test("a key about a team in the body never reaches the team", async () => {
		const s = await assignmentScenario();
		const team = await createTeam(s, s.students[0] as never);
		const extended = daysFromNow(30);
		await db.team.setDueAt(teamPk(team), extended, { actor: s.instructor });

		await changeAssignment(s, {
			teams: [{ id: team.id, dueAt: daysFromNow(60) }],
			teamDueAt: daysFromNow(60),
		} as never);

		const row = await prisma.team.findUniqueOrThrow({ where: { id: team.id } });
		expect(row.dueAt).toEqual(extended);
	});
});

test.describe("shrinking the team size", () => {
	test("leaves the existing teams as they are and marks them as an exception", async () => {
		const s = await assignmentScenario({ teamMin: 1, teamMax: 3 });
		const [a, b, c] = s.students as [
			(typeof s.students)[0],
			(typeof s.students)[0],
			(typeof s.students)[0],
		];
		const team = await createTeam(s, a);
		await db.team.join(
			assignmentPk(s),
			{ joinCode: team.joinCode as string },
			{ actor: b },
		);
		await db.team.join(
			assignmentPk(s),
			{ joinCode: team.joinCode as string },
			{ actor: c },
		);

		await changeAssignment(s, { teamMax: 2 });

		const listing = await db.team.listWithDeliveries(assignmentPk(s), {
			actor: s.instructor,
		});
		const row = listing.find((t) => t.id === team.id);
		expect(row?.members).toHaveLength(3);
		expect(row?.sizeException).toBe("above");
		expect(await prisma.teamMember.count({ where: { teamId: team.id } })).toBe(
			3,
		);
	});
});

test.describe("individual and team assignments", () => {
	test("cannot switch from individual to team once there are teams", async () => {
		const s = await assignmentScenario({ teamMin: 1, teamMax: 1 });
		await createTeam(s, s.students[0] as never);

		await expect(changeAssignment(s, { teamMax: 3 })).rejects.toBeInstanceOf(
			InvalidData,
		);
		expect(
			(await db.assignment.findOne(assignmentPk(s), { actor: s.instructor }))
				.teamMax,
		).toBe(1);
	});

	test("cannot switch from team to individual once there are teams", async () => {
		const s = await assignmentScenario({ teamMin: 1, teamMax: 3 });
		await createTeam(s, s.students[0] as never);

		await expect(changeAssignment(s, { teamMax: 1 })).rejects.toBeInstanceOf(
			InvalidData,
		);
	});

	test("can switch while there are no teams, and resize a team assignment freely", async () => {
		const s = await assignmentScenario({ teamMin: 1, teamMax: 3 });

		const individual = await changeAssignment(s, { teamMax: 1 });
		const grouped = await changeAssignment(s, { teamMin: 2, teamMax: 5 });

		expect(individual.teamMax).toBe(1);
		expect(grouped.teamMax).toBe(5);
		await createTeam(s, s.students[0] as never);
		const resized = await changeAssignment(s, { teamMax: 4 });
		expect(resized.teamMax).toBe(4);
	});
});

test.describe("the template of existing teams", () => {
	test("changing the template does not touch the repositories already created", async () => {
		const s = await assignmentScenario({ template: { "old.txt": "old\n" } });
		const team = await createTeam(s, s.students[0] as never);
		const before = await readMain(team.id);
		const replacement = await addRepository(s, { "new.txt": "new\n" });

		await changeAssignment(s, { template: replacement.slug });

		expect(before).toBe(s.template?.repository.head);
		expect(await readMain(team.id)).toBe(before);
		expect(await listPaths(team.id, before as string)).toEqual(["old.txt"]);
	});
});

test.describe("remove", () => {
	test("an assignment with no teams goes without force", async () => {
		const s = await assignmentScenario();

		await db.assignment.remove(assignmentPk(s), {}, { actor: s.instructor });

		await expect(
			db.assignment.findOne(assignmentPk(s), { actor: s.instructor }),
		).rejects.toBeInstanceOf(NotFound);
	});

	test("with teams and no force it is a conflict, and nothing is lost", async () => {
		const s = await assignmentScenario();
		const team = await createTeam(s, s.students[0] as never);

		await expectConflict(
			db.assignment.remove(assignmentPk(s), {}, { actor: s.instructor }),
		);
		await expectConflict(
			db.assignment.remove(
				assignmentPk(s),
				{ force: false },
				{ actor: s.instructor },
			),
		);

		expect(await prisma.team.count({ where: { id: team.id } })).toBe(1);
		expect(folderExists(team)).toBe(true);
	});

	test("with force the rows and the folders go", async () => {
		const s = await assignmentScenario();
		const a = await createTeam(s, s.students[0] as never);
		const b = await createTeam(s, s.students[1] as never);

		await db.assignment.remove(
			assignmentPk(s),
			{ force: true },
			{ actor: s.instructor },
		);

		expect(
			await prisma.assignment.count({ where: { id: s.assignment.id } }),
		).toBe(0);
		expect(
			await prisma.team.count({ where: { id: { in: [a.id, b.id] } } }),
		).toBe(0);
		expect(
			await prisma.teamMember.count({
				where: { teamId: { in: [a.id, b.id] } },
			}),
		).toBe(0);
		expect(folderExists(a)).toBe(false);
		expect(folderExists(b)).toBe(false);
	});

	test("a removal that fails keeps the folders", async () => {
		const s = await assignmentScenario();
		const team = await createTeam(s, s.students[0] as never);
		const stale = new Date(s.assignment.updatedAt.getTime() - 60_000);

		await expect(
			db.assignment.remove(
				assignmentPk(s),
				{ force: true },
				{ actor: s.instructor, expectedUpdatedAt: stale },
			),
		).rejects.toBeInstanceOf(PreconditionFailed);

		expect(await prisma.team.count({ where: { id: team.id } })).toBe(1);
		expect(folderExists(team)).toBe(true);
	});
});
