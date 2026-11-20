/**
 * The top bar's breadcrumb trail, as a pure function of the URL and the
 * labels of the entities the page already loaded. No Astro, no Prisma import,
 * so it is unit-testable (`test/breadcrumbs.spec.ts`).
 */

import { m } from "@/i18n";
import {
	type CourseUrls,
	type ExamUrls,
	type Href,
	parseCourseSegment,
	urls,
} from "@/urls";
import { ADMIN_TABS } from "./admin-tabs";
import { wantsNames } from "./grading-urls";

/** One step of the trail; every crumb but the last carries a link. */
export interface Crumb {
	label: string;
	href?: Href;
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
/// the page did not load it, and `href` only matters when a crumb follows.
interface Step {
	label: string | undefined;
	href?: Href;
	tile?: string;
	code?: string;
}

/// The course tabs whose items live at `<tab>/<slug>`, and the page of each item.
const ITEM_PAGES = {
	exams: (course: CourseUrls, slug: string) => course.exam(slug).index(),
	questions: (course: CourseUrls, slug: string) => course.question(slug),
	resources: (course: CourseUrls, slug: string) => course.resource(slug),
	repositories: (course: CourseUrls, slug: string) => course.repository(slug),
} as const;

/**
 * Builds the breadcrumb trail for `url`, upward from the current page.
 *
 * Steps whose label cannot be determined are dropped, and the last remaining
 * crumb is never linked. The course root carries the seed of its tile and
 * the discipline code, and is the whole trail of the course home.
 */
export function breadcrumbs(url: URL, labels: CrumbLabels): Crumb[] {
	const segments = url.pathname.split("/").filter(Boolean).map(decodeSegment);
	const steps = labels.course
		? courseSteps(url, segments, labels)
		: segments[0] === "admin"
			? adminSteps(segments)
			: [{ label: labels.page }];
	const known = steps.filter(
		(step): step is Step & { label: string } => step.label !== undefined,
	);
	return known.map((step, i) => ({
		label: step.label,
		...(i < known.length - 1 && step.href ? { href: step.href } : {}),
		...(step.tile ? { tile: step.tile } : {}),
		...(step.code ? { code: step.code } : {}),
	}));
}

/// `segment` decoded, so the registry can encode it again; as it is when it is not valid percent-encoding.
function decodeSegment(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

/// Steps of a course URL: course, then tab, then the tab's item.
function courseSteps(
	url: URL,
	segments: string[],
	labels: CrumbLabels,
): Step[] {
	const { discipline, edition } = labels.course ?? {};
	const [disciplineSlug = "", segment = "", tab, item] = segments;
	const parsed = parseCourseSegment(segment);
	if (!parsed) return [];
	const course = urls.course({ discipline: disciplineSlug, ...parsed });
	const home = course.index();
	const steps: Step[] = [
		{
			label: `${discipline?.slug} \u00b7 ${edition?.slug}`,
			href: home,
			tile: home,
			code: discipline?.slug,
		},
	];
	if (tab === undefined) return steps;
	if (tab === "assignments") {
		steps.push(
			{ label: COURSE_TAB_LABELS.exams, href: course.exams() },
			{ label: m.assignments_page_title(), href: course.assignments() },
		);
		if (item !== undefined) {
			steps.push({ label: labels.item, href: course.assignment(item) });
		}
		return steps;
	}
	if (!Object.hasOwn(COURSE_TAB_LABELS, tab)) return steps;
	const key = tab as keyof typeof COURSE_TAB_LABELS;
	steps.push({ label: COURSE_TAB_LABELS[key], href: course[key]() });
	if (item !== undefined && Object.hasOwn(ITEM_PAGES, tab)) {
		const itemPage = ITEM_PAGES[tab as keyof typeof ITEM_PAGES];
		steps.push({ label: labels.item, href: itemPage(course, item) });
		if (tab === "exams")
			steps.push(...examSteps(url, segments, labels, course.exam(item)));
	}
	return steps;
}

/// Steps below an exam: the grading pages, a student's attempt, or one of the instructor's pages.
function examSteps(
	url: URL,
	segments: string[],
	labels: CrumbLabels,
	exam: ExamUrls,
): Step[] {
	const [kind, leaf] = segments.slice(4);
	if (kind === "grading") {
		const steps: Step[] = [
			{
				label: m.nav_crumb_grading(),
				href: exam.grading({ names: wantsNames(url) }),
			},
		];
		if (leaf !== undefined) {
			steps.push({
				label: labels.question,
				href: exam.gradingQuestion(leaf),
			});
		}
		return steps;
	}
	const pages = {
		preview: { label: m.nav_exam_preview(), href: exam.preview },
		exceptions: { label: m.exams_exceptions_heading(), href: exam.exceptions },
		results: { label: m.grades_results_title(), href: exam.results },
		regrades: { label: m.grades_regrade_page_title(), href: exam.regrades },
	};
	if (kind !== undefined && Object.hasOwn(pages, kind) && leaf === undefined) {
		const page = pages[kind as keyof typeof pages];
		return [{ label: page.label, href: page.href() }];
	}
	if (kind === "attempts" && leaf !== undefined) {
		return [{ label: labels.student, href: exam.attempt(leaf) }];
	}
	return [];
}

/// Steps of an admin URL: the section root, then its tab.
function adminSteps(segments: string[]): Step[] {
	const root = ADMIN_TABS[0];
	const steps: Step[] = [{ label: m.nav_admin(), href: root.href }];
	const tab = ADMIN_TABS.find(
		(t) => t !== root && t.href === `/${segments.slice(0, 2).join("/")}`,
	);
	if (tab) steps.push({ label: tab.label, href: tab.href });
	return steps;
}
