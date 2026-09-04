/**
 * The course tab strip, as a pure function of the course and the viewing
 * actor — see `dev/specs/to-do/course-navigation.md`. No Astro, no Prisma
 * import, so the visibility rule is unit-testable without a browser or a
 * database (`test/course-tabs.spec.ts`).
 */
import {
	type CourseWithEnrollment,
	canManageEnrollment,
} from "@/auth/permissions";
import type { Actor } from "@/core/actor";
import { type CourseRef, courseHref } from "./course-url";

export type CourseTabKey =
	| "home"
	| "exams"
	| "resources"
	| "schedule"
	| "students"
	| "manage";

export interface CourseTab {
	key: CourseTabKey;
	label: string;
	href: string;
}

/**
 * Everyone gets `home`/`exams`/`resources`/`schedule`, in that order, so
 * "it's the third tab" means the same thing to a student and an instructor
 * looking at the same course. The instructor's two tabs are appended, never
 * interleaved, exactly when {@link canManageEnrollment} is true — the same
 * predicate `loadCourse({ manage: true })` runs on `/manage` and `/roster`,
 * so a visible tab never 403s.
 */
export function courseTabs(
	course: CourseWithEnrollment & CourseRef,
	actor: Actor,
): readonly CourseTab[] {
	const href = courseHref(course);
	const tabs: CourseTab[] = [
		{ key: "home", label: "Home", href },
		{ key: "exams", label: "Exams", href: `${href}/exams` },
		{ key: "resources", label: "Resources", href: `${href}/resources` },
		{ key: "schedule", label: "Schedule", href: `${href}/schedule` },
	];
	if (canManageEnrollment(actor, course)) {
		tabs.push(
			{ key: "students", label: "Students", href: `${href}/roster` },
			{ key: "manage", label: "Manage", href: `${href}/manage` },
		);
	}
	return tabs;
}
