/**
 * The course card links of the resources, schedule and exams tabs. Each page
 * builds its card from data it already loaded; `markCourseNav` finds where
 * the reader is.
 */

import { m } from "@/i18n";
import type { CourseNav, NavEntry } from "./course-nav";
import { examTypeLabels } from "./exam-display";

/** The id of the section of the resources page that holds one kind of resource. */
export function resourceGroupId(type: string): string {
	return `group-${type.toLowerCase()}`;
}

/** The id of the section of the schedule page that holds one week. */
export function scheduleWeekId(week: number): string {
	return `week-${week}`;
}

/** Links to the resource groups of the resources page, one per group in page order. */
export function resourcesNav(
	href: string,
	groups: readonly {
		type: string;
		label: string;
		resources: readonly unknown[];
	}[],
): CourseNav {
	const base = `${href}/resources`;
	return {
		sections: [
			{
				entries: groups.map((group) => ({
					label: group.label,
					href: `${base}#${resourceGroupId(group.type)}`,
					meta: group.resources.length,
				})),
			},
		],
	};
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
