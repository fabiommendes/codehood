/**
 * The course card links of the home, resources, schedule, exams and students tabs. Each page
 * builds its card from data it already loaded; `markCourseNav` finds where
 * the reader is.
 */

import { m } from "@/i18n";
import type { CourseNav, NavEntry, NavLink } from "./course-nav";
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
	href: string,
	groups: readonly {
		type: string;
		label: string;
		resources: readonly unknown[];
	}[],
	repositories = 0,
	here: { expand?: boolean; context?: string } = {},
): CourseNav {
	const base = `${href}/resources`;
	const entries: NavEntry[] = [
		{
			label: m.nav_course_tab_resources(),
			href: base,
			children: here.expand
				? groups.map((group) => ({
						label: group.label,
						href: `${base}#${resourceGroupId(group.type)}`,
						meta: group.resources.length,
					}))
				: [],
		},
	];
	if (repositories > 0)
		entries.push({
			label: m.nav_course_tab_repositories(),
			href: `${href}/repositories`,
			meta: repositories,
		});
	return { context: here.context, sections: [{ entries }] };
}

/**
 * Links to the weeks of the schedule page. Weeks already over, when the page
 * folds them away, share a "Past weeks" entry that unfolds to list them.
 */
export function scheduleNav(
	href: string,
	weeks: {
		past: readonly { week: number }[];
		ahead: readonly { week: number }[];
	},
	foldPast: boolean,
): CourseNav {
	const base = `${href}/schedule`;
	const link = ({ week }: { week: number }): NavEntry => ({
		label: m.schedule_week({ week }),
		href: `${base}#${scheduleWeekId(week)}`,
	});
	const entries: NavEntry[] = foldPast
		? [
				{
					label: m.schedule_nav_past_weeks(),
					href: `${base}#past-weeks`,
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
export function homeNav(href: string, here?: HomeSections): CourseNav {
	const children = (page: HomeSections["page"], base: string): NavLink[] =>
		here?.page === page
			? here.sections.map(({ id, label }) => ({
					label,
					href: `${base}#${id}`,
				}))
			: [];
	return {
		sections: [
			{
				entries: [
					{
						label: m.nav_course_tab_home(),
						href,
						children: children("home", href),
					},
					{ label: m.nav_course_tab_reports(), href: `${href}/reports` },
					{
						label: m.nav_course_settings(),
						href: `${href}/settings`,
						children: children("settings", `${href}/settings`),
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
export function studentsNav(href: string): CourseNav {
	return {
		sections: [
			{
				entries: [
					{ label: m.nav_students_roster(), href: `${href}/roster` },
					{ label: m.nav_course_tab_grades(), href: `${href}/grades` },
					{ label: m.attendance_page_heading(), href: `${href}/attendance` },
				],
			},
		],
	};
}

const EXAM_TYPE_ORDER = ["EXAM", "QUIZ", "PRACTICE"] as const;

/**
 * Links to the exams the actor sees, one section per exam type that has at
 * least one of them.
 */
export function examsNav(
	href: string,
	exams: readonly {
		slug: string;
		title: string;
		type: keyof typeof examTypeLabels;
	}[],
): CourseNav {
	return {
		sections: EXAM_TYPE_ORDER.flatMap((type) => {
			const ofType = exams.filter((exam) => exam.type === type);
			if (ofType.length === 0) return [];
			return [
				{
					label: examTypeLabels[type],
					entries: ofType.map((exam) => ({
						label: exam.title,
						href: `${href}/exams/${exam.slug}`,
					})),
				},
			];
		}),
	};
}
