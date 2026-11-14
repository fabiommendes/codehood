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
	| "questions"
	| "students";

export interface CourseTab {
	key: CourseTabKey;
	label: string;
	href: string;
}

/**
 * The tabs are Home, Schedule, Students, Resources, Exams and Questions, in
 * that order; Students and Questions only when the actor has
 * `enrollment.manage`, the same predicate `loadCourse({ manage: true })` runs
 * on `/roster` and `/grades`, so a visible tab never 403s.
 *
 * Pages without a tab of their own belong to one and are linked from the
 * course card in the sidebar: grades and attendance to Students,
 * repositories to Resources, reports to Home.
 */
export function courseTabs(
	course: CourseTarget,
	ref: CourseNaturalKey,
	actor: Actor,
): readonly CourseTab[] {
	const href = courseHref(ref);
	const manages = hasPerm(actor, "enrollment.manage", course);
	const tab = (key: CourseTabKey, label: string, path: string): CourseTab => ({
		key,
		label,
		href: `${href}${path}`,
	});
	return [
		tab("home", m.nav_course_tab_home(), ""),
		tab("schedule", COURSE_TAB_LABELS.schedule, "/schedule"),
		...(manages ? [tab("students", COURSE_TAB_LABELS.roster, "/roster")] : []),
		tab("resources", COURSE_TAB_LABELS.resources, "/resources"),
		tab("exams", COURSE_TAB_LABELS.exams, "/exams"),
		...(manages
			? [tab("questions", COURSE_TAB_LABELS.questions, "/questions")]
			: []),
	];
}
