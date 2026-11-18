/**
 * The top bar's breadcrumb trail, as a pure function of the URL and the
 * labels of the entities the page already loaded. No Astro, no Prisma import,
 * so it is unit-testable (`test/breadcrumbs.spec.ts`).
 */

import { m } from "@/i18n";
import { ADMIN_TABS } from "./admin-tabs";
import { gradingHref, wantsNames } from "./grading-urls";

/** One step of the trail; every crumb but the last carries a link. */
export interface Crumb {
	label: string;
	href?: string;
	/// Seed of the course tile drawn before `code` (the course root).
	tile?: string;
	/// The discipline code shown beside the tile; `label` stays its accessible name.
	code?: string;
}

/** Labels for the parts of the trail the URL alone cannot spell. */
export interface CrumbLabels {
	/// Present on every course page; marks the URL as a course URL.
	course?: { discipline: { slug: string }; edition: { slug: string } };
	/// Title of the exam, question or resource in `<tab>/<slug>`.
	item?: string;
	/// Title of the question in `exams/<slug>/grading/<question>`.
	question?: string;
	/// Name of the student in `exams/<slug>/attempts/<username>`.
	student?: string;
	/// Title of a page outside courses and admin.
	page?: string;
}

/// Course tab labels by URL segment; shared with the tab strip.
export const COURSE_TAB_LABELS = {
	exams: m.nav_course_tab_exams(),
	resources: m.nav_course_tab_resources(),
	schedule: m.nav_course_tab_schedule(),
	repositories: m.nav_course_tab_repositories(),
	questions: m.nav_course_tab_questions(),
	roster: m.nav_course_tab_students(),
	grades: m.nav_course_tab_grades(),
	reports: m.nav_course_tab_reports(),
	settings: m.nav_course_settings(),
} as const;

/// A step of the trail before links are assigned; `label` is unknown when
/// the page did not load it. `href` overrides `path` as the link target.
interface Step {
	label: string | undefined;
	path: string;
	href?: string;
	tile?: string;
	code?: string;
}

/**
 * Builds the breadcrumb trail for `url`, upward from the current page.
 *
 * Steps whose label cannot be determined are dropped, and the last remaining
 * crumb is never linked. The course root carries the seed of its tile and
 * the discipline code, and is the whole trail of the course home.
 */
export function breadcrumbs(url: URL, labels: CrumbLabels): Crumb[] {
	const segments = url.pathname.split("/").filter(Boolean);
	const steps = labels.course
		? courseSteps(url, segments, labels)
		: segments[0] === "admin"
			? adminSteps(segments)
			: [{ label: labels.page, path: url.pathname }];
	const known = steps.filter(
		(step): step is Step & { label: string } => step.label !== undefined,
	);
	return known.map((step, i) => ({
		label: step.label,
		...(i < known.length - 1 ? { href: step.href ?? step.path } : {}),
		...(step.tile ? { tile: step.tile } : {}),
		...(step.code ? { code: step.code } : {}),
	}));
}

/// Steps of a course URL: course, then tab, then the tab's item.
function courseSteps(
	url: URL,
	segments: string[],
	labels: CrumbLabels,
): Step[] {
	const { discipline, edition } = labels.course ?? {};
	const home = `/${segments.slice(0, 2).join("/")}`;
	const steps: Step[] = [
		{
			label: `${discipline?.slug} \u00b7 ${edition?.slug}`,
			path: home,
			tile: home,
			code: discipline?.slug,
		},
	];
	const tab = segments[2];
	if (tab === undefined) return steps;
	if (!Object.hasOwn(COURSE_TAB_LABELS, tab)) return steps;
	const tabPath = `${home}/${tab}`;
	steps.push({
		label: COURSE_TAB_LABELS[tab as keyof typeof COURSE_TAB_LABELS],
		path: tabPath,
	});
	if (segments[3] !== undefined) {
		const itemPath = `${tabPath}/${segments[3]}`;
		steps.push({ label: labels.item, path: itemPath });
		if (tab === "exams")
			steps.push(...examSteps(url, segments, labels, itemPath));
	}
	return steps;
}

/// Steps below an exam: the grading pages, a student's attempt, or one of the instructor's pages.
function examSteps(
	url: URL,
	segments: string[],
	labels: CrumbLabels,
	examPath: string,
): Step[] {
	const [kind, leaf] = segments.slice(4);
	if (kind === "grading") {
		const path = `${examPath}/grading`;
		const steps: Step[] = [
			{
				label: m.nav_crumb_grading(),
				path,
				href: gradingHref(path, { names: wantsNames(url) }),
			},
		];
		if (leaf !== undefined) {
			steps.push({ label: labels.question, path: `${path}/${leaf}` });
		}
		return steps;
	}
	const pageLabel = {
		preview: m.nav_exam_preview(),
		exceptions: m.exams_exceptions_heading(),
		results: m.grades_results_title(),
		regrades: m.grades_regrade_page_title(),
	}[kind as string];
	if (pageLabel !== undefined && leaf === undefined) {
		return [{ label: pageLabel, path: `${examPath}/${kind}` }];
	}
	if (kind === "attempts" && leaf !== undefined) {
		return [{ label: labels.student, path: `${examPath}/attempts/${leaf}` }];
	}
	return [];
}

/// Steps of an admin URL: the section root, then its tab.
function adminSteps(segments: string[]): Step[] {
	const root = ADMIN_TABS[0];
	const steps: Step[] = [{ label: m.nav_admin(), path: root.href }];
	const tab = ADMIN_TABS.find((t) => t.href === `/admin/${segments[1]}`);
	if (tab) steps.push({ label: tab.label, path: tab.href });
	return steps;
}
