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

//
// A week of a course's schedule, for `ScheduleWeek`. The dates are fixed so a
// meeting that offers a roll call does so whatever day the page is opened.
//

/// A moment of the week of the schedule fixtures, in UTC: Monday 5 October 2026 is day 5.
const at = (day: number, hour: number) =>
	new Date(Date.UTC(2026, 9, day, hour));

/// A meeting as `ScheduleWeek` reads it: only the fields it uses, the rest absent.
function meeting(
	id: number,
	fields: {
		kind?: "REGULAR" | "HOLIDAY" | "CANCELLED";
		title: string;
		description?: string;
		day: number;
		slot: string;
		repositories?: { slug: string; title: string }[];
	},
) {
	const startAt = at(fields.day, 13);
	return {
		kind: "event" as const,
		courseId: 1,
		startAt,
		endAt: at(fields.day, 15),
		event: {
			id,
			kind: fields.kind ?? "REGULAR",
			title: fields.title,
			description: fields.description ?? null,
			startAt,
			week: 5,
			timeSlot: { slug: fields.slot },
			repositories: fields.repositories ?? [],
		},
	};
}

/// An exam as `ScheduleWeek` reads it.
function dated(
	slug: string,
	title: string,
	day: number,
	status: "SCHEDULED" | "DRAFT",
) {
	return {
		kind: "exam" as const,
		courseId: 1,
		startAt: at(day, 13),
		endAt: new Date(at(day, 13).getTime() + 90 * 60_000),
		exam: { slug, title, type: "QUIZ", status, duration: { minutes: 90 } },
	};
}

/// The repositories of the first meeting of `scheduleEntries`.
export const scheduleRowRepositories = [
	{ slug: "graphs", title: "Graph search samples" },
	{ slug: "queues", title: "Queues and stacks" },
	{ slug: "lab-maze", title: "Lab: the maze" },
];

/// A week with a lecture that has resources and repositories, one with a repository only, a cancelled meeting, a quiz, a holiday and a draft exam.
export const scheduleEntries = [
	meeting(1, {
		title: "Lecture 9: Graph search",
		description:
			"Breadth-first and depth-first search, with the **queue** and the **stack** each one needs.",
		day: 5,
		slot: "mon-10",
		repositories: scheduleRowRepositories,
	}),
	meeting(2, {
		title: "Lecture 10: Shortest paths",
		day: 6,
		slot: "tue-10",
		repositories: [{ slug: "dijkstra", title: "Dijkstra, step by step" }],
	}),
	meeting(3, {
		kind: "CANCELLED",
		title: "Lecture 11: Spanning trees",
		description: "The instructor is travelling. Read chapter 23 instead.",
		day: 7,
		slot: "wed-10",
	}),
	dated("quiz-05", "Quiz 5: Graphs", 8, "SCHEDULED"),
	meeting(4, {
		kind: "HOLIDAY",
		title: "Republic Day",
		day: 9,
		slot: "fri-10",
	}),
	dated("quiz-06", "Quiz 6: Trees", 9, "DRAFT"),
] as never[];

/// The resources of the first meeting of `scheduleEntries`, one of each type that has a row.
export const scheduleRowResources = [
	{
		slug: "slides-9",
		title: "Slides of lecture 9",
		data: { type: "FILE", link: "#", mimeType: "application/pdf" },
	},
	{
		slug: "visualgo",
		title: "VisuAlgo: graph traversal",
		data: { type: "LINK", url: "https://visualgo.net/en/dfsbfs" },
	},
	{ slug: "reading-notes", title: "Reading notes", data: { type: "MD" } },
	{ slug: "bfs", title: "BFS in Python", data: { type: "CODE" } },
] as never[];

/// `scheduleRowResources`, keyed by the id of the meeting they belong to.
export const scheduleResources = new Map([[1, scheduleRowResources]]) as never;

/// A course's roll call report: four students over five meetings, one dropped and one enrolled late.
export const attendanceReport = (() => {
	const events = [
		["mon-10", "Lecture 5", 14],
		["mon-10", "Lecture 6", 21],
		["mon-10", "Lecture 7", 28],
		["mon-10", "Lecture 8", 35],
		["mon-10", "Lecture 9", 42],
	].map(([timeSlot, title, offset], index) => ({
		week: index + 1,
		timeSlot: timeSlot as string,
		title: title as string,
		startAt: new Date(Date.UTC(2026, 8, 1 + (offset as number), 13)),
	}));
	const student = (
		username: string,
		name: string,
		marks: ("present" | "absent" | "before-enrollment")[],
		status: "ENROLLED" | "DROPPED" = "ENROLLED",
	) => ({
		username,
		name,
		email: `${username}@example.com`,
		schoolId: null,
		status,
		cells: Object.fromEntries(
			events.map((event, i) => [`${event.week}/${event.timeSlot}`, marks[i]]),
		),
		present: marks.filter((mark) => mark === "present").length,
		total: events.length,
	});
	return {
		events,
		students: [
			student("ana", "Ana Beatriz Souza", [
				"present",
				"present",
				"present",
				"present",
				"present",
			]),
			student("bruno", "Bruno Lima", [
				"present",
				"absent",
				"present",
				"absent",
				"present",
			]),
			student("carla", "Carla Nunes", [
				"before-enrollment",
				"before-enrollment",
				"present",
				"present",
				"absent",
			]),
			student(
				"davi",
				"Davi Rocha",
				["present", "absent", "absent", "absent", "absent"],
				"DROPPED",
			),
		],
	};
})() as never;
