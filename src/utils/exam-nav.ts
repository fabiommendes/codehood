/**
 * The course card links of the pages of an exam. Every page of the exam
 * passes the same value; `markCourseNav` finds where the reader is.
 */

import { m } from "@/i18n";
import type { CourseNav, NavEntry, NavLink } from "./course-nav";

export interface ExamNavInput {
	/// URL of the exam page, `<course>/exams/<slug>`.
	href: string;
	title: string;
	/// Sections of the exam page the actor sees, in page order.
	sections: readonly { id: string; label: string }[];
	/// The actor manages the course: grading and regrades join the overview.
	manage: boolean;
	/// Practice exams have no grading nor regrades pages.
	practice?: boolean;
	/// Answers waiting for a grade.
	pending?: number;
	/// Regrade requests still open.
	regrades?: number;
}

/** Builds the course card links for every page of one exam. */
export function examNav(input: ExamNavInput): CourseNav {
	const sections: NavLink[] = input.sections.map((s) => ({
		label: s.label,
		href: `${input.href}#${s.id}`,
	}));
	const entries: NavEntry[] = input.manage
		? [
				{ label: input.title, href: input.href, children: sections },
				...(input.practice
					? []
					: [
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
						]),
			]
		: sections;
	// The manager's first entry already carries the title.
	return {
		context: input.manage ? undefined : input.title,
		sections: [{ entries }],
	};
}
