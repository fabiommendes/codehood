import type { Actor } from "@/auth/actor";
import { hasPerm } from "@/auth/permissions";
import { NotAllowed, NotFound } from "@/core/error";
import type { CourseRef } from "@/core/schemas";
import { db } from "@/db";
import {
	type CourseGradesReport,
	courseGradesReport,
	gradesTable,
} from "@/services/grades-table";

/**
 * Loads a course's exam results for every enrolled student at `now`.
 *
 * One query per kind of data, never one per student or exam.
 *
 * @throws {@link NotFound} If the course does not exist.
 * @throws {@link NotAllowed} If `actor` does not teach the course.
 */
export async function loadCourseGrades(
	course: CourseRef,
	actor: Actor,
	now: Date,
): Promise<CourseGradesReport> {
	const found = await db.course.findOne(
		typeof course === "number" ? { id: course } : course,
		{ actor },
	);
	if (!found) throw new NotFound("course");
	if (!hasPerm(actor, "course.update-contents", found)) {
		throw new NotAllowed("grade-column.read");
	}

	const opts: { actor: Actor } = { actor };
	const [exams, active, dropped, attempts, feedback] = await Promise.all([
		db.exam.findMany({ course: found.id }, opts),
		db.enrollment.findMany({ course: found.id, status: "ACTIVE" }, opts),
		db.enrollment.findMany({ course: found.id, status: "DROPPED" }, opts),
		db.response.findMany({ course: found.id, practice: false }, opts),
		db.feedback.findMany({ course: found.id }, opts),
	]);
	const students = [
		...active.map(({ username, name }) => ({ username, name, dropped: false })),
		...dropped.map(({ username, name }) => ({ username, name, dropped: true })),
	];
	const table = gradesTable(exams, students, attempts, feedback, now, {
		withDropped: true,
	});
	return courseGradesReport(table, [...active, ...dropped]);
}
