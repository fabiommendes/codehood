import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import type { ExceptionTiming } from "@/services/exam-state";

/// The exceptions of one course, by exam slug and then username.
export type CourseExceptions = Map<string, Map<string, ExceptionTiming>>;

/**
 * Loads every exam exception of a course in one query, as the timing each one gives.
 *
 * Reads with full access and keeps only what timing needs, never the
 * instructor's `note`. The caller decides who may see the result: a student's
 * page uses it to find their own entry and to decide whether grades are
 * released, and never sends the others to the client.
 */
export async function loadCourseExceptions(
	course: Parameters<typeof db.examException.findMany>[0]["course"],
): Promise<CourseExceptions> {
	const rows = await db.examException.findMany({ course }, FULL_ACCESS);
	const byExam: CourseExceptions = new Map();
	for (const { exam, username, extraTime, scheduledAt } of rows) {
		const timing = byExam.get(exam) ?? new Map<string, ExceptionTiming>();
		timing.set(username, { extraTime, scheduledAt });
		byExam.set(exam, timing);
	}
	return byExam;
}
