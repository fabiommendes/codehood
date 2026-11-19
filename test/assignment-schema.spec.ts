import { expect, test } from "@playwright/test";
import {
	assignmentRestrictions,
	assignmentUpsert,
} from "@/core/schemas/assignment";
import { teamName } from "@/core/schemas/team";

/// What the input schemas of assignments and teams accept. The limits of the
/// instance are not checked here: `AssignmentService.upsert` holds them.

const DUE = new Date("2030-03-10T12:00:00Z");
const before = (hours: number) => new Date(DUE.getTime() - hours * 3_600_000);
const after = (hours: number) => new Date(DUE.getTime() + hours * 3_600_000);

const valid = {
	course: 1,
	slug: "project-1",
	title: "Project",
	body: "# Project\n",
	dueAt: DUE,
	teamMin: 1,
	teamMax: 3,
};

function accepts(patch: Record<string, unknown>): boolean {
	return assignmentUpsert.safeParse({ ...valid, ...patch }).success;
}

test.describe("assignmentUpsert: team size", () => {
	const cases: [number, number, boolean][] = [
		[0, 1, false],
		[1, 0, false],
		[2, 1, false],
		[3, 2, false],
		[1, 11, false],
		[11, 11, false],
		[1, 1, true],
		[1, 10, true],
		[10, 10, true],
		[2, 5, true],
	];
	for (const [teamMin, teamMax, ok] of cases) {
		test(`teamMin ${teamMin} and teamMax ${teamMax} are ${ok ? "accepted" : "refused"}`, () => {
			expect(accepts({ teamMin, teamMax })).toBe(ok);
		});
	}

	test("a fractional size is refused", () => {
		expect(accepts({ teamMin: 1.5 })).toBe(false);
	});
});

test.describe("assignmentUpsert: dates", () => {
	test("closesAt before dueAt is refused, equal or later is accepted", () => {
		expect(accepts({ closesAt: before(1) })).toBe(false);
		expect(accepts({ closesAt: DUE })).toBe(true);
		expect(accepts({ closesAt: after(1) })).toBe(true);
	});

	test("opensAt after dueAt is refused, equal or earlier is accepted", () => {
		expect(accepts({ opensAt: after(1) })).toBe(false);
		expect(accepts({ opensAt: DUE })).toBe(true);
		expect(accepts({ opensAt: before(1) })).toBe(true);
	});

	test("teamsLockAt after dueAt is refused, equal or earlier is accepted", () => {
		expect(accepts({ teamsLockAt: after(1) })).toBe(false);
		expect(accepts({ teamsLockAt: DUE })).toBe(true);
		expect(accepts({ teamsLockAt: before(1) })).toBe(true);
	});

	test("the optional dates may be null or absent", () => {
		expect(accepts({ opensAt: null, closesAt: null, teamsLockAt: null })).toBe(
			true,
		);
		expect(accepts({})).toBe(true);
	});

	test("dueAt is required", () => {
		const { dueAt: _dueAt, ...withoutDue } = valid;
		expect(assignmentUpsert.safeParse(withoutDue).success).toBe(false);
	});

	test("a date that is a string with an offset is read as the same instant", () => {
		const parsed = assignmentUpsert.parse({
			...valid,
			dueAt: "2030-03-10T12:00:00Z",
		});
		expect(parsed.dueAt).toEqual(DUE);
	});
});

test.describe("assignmentUpsert: identity", () => {
	test("the slug follows the rule of a repository slug", () => {
		expect(accepts({ slug: "Bad Slug" })).toBe(false);
		expect(accepts({ slug: "" })).toBe(false);
		expect(accepts({ slug: "a/b" })).toBe(false);
		expect(accepts({ slug: "lab-2.final" })).toBe(true);
	});

	test("the title may not be empty", () => {
		expect(accepts({ title: "" })).toBe(false);
	});

	test("a template is a slug, or null, or absent", () => {
		expect(accepts({ template: "starter" })).toBe(true);
		expect(accepts({ template: null })).toBe(true);
		expect(accepts({ template: "Not A Slug" })).toBe(false);
	});

	test("the body has no team data: keys that are not the assignment's are dropped", () => {
		const parsed = assignmentUpsert.parse({
			...valid,
			teams: [{ id: 1, dueAt: after(48) }],
			teamDueAt: after(48),
			dueAtByTeam: { 1: after(48) },
		});
		const allowed = [
			"course",
			"slug",
			"title",
			"body",
			"opensAt",
			"dueAt",
			"closesAt",
			"teamMin",
			"teamMax",
			"teamsLockAt",
			"template",
			"restrictions",
			"rev",
		];
		for (const key of Object.keys(parsed)) {
			expect(allowed, `unexpected key ${key}`).toContain(key);
		}
	});
});

test.describe("assignmentRestrictions", () => {
	test("accepts every key, and none", () => {
		expect(assignmentRestrictions.safeParse({}).success).toBe(true);
		expect(
			assignmentRestrictions.safeParse({
				maxRepoBytes: 5_000_000,
				maxFileBytes: 1_000_000,
				deny: ["*.zip", "**/*.exe"],
				require: ["README.md", "src/main.py"],
			}).success,
		).toBe(true);
	});

	test("sizes are positive integers", () => {
		for (const key of ["maxRepoBytes", "maxFileBytes"]) {
			for (const value of [0, -1, 1.5]) {
				expect(
					assignmentRestrictions.safeParse({ [key]: value }).success,
					`${key}: ${value}`,
				).toBe(false);
			}
		}
	});

	test("require refuses paths that are not plain relative repository paths", () => {
		for (const bad of ["../x", "/abs", "a//b", "a/../b", ".git/config", ""]) {
			expect(
				assignmentRestrictions.safeParse({ require: [bad] }).success,
				bad,
			).toBe(false);
		}
		expect(
			assignmentRestrictions.safeParse({ require: ["a", "dir/b"] }).success,
		).toBe(true);
	});

	test("restrictions are checked inside the upsert too", () => {
		expect(accepts({ restrictions: { require: ["../x"] } })).toBe(false);
		expect(accepts({ restrictions: { require: ["a"] } })).toBe(true);
		expect(accepts({ restrictions: null })).toBe(true);
	});
});

test.describe("teamName", () => {
	test("is trimmed", () => {
		expect(teamName.parse("  Alpha  ")).toBe("Alpha");
	});

	test("refuses empty and blank names", () => {
		expect(teamName.safeParse("").success).toBe(false);
		expect(teamName.safeParse("   ").success).toBe(false);
	});

	test("takes up to 60 characters, counted after trimming", () => {
		expect(teamName.safeParse("a".repeat(60)).success).toBe(true);
		expect(teamName.safeParse(`  ${"a".repeat(60)}  `).success).toBe(true);
		expect(teamName.safeParse("a".repeat(61)).success).toBe(false);
	});
});
