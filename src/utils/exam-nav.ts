/**
 * The course card links of the pages of an exam. Every page of the exam
 * passes the same value; `markCourseNav` finds where the reader is.
 */

import { m } from "@/i18n";
import type { CourseNav, NavEntry } from "./course-nav";

export interface ExamNavInput {
	/// URL of the exam page, `<course>/exams/<slug>`.
	href: string;
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
}

/**
 * Builds the course card links for every page of one exam.
 *
 * The manager gets two sections: the exam itself, then what happens once it
 * is applied (practice exams have only the first). Students get the sections
 * of the exam page.
 */
export function examNav(input: ExamNavInput): CourseNav {
	if (!input.manage) {
		return {
			context: input.title,
			sections: [
				{
					entries: (input.sections ?? []).map((s) => ({
						label: s.label,
						href: `${input.href}#${s.id}`,
					})),
				},
			],
		};
	}
	const exam: NavEntry[] = [
		{ label: m.nav_exam_overview(), href: input.href },
		{
			label: m.exams_detail_questions_heading(),
			href: `${input.href}/questions`,
		},
	];
	if (input.practice)
		return { context: input.title, sections: [{ entries: exam }] };
	const after: NavEntry[] = [
		{
			label: m.exams_exceptions_heading(),
			href: `${input.href}/exceptions`,
		},
		{
			label: m.nav_crumb_grading(),
			href: `${input.href}/grading`,
			meta: input.pending || undefined,
		},
		{
			label: m.grades_regrade_page_title(),
			href: `${input.href}/regrades`,
			meta: input.regrades || undefined,
		},
		{
			label: m.grades_results_title(),
			href: `${input.href}/results`,
			children: [
				{
					label: m.nav_exam_by_student(),
					href: `${input.href}/results#by-student`,
				},
				{
					label: m.nav_exam_by_question(),
					href: `${input.href}/results#by-question`,
				},
			],
		},
	];
	return {
		context: input.title,
		sections: [{ entries: exam }, { entries: after }],
	};
}
