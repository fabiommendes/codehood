/// Fixtures shared by the theme pages of the component catalogue.

/**
 * Returns the current time and helpers that offset it, so a fixture is relative to the moment of the request.
 *
 * @example
 * const { minutes } = clock();
 * minutes(-25); // 25 minutes ago
 */
export function clock() {
	const now = new Date();
	return {
		now,
		seconds: (n: number) => new Date(now.getTime() + n * 1000),
		minutes: (n: number) => new Date(now.getTime() + n * 60_000),
		hours: (n: number) => new Date(now.getTime() + n * 3_600_000),
	};
}

/// The course segments every island takes; none of them is ever sent anywhere.
export const target = { discipline: "algorithms", course: "ada_2026-2" };

/// The segments of an exam of `target`.
export const examTarget = { ...target, exam: "midterm" };

/// The variants of a catalogue entry that is either open or closed.
export const openClosed = [
	{ key: "open", label: "Open" },
	{ key: "closed", label: "Closed" },
];

/// The variants of a catalogue entry that is either filled or empty.
export const someNone = [
	{ key: "some", label: "With rows" },
	{ key: "none", label: "Empty" },
];

/**
 * Picks, for each group of variants, the key the query string asks for, or the first.
 *
 * The group name is the query parameter `VariantPicker` writes.
 */
export function selectVariants<
	G extends Record<string, readonly { key: string }[]>,
>(url: URL, groups: G): Record<keyof G, string> {
	return Object.fromEntries(
		Object.entries(groups).map(([group, variants]) => {
			const asked = url.searchParams.get(group);
			const shown = variants.find((v) => v.key === asked) ?? variants[0];
			return [group, shown?.key ?? ""];
		}),
	) as Record<keyof G, string>;
}

/// What `CourseHeader` reads of a course.
export const headerCourse = {
	discipline: { slug: "algorithms", name: "Algorithms and Data Structures" },
	instructor: { name: "Ada Lovelace", username: "ada" },
	edition: { slug: "2026-2" },
} as never;

const courseHref = "/algorithms/ada_2026-2";

/// The tab strip a student sees on a course page.
export const studentTabs = [
	{ key: "home", label: "Home", href: courseHref },
	{ key: "schedule", label: "Schedule", href: `${courseHref}/schedule` },
	{ key: "resources", label: "Resources", href: `${courseHref}/resources` },
	{ key: "exams", label: "Exams", href: `${courseHref}/exams` },
] as const;

/// The tab strip the course's instructor sees: the student's, plus Students and Questions.
export const instructorTabs = [
	studentTabs[0],
	studentTabs[1],
	{ key: "students", label: "Students", href: `${courseHref}/roster` },
	studentTabs[2],
	studentTabs[3],
	{ key: "questions", label: "Questions", href: `${courseHref}/questions` },
] as const;
