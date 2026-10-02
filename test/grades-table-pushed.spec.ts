import { expect, test } from "@playwright/test";
import { ImproperBehavior } from "@/core/error";
import { courseGradesSchema } from "@/core/schemas";
import type { Enrollment } from "@/db/services/enrollment.service";
import type { GradeColumn } from "@/db/services/grade-column.service";
import {
	courseGradesReport,
	formatGradeValue,
	type GradeCell,
	type GradesTable,
	gradesCsvRows,
	pushedGrades,
} from "@/services/grades-table";

const WHEN = new Date("2026-03-10T10:00:00Z");

/// A table literal: one column per slug, one row per `[username, name, cells]`.
function tableOf(
	exams: { slug: string; title?: string; scheduledAt?: Date | null }[],
	rows: [string, string, GradeCell[], boolean?][],
): GradesTable {
	return {
		columns: exams.map((e) => ({
			exam: {
				slug: e.slug,
				title: e.title ?? e.slug,
				scheduledAt: e.scheduledAt ?? null,
			},
			mean: null,
			attempted: 0,
			students: rows.length,
		})),
		rows: rows.map(([username, name, cells, dropped]) => ({
			username,
			name,
			dropped: dropped ?? false,
			cells,
		})),
	};
}

function pushed(
	slug: string,
	values: { username: string; value: number | string }[],
	overrides: Partial<GradeColumn> = {},
): GradeColumn {
	return {
		id: 1 as GradeColumn["id"],
		courseId: 1 as GradeColumn["courseId"],
		slug,
		title: slug.toUpperCase(),
		kind: "NUMBER",
		position: 0,
		releasedAt: null,
		rev: null,
		values,
		createdAt: WHEN,
		updatedAt: WHEN,
		...overrides,
	};
}

function enrollment(
	username: string,
	overrides: Partial<Enrollment> = {},
): Enrollment {
	return {
		username,
		name: `Name ${username}`,
		email: `${username}@example.com`,
		githubId: `gh-${username}`,
		schoolId: `sid-${username}`,
		courseId: 1 as Enrollment["courseId"],
		status: "ACTIVE",
		enrolledAt: WHEN,
		...overrides,
	};
}

const total = (value: number): GradeCell => ({ kind: "total", total: value });

const SMALL = tableOf(
	[{ slug: "midterm" }],
	[
		["ana", "Ana", [total(0.875)]],
		["bia", "Bia", [{ kind: "missed" }]],
	],
);

//
// pushedGrades
//

test("pushedGrades: columns are ordered by position then slug, whatever order they come in, and carry slug, title, kind and releasedAt", () => {
	const released = new Date("2026-04-01T00:00:00Z");
	const result = pushedGrades(SMALL, [
		pushed("zeta", [], { position: 1, title: "Zeta" }),
		pushed("omega", [], { position: 5 }),
		pushed("beta", [], {
			position: 1,
			kind: "LABEL",
			title: "Beta",
			releasedAt: released,
		}),
		pushed("alpha", [], { position: 0 }),
	]);

	expect(result.columns.map((c) => c.slug)).toEqual([
		"alpha",
		"beta",
		"zeta",
		"omega",
	]);
	expect(result.columns[1]).toMatchObject({
		slug: "beta",
		title: "Beta",
		kind: "LABEL",
		releasedAt: released,
	});
	expect(result.columns[2]).toMatchObject({
		kind: "NUMBER",
		releasedAt: null,
	});
});

test("pushedGrades: values line up with the table's rows, null where a student has none, whatever the order of the column's values", () => {
	const result = pushedGrades(SMALL, [
		pushed("a", [
			{ username: "bia", value: 2 },
			{ username: "ana", value: 1 },
		]),
		pushed("b", [{ username: "bia", value: 7 }], { position: 1 }),
	]);

	expect(result.values).toEqual([
		[1, null],
		[2, 7],
	]);
});

test("pushedGrades: valued counts the listed students with a value and ignores students the table does not list", () => {
	const result = pushedGrades(SMALL, [
		pushed("a", [
			{ username: "ana", value: 1 },
			{ username: "ghost", value: 2 },
			{ username: "zed", value: 3 },
		]),
		pushed("b", [{ username: "ghost", value: 9 }], { position: 1 }),
	]);

	expect(result.columns.map((c) => c.valued)).toEqual([1, 0]);
	expect(result.values).toEqual([
		[1, null],
		[null, null],
	]);
});

test("pushedGrades: no columns gives one empty list per row", () => {
	expect(pushedGrades(SMALL, [])).toEqual({
		columns: [],
		values: [[], []],
	});
});

test("pushedGrades: no rows gives no values and valued 0 for each column", () => {
	const empty = tableOf([{ slug: "midterm" }], []);

	const result = pushedGrades(empty, [
		pushed("a", [{ username: "ana", value: 1 }]),
		pushed("b", [], { position: 1 }),
	]);

	expect(result.values).toEqual([]);
	expect(result.columns.map((c) => c.valued)).toEqual([0, 0]);
});

//
// formatGradeValue
//

for (const [input, expected] of [
	[87.456, "87.46"],
	[9, "9"],
	[87.5, "87.5"],
	[10.1, "10.1"],
	[-0.004, "0"],
	[0, "0"],
	// biome-ignore lint/suspicious/noApproximativeNumericConstant: a plain negative decimal
	[-3.14159, "-3.14"],
	["MS", "MS"],
	["7.50", "7.50"],
] as const) {
	test(`formatGradeValue: ${JSON.stringify(input)} reads ${JSON.stringify(expected)}`, () => {
		expect(formatGradeValue(input)).toBe(expected);
	});
}

//
// gradesCsvRows
//

test("gradesCsvRows: without pushed columns it writes the exams only", () => {
	expect(gradesCsvRows(SMALL)).toEqual([
		["username", "name", "status", "midterm"],
		["ana", "Ana", "active", 87.5],
		["bia", "Bia", "active", ""],
	]);
});

test("gradesCsvRows: pushed columns follow the exams, headed by slug, numbers raw, labels as text, no value empty", () => {
	const grades = pushedGrades(SMALL, [
		pushed("final", [{ username: "ana", value: "MS" }], {
			kind: "LABEL",
			position: 1,
		}),
		pushed(
			"assignments",
			[
				{ username: "ana", value: 87.456 },
				{ username: "bia", value: 0 },
			],
			{ position: 0 },
		),
	]);

	expect(gradesCsvRows(SMALL, grades)).toEqual([
		["username", "name", "status", "midterm", "assignments", "final"],
		["ana", "Ana", "active", 87.5, 87.456, "MS"],
		["bia", "Bia", "active", "", 0, ""],
	]);
});

//
// courseGradesReport
//

test("courseGradesReport: exams list the table's columns in order", () => {
	const scheduled = new Date("2026-03-01T00:00:00Z");
	const table = tableOf(
		[
			{ slug: "midterm", title: "Midterm", scheduledAt: scheduled },
			{ slug: "final-exam", title: "Final exam", scheduledAt: null },
		],
		[],
	);

	expect(courseGradesReport(table, []).exams).toEqual([
		{ slug: "midterm", title: "Midterm", scheduledAt: scheduled },
		{ slug: "final-exam", title: "Final exam", scheduledAt: null },
	]);
});

test("courseGradesReport: students follow the table's rows, enriched from their enrollment, with one result per exam", () => {
	const table = tableOf(
		[{ slug: "midterm" }, { slug: "final-exam" }],
		[
			["ana", "Ana", [total(0.5), { kind: "missed" }]],
			["bia", "Bia", [{ kind: "pending" }, { kind: "in-progress" }]],
			["dan", "Dan", [{ kind: "empty" }, total(-0.25)], true],
		],
	);
	const enrollments = [
		enrollment("dan", { status: "DROPPED", githubId: null }),
		enrollment("ana", { schoolId: null }),
		enrollment("bia"),
	];

	const report = courseGradesReport(table, enrollments);

	expect(report.students.map((s) => s.username)).toEqual(["ana", "bia", "dan"]);
	expect(report.students[0]).toEqual({
		username: "ana",
		name: "Ana",
		email: "ana@example.com",
		schoolId: null,
		githubId: "gh-ana",
		status: "ACTIVE",
		results: {
			midterm: { kind: "total", total: 0.5 },
			"final-exam": { kind: "missed" },
		},
	});
	expect(report.students[1]?.results).toEqual({
		midterm: { kind: "pending" },
		"final-exam": { kind: "in-progress" },
	});
	expect(report.students[2]).toMatchObject({
		status: "DROPPED",
		githubId: null,
		schoolId: "sid-dan",
		results: {
			midterm: { kind: "empty" },
			"final-exam": { kind: "total", total: -0.25 },
		},
	});
});

test("courseGradesReport: the result parses with courseGradesSchema", () => {
	const report = courseGradesReport(SMALL, [
		enrollment("bia", { schoolId: null }),
		enrollment("ana"),
	]);

	expect(() => courseGradesSchema.parse(report)).not.toThrow();
});

test("courseGradesReport: a row with no matching enrollment throws ImproperBehavior", () => {
	expect(() => courseGradesReport(SMALL, [enrollment("ana")])).toThrow(
		ImproperBehavior,
	);
});
