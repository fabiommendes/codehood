/**
 * The course card links of the home, resources, schedule, exams and students tabs. Each page
 * builds its card from data it already loaded; `markCourseNav` finds where
 * the reader is.
 */

import { m } from "@/i18n";
import { type CourseUrls, type Href, withAnchor } from "@/urls";
import type { CourseNav, NavEntry, NavLink, NavSection } from "./course-nav";
import { examTypeLabels } from "./exam-display";

/** The id of the section of the resources page that holds one kind of resource. */
export function resourceGroupId(type: string): string {
	return `group-${type.toLowerCase()}`;
}

/** The id of the section of the schedule page that holds one week. */
export function scheduleWeekId(week: number): string {
	return `week-${week}`;
}

/**
 * Links to the pages of the resources tab: the resources and, when the actor
 * sees any repository, the repositories. The groups of the resources page fold
 * under its entry only when `expand` is set, as the other pages do not show them.
 */
export function resourcesNav(
	course: CourseUrls,
	groups: readonly {
		type: string;
		label: string;
		resources: readonly unknown[];
	}[],
	repositories = 0,
	here: { expand?: boolean; context?: string } = {},
): CourseNav {
	const base = course.resources();
	const entries: NavEntry[] = [
		{
			label: m.nav_course_tab_resources(),
			href: base,
			children: here.expand
				? groups.map((group) => ({
						label: group.label,
						href: withAnchor(base, resourceGroupId(group.type)),
						meta: group.resources.length,
					}))
				: [],
		},
	];
	if (repositories > 0)
		entries.push({
			label: m.nav_course_tab_repositories(),
			href: course.repositories(),
			meta: repositories,
		});
	return { context: here.context, sections: [{ entries }] };
}

/**
 * Links to the weeks of the schedule page. Weeks already over, when the page
 * folds them away, share a "Past weeks" entry that unfolds to list them.
 */
export function scheduleNav(
	course: CourseUrls,
	weeks: {
		past: readonly { week: number }[];
		ahead: readonly { week: number }[];
	},
	foldPast: boolean,
): CourseNav {
	const base = course.schedule();
	const link = ({ week }: { week: number }): NavEntry => ({
		label: m.schedule_week({ week }),
		href: withAnchor(base, scheduleWeekId(week)),
	});
	const entries: NavEntry[] = foldPast
		? [
				{
					label: m.schedule_nav_past_weeks(),
					href: withAnchor(base, "past-weeks"),
					children: weeks.past.map(link),
				},
				...weeks.ahead.map(link),
			]
		: [...weeks.past, ...weeks.ahead].map(link);
	return { sections: [{ entries }] };
}

/** The sections of one home-tab page, as links under its entry. */
export interface HomeSections {
	/// The page that holds the sections.
	page: "home" | "settings";
	sections: readonly { id: string; label: string }[];
}

/**
 * Links to the instructor's pages of the home tab: home, reports and settings.
 * The page the reader is on passes its own `sections`, which fold under its
 * entry; the others show no sections, as they would not be on screen.
 */
export function homeNav(course: CourseUrls, here?: HomeSections): CourseNav {
	const children = (page: HomeSections["page"], base: Href): NavLink[] =>
		here?.page === page
			? here.sections.map(({ id, label }) => ({
					label,
					href: withAnchor(base, id),
				}))
			: [];
	const home = course.index();
	const settings = course.settings();
	return {
		sections: [
			{
				entries: [
					{
						label: m.nav_course_tab_home(),
						href: home,
						children: children("home", home),
					},
					{ label: m.nav_course_tab_reports(), href: course.reports() },
					{
						label: m.nav_course_settings(),
						href: settings,
						children: children("settings", settings),
					},
				],
			},
		],
	};
}

/**
 * Links to the sections of a student's home, the only page of their home tab,
 * so they sit at the first level.
 */
export function studentHomeNav(
	sections: readonly { id: string; label: string }[],
): CourseNav {
	return {
		tab: m.nav_course_tab_home(),
		sections: [
			{
				entries: sections.map(({ id, label }) => ({
					label,
					href: `#${id}`,
				})),
			},
		],
	};
}

/**
 * Links to the pages of the students tab: the roster, the grades and the
 * attendance of the class. Every one of those pages passes the same value.
 */
export function studentsNav(course: CourseUrls): CourseNav {
	return {
		sections: [
			{
				entries: [
					{ label: m.nav_students_roster(), href: course.roster() },
					{ label: m.nav_course_tab_grades(), href: course.grades() },
					{ label: m.attendance_page_heading(), href: course.attendance() },
				],
			},
		],
	};
}

const EXAM_TYPE_ORDER = ["EXAM", "QUIZ", "PRACTICE"] as const;

/// The entry of the assignments list in the card of the exams tab.
function assignmentsEntry(course: CourseUrls, count: number): NavEntry {
	const base = course.assignments();
	return {
		label: m.assignments_nav_label(),
		href: base,
		meta: count,
		under: [base],
	};
}

/**
 * Links to the exams the actor sees, one section per exam type that has at
 * least one of them, and to the assignments when the actor sees any.
 */
export function examsNav(
	course: CourseUrls,
	exams: readonly {
		slug: string;
		title: string;
		type: keyof typeof examTypeLabels;
	}[],
	assignments = 0,
): CourseNav {
	const sections: NavSection[] = EXAM_TYPE_ORDER.flatMap((type) => {
		const ofType = exams.filter((exam) => exam.type === type);
		if (ofType.length === 0) return [];
		return [
			{
				label: examTypeLabels[type],
				entries: ofType.map((exam) => ({
					label: exam.title,
					href: course.exam(exam.slug).index(),
				})),
			},
		];
	});
	if (assignments > 0) {
		sections.push({ entries: [assignmentsEntry(course, assignments)] });
	}
	return { sections };
}

/**
 * Links to the pages of the exams tab an assignment page can show: the exams
 * and the assignments, which hold the page being read.
 */
export function assignmentsNav(
	course: CourseUrls,
	assignments: number,
): CourseNav {
	return {
		sections: [
			{
				entries: [
					{ label: m.nav_course_tab_exams(), href: course.exams() },
					assignmentsEntry(course, assignments),
				],
			},
		],
	};
}
