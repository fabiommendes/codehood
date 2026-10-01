/**
 * Which exams a course's home page previews, and in what order.
 *
 * Pure: the page loads the course's exams and, for an instructor, how many
 * answers each one still has to grade.
 */

import type { Exam } from "@/db";
import { groupExamsForStudent } from "@/db/services/exam.service";
import { examPhase } from "./exam-state";

/// One previewed exam, with the answers still waiting for a grade (0 for a student).
export interface CourseHomeExam {
	exam: Exam;
	pending: number;
}

export interface CourseHomeExams {
	/// "Exams", or "Practice" when only practice exams are left to show.
	title: string;
	exams: CourseHomeExam[];
}

/**
 * Picks the exams a course home page previews at `now`.
 *
 * Open exams come first, then closed exams with answers to grade, then
 * upcoming exams by date. With no such exam, the practice exams stand in.
 * Dated drafts join the upcoming ones only when `withDrafts` is set, which is
 * for whoever teaches the course.
 *
 * @param pending Answers left to grade, by exam slug. Empty for a student.
 */
export function courseHomeExams(
	exams: Exam[],
	pending: ReadonlyMap<string, number>,
	now: Date,
	{ withDrafts = false }: { withDrafts?: boolean } = {},
): CourseHomeExams {
	const groups = groupExamsForStudent(exams, now);
	const group = (key: string) => groups.find((g) => g.key === key)?.exams ?? [];

	const toGrade = group("past").filter(
		(exam) => (pending.get(exam.slug) ?? 0) > 0,
	);
	const drafts = withDrafts
		? exams.filter(
				(exam) =>
					examPhase(exam, now) === "draft" &&
					exam.type !== "PRACTICE" &&
					exam.scheduledAt !== null,
			)
		: [];
	const upcoming = [...group("upcoming"), ...drafts].sort(byDate);

	const current = [...group("open"), ...toGrade, ...upcoming];
	const shown = current.length > 0 ? current : group("practice");
	return {
		title: current.length > 0 ? "Exams" : "Practice",
		exams: shown.map((exam) => ({
			exam,
			pending: pending.get(exam.slug) ?? 0,
		})),
	};
}

/// Orders exams by date, undated last, keeping the input order among equals.
function byDate(a: Exam, b: Exam): number {
	if (a.scheduledAt === null || b.scheduledAt === null) {
		return Number(a.scheduledAt === null) - Number(b.scheduledAt === null);
	}
	return a.scheduledAt.getTime() - b.scheduledAt.getTime();
}
