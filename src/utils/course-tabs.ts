/**
 * The course tab strip, as a pure function of the course and the viewing
 * actor. No Astro, no Prisma import, so the visibility rule is unit-testable
 * without a browser or a database (`test/course-tabs.spec.ts`).
 */

import type { Actor } from "@/auth/actor";
import { type CourseTarget, hasPerm } from "@/auth/permissions";
import { m } from "@/i18n";
import { type CourseNaturalKey, courseHref } from "@/urls";
import { COURSE_TAB_LABELS } from "./breadcrumbs";

export type CourseTabKey =
	| "home"
	| "exams"
	| "resources"
	| "schedule"
	| "repositories"
	| "questions"
	| "students"
	| "grades"
	| "reports";

export interface CourseTab {
	key: CourseTabKey;
	label: string;
	href: string;
}

/**
 * Everyone gets `home`/`exams`/`resources`/`schedule`, in that order, so
 * "it's the third tab" means the same thing to a student and an instructor
 * looking at the same course. `repositories` follows them when `hasRepositories`
 * (the actor can see at least one repository of the course). The instructor's three tabs (`questions`, `students`, `grades`) are appended, never
 * interleaved, exactly when the actor has `enrollment.manage` — the same
 * predicate `loadCourse({ manage: true })` runs on `/roster` and `/grades`,
 * so a visible tab never 403s.
 */
export function courseTabs(
	course: CourseTarget,
	ref: CourseNaturalKey,
	actor: Actor,
	{ hasRepositories = false }: { hasRepositories?: boolean } = {},
): readonly CourseTab[] {
	const href = courseHref(ref);
	const tabs: CourseTab[] = [
		{ key: "home", label: m.nav_course_tab_home(), href },
		{ key: "exams", label: COURSE_TAB_LABELS.exams, href: `${href}/exams` },
		{
			key: "resources",
			label: COURSE_TAB_LABELS.resources,
			href: `${href}/resources`,
		},
		{
			key: "schedule",
			label: COURSE_TAB_LABELS.schedule,
			href: `${href}/schedule`,
		},
	];
	if (hasRepositories) {
		tabs.push({
			key: "repositories",
			label: COURSE_TAB_LABELS.repositories,
			href: `${href}/repositories`,
		});
	}
	if (hasPerm(actor, "enrollment.manage", course)) {
		tabs.push(
			{
				key: "questions",
				label: COURSE_TAB_LABELS.questions,
				href: `${href}/questions`,
			},
			{
				key: "students",
				label: COURSE_TAB_LABELS.roster,
				href: `${href}/roster`,
			},
			{
				key: "grades",
				label: COURSE_TAB_LABELS.grades,
				href: `${href}/grades`,
			},
		);
	}
	return tabs;
}
