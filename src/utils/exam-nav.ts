/**
 * The course card links of the pages of an exam. Every page of the exam
 * passes the same value; `markCourseNav` finds where the reader is.
 */

import { m } from "@/i18n";
import { type ExamUrls, withAnchor } from "@/urls";
import type { CourseNav, NavEntry } from "./course-nav";

export interface ExamNavInput {
	/// The pages of the exam.
	exam: ExamUrls;
	title: string;
	/// Sections of the exam page a student sees, in page order.
	sections?: readonly { id: string; label: string }[];
	/// The actor manages the course: the card gets its two sections of links.
	manage: boolean;
	/// Practice exams have no grading nor regrades pages.
	practice?: boolean;
	/// Answers waiting for a grade.
	pending?: number;
	/// Regrade requests still open.
	regrades?: number;
	/// Adjustments still active.
	adjustments?: number;
}

/**
 * Builds the course card links for every page of one exam.
 *
 * The manager gets one list: overview and preview, then exceptions,
 * grading, regrades, adjustments and results (practice exams have only the first two).
 * Students get the sections of the exam page.
 */
export function examNav(input: ExamNavInput): CourseNav {
	const { exam } = input;
	if (!input.manage) {
		return {
			context: input.title,
			sections: [
				{
					entries: (input.sections ?? []).map((s) => ({
						label: s.label,
						href: withAnchor(exam.index(), s.id),
					})),
				},
			],
		};
	}
	const entries: NavEntry[] = [
		{ label: m.nav_exam_overview(), href: exam.index() },
		{
			label: m.nav_exam_preview(),
			href: exam.preview(),
		},
	];
	const results = exam.results();
	/// The prefix of every student's attempt page, which belongs to the results: an empty username drops its segment.
	const attempts = exam.attempt("");
	if (!input.practice)
		entries.push(
			{
				label: m.exams_exceptions_heading(),
				href: exam.exceptions(),
			},
			{
				label: m.nav_crumb_grading(),
				href: exam.grading(),
				meta: input.pending || undefined,
				under: [exam.grading()],
			},
			{
				label: m.grades_regrade_page_title(),
				href: exam.regrades(),
				meta: input.regrades || undefined,
			},
			{
				label: m.grades_adjustment_title(),
				href: exam.adjustments(),
				meta: input.adjustments || undefined,
			},
			{
				label: m.grades_results_title(),
				href: results,
				under: [attempts],
				children: [
					{
						label: m.nav_exam_by_question(),
						href: withAnchor(results, "by-question"),
					},
					{
						label: m.nav_exam_by_student(),
						href: withAnchor(results, "by-student"),
					},
				],
			},
		);
	return { context: input.title, sections: [{ entries }] };
}
