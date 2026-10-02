/**
 * A course's results as one table: every active student against every exam.
 *
 * Pure: the caller fetches the exams, the students, every attempt and every
 * grading pass, and this decides the columns, the rows and what each cell
 * reads at `now`.
 */

import type { z } from "zod";
import { ImproperBehavior } from "@/core/error";
import type { courseGradesSchema } from "@/core/schemas";
import type { Enrollment } from "@/db/services/enrollment.service";
import type { Exam } from "@/db/services/exam.service";
import type { GradeColumn } from "@/db/services/grade-column.service";
import { examPhase } from "./exam-state";
import {
	attemptRows,
	compareStudents,
	type GradedStudent,
	type GradingAttempt,
	type GradingFeedback,
} from "./grading";

/// What one student's cell reads for one exam.
export type GradeCell =
	/// A closed attempt with no answer pending, with its total in `[-1, 1]`.
	| { kind: "total"; total: number }
	/// A closed attempt with some answer waiting for a grade.
	| { kind: "pending" }
	/// An attempt the student can still answer.
	| { kind: "in-progress" }
	/// No attempt, and the exam is closed.
	| { kind: "missed" }
	/// No attempt, and the exam is upcoming or open.
	| { kind: "empty" };

/// One exam of the table.
export interface GradesColumn {
	exam: Pick<Exam, "slug" | "title" | "scheduledAt">;
	/// Mean of the `total` cells of the column, or `null` when it has none.
	mean: number | null;
	/// How many of the listed students have an attempt, whatever its state.
	attempted: number;
	/// How many students the table lists.
	students: number;
}

/// One student of the table.
export interface GradesRow {
	username: string;
	name: string;
	/// Whether the student's enrollment is no longer active.
	dropped: boolean;
	/// One cell per column, in column order.
	cells: GradeCell[];
}

export interface GradesTable {
	columns: GradesColumn[];
	rows: GradesRow[];
}

/// One grade column the instructor pushed, as the table shows it.
export interface PushedColumn {
	slug: string;
	title: string;
	kind: GradeColumn["kind"];
	/// When students started seeing the column, or `null` while it is hidden.
	releasedAt: Date | null;
	/// How many of the listed students have a value in the column.
	valued: number;
}

/// The pushed grade columns of a table, beside its exams.
export interface PushedGrades {
	/// By `position`, ties by slug.
	columns: PushedColumn[];
	/// One list per row of the table, in row order, with one entry per column
	/// that is `null` where the student has no value.
	values: (number | string | null)[][];
}

/// A course's exam results for every enrolled student, as the REST API returns them.
export type CourseGradesReport = z.infer<typeof courseGradesSchema>;

/// An attempt, with the slug of the exam it belongs to.
export type TableAttempt = GradingAttempt & { exam: string };

/// Which students a grades table lists.
export interface GradesTableOptions {
	/// Lists the students who dropped the course along with the active ones.
	withDropped?: boolean;
}

/**
 * Builds the table of a course's results at `now`.
 *
 * Columns are the exams of type `EXAM` and `QUIZ` whose phase is neither
 * `draft` nor `archived`, by scheduled date, unscheduled ones last, ties by
 * title. Rows are the students who are not `dropped`, unless `withDropped`
 * asks for them too, by name without regard to case, ties by username.
 * Attempts of students who are not listed count nowhere.
 *
 * @params attempts Every non-practice attempt of the course.
 * @params feedback Every grading pass of the course, released or not.
 */
export function gradesTable(
	exams: Exam[],
	students: GradedStudent[],
	attempts: TableAttempt[],
	feedback: GradingFeedback[],
	now: Date,
	options: GradesTableOptions = {},
): GradesTable {
	const listed = students
		.filter((student) => options.withDropped || !student.dropped)
		.sort(compareStudents);
	const usernames = new Set(listed.map((student) => student.username));

	const shown = exams
		.filter((exam) => {
			if (exam.type !== "EXAM" && exam.type !== "QUIZ") return false;
			const phase = examPhase(exam, now);
			return phase !== "draft" && phase !== "archived";
		})
		.sort(compareExams);

	const cellsByExam = shown.map((exam) => {
		const rows = attemptRows(
			exam,
			exam.questions.map((question) => question.slug),
			attempts.filter(
				(attempt) =>
					attempt.exam === exam.slug && usernames.has(attempt.author),
			),
			feedback,
			listed,
			now,
		);
		const byAuthor = new Map(rows.map((row) => [row.author, row]));
		const closed = examPhase(exam, now) === "closed";
		return listed.map((student): GradeCell => {
			const row = byAuthor.get(student.username);
			if (!row) return { kind: closed ? "missed" : "empty" };
			if (row.state === "in-progress") return { kind: "in-progress" };
			return row.pending === 0 && row.total !== null
				? { kind: "total", total: row.total }
				: { kind: "pending" };
		});
	});

	const columns = shown.map((exam, index): GradesColumn => {
		const cells = cellsByExam[index] ?? [];
		const totals = cells.flatMap((cell) =>
			cell.kind === "total" ? [cell.total] : [],
		);
		return {
			exam: {
				slug: exam.slug,
				title: exam.title,
				scheduledAt: exam.scheduledAt,
			},
			mean:
				totals.length === 0
					? null
					: totals.reduce((sum, total) => sum + total, 0) / totals.length,
			attempted: cells.filter(
				(cell) => cell.kind !== "missed" && cell.kind !== "empty",
			).length,
			students: listed.length,
		};
	});

	return {
		columns,
		rows: listed.map((student, index) => ({
			username: student.username,
			name: student.name,
			dropped: student.dropped,
			cells: cellsByExam.map((cells) => cells[index] ?? { kind: "empty" }),
		})),
	};
}

/**
 * Lines the pushed grade columns up with the rows of a grades table.
 *
 * Values of students the table does not list count nowhere.
 */
export function pushedGrades(
	table: GradesTable,
	columns: GradeColumn[],
): PushedGrades {
	const sorted = [...columns].sort(
		(a, b) => a.position - b.position || compareText(a.slug, b.slug),
	);
	const byColumn = sorted.map(
		(column) =>
			new Map(column.values.map((entry) => [entry.username, entry.value])),
	);
	return {
		columns: sorted.map((column, index) => ({
			slug: column.slug,
			title: column.title,
			kind: column.kind,
			releasedAt: column.releasedAt,
			valued: table.rows.filter((row) => byColumn[index]?.has(row.username))
				.length,
		})),
		values: table.rows.map((row) =>
			byColumn.map((values) => values.get(row.username) ?? null),
		),
	};
}

/**
 * Writes a pushed value as a cell reads it.
 *
 * A number is rounded to at most two decimals and a label is left as it is.
 *
 * @example
 * formatGradeValue(87.456); // "87.46"
 * formatGradeValue(9);      // "9"
 * formatGradeValue("MS");   // "MS"
 */
export function formatGradeValue(value: number | string): string {
	if (typeof value === "string") return value;
	return String(Math.round(value * 100) / 100 || 0);
}

/**
 * Reports a grades table as the REST API returns it, one result per student and exam.
 *
 * @params table A table built with `withDropped`, so it lists every enrollment.
 * @params enrollments Every enrollment of the course, active and dropped.
 */
export function courseGradesReport(
	table: GradesTable,
	enrollments: Enrollment[],
): CourseGradesReport {
	const byUsername = new Map(
		enrollments.map((enrollment) => [enrollment.username, enrollment]),
	);
	const slugs = table.columns.map((column) => column.exam.slug);
	return {
		exams: table.columns.map(({ exam }) => ({
			slug: exam.slug,
			title: exam.title,
			scheduledAt: exam.scheduledAt,
		})),
		students: table.rows.map((row) => {
			const enrollment = byUsername.get(row.username);
			if (!enrollment) {
				throw new ImproperBehavior(
					`The grades table lists "${row.username}", who has no enrollment.`,
				);
			}
			return {
				username: row.username,
				name: row.name,
				email: enrollment.email,
				schoolId: enrollment.schoolId,
				githubId: enrollment.githubId,
				status: enrollment.status,
				results: Object.fromEntries(
					slugs.map((slug, index) => [
						slug,
						row.cells[index] ?? { kind: "empty" },
					]),
				),
			};
		}),
	};
}

/**
 * Writes a grades table as the rows of a CSV file, header first.
 *
 * Each exam is a column headed by its slug. A total is a number from -100 to
 * 100 with at most two decimals, and a cell with no total is empty, so every
 * exam column stays numeric. The pushed columns follow the exams, each headed
 * by its slug, with a value written as pushed and no value as an empty cell.
 */
export function gradesCsvRows(
	table: GradesTable,
	pushed?: PushedGrades,
): (string | number)[][] {
	return [
		[
			"username",
			"name",
			"status",
			...table.columns.map((column) => column.exam.slug),
			...(pushed?.columns.map((column) => column.slug) ?? []),
		],
		...table.rows.map((row, index) => [
			row.username,
			row.name,
			row.dropped ? "dropped" : "active",
			...row.cells.map((cell) =>
				cell.kind === "total" ? Math.round(cell.total * 10000) / 100 : "",
			),
			...(pushed?.values[index]?.map((value) => value ?? "") ?? []),
		]),
	];
}

/// Orders exams by scheduled date, unscheduled ones last, ties by title.
function compareExams(a: Exam, b: Exam): number {
	if (a.scheduledAt && b.scheduledAt) {
		const diff = a.scheduledAt.getTime() - b.scheduledAt.getTime();
		if (diff !== 0) return diff;
	} else if (a.scheduledAt || b.scheduledAt) {
		return a.scheduledAt ? -1 : 1;
	}
	return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

/// Orders text by code unit, so the order never depends on the locale.
function compareText(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
