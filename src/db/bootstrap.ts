import { FULL_ACCESS } from "@/auth/actor";
import { DEVELOPMENT } from "@/core/constants";
import { type CalendarEvent, type Course, db, type User } from "@/db";
import { prisma } from "@/db/client";
import {
	localDateOf,
	slotInstant,
	toInstant,
	weekdayOf,
} from "@/utils/schedule-time";

const DEV_ADMIN_USERNAME = "admin";
const DEV_ADMIN_EMAIL = "admin@codehood.local";
const DEV_INSTRUCTOR_USERNAME = "instructor";
const DEV_INSTRUCTOR_EMAIL = "instructor@codehood.local";
const DEV_STUDENT_USERNAME = "student";
const DEV_STUDENT_EMAIL = "student@codehood.local";
/// Fixed so the dev student's calendar URL works right after a reset.
const DEV_STUDENT_FEED_TOKEN = "dev-student-calendar";

let devAdminPromise: Promise<void> | null = null;

/**
 * Dev-only convenience: seeds a few default accounts when the database has no users yet.
 *
 * Called from the Prisma seed script (`pnpm run db:seed`) and from the test
 * runner. These accounts use their own username as a password, so the guard
 * below is what keeps them out of a deployed instance.
 */
export function ensureDevAdmin(): Promise<void> {
	if (!DEVELOPMENT) {
		console.log("[seed] ENVIRONMENT is not dev: skipping default accounts.");
		return Promise.resolve();
	}
	devAdminPromise ??= createDevAdminIfMissing();
	return devAdminPromise;
}

async function createDevAdminIfMissing(): Promise<void> {
	if ((await db.user.findMany({ take: 1 }, FULL_ACCESS)).length > 0) {
		console.log("[seed] users already exist, skipping default admin account.");
		return;
	}

	await demoUser({
		email: DEV_ADMIN_EMAIL,
		username: DEV_ADMIN_USERNAME,
		name: "Admin",
		role: "ADMIN",
		password: DEV_ADMIN_USERNAME,
	});
	await demoUser({
		email: DEV_INSTRUCTOR_EMAIL,
		username: DEV_INSTRUCTOR_USERNAME,
		name: "Instructor",
		role: "INSTRUCTOR",
		password: DEV_INSTRUCTOR_USERNAME,
	});
	await demoUser({
		email: DEV_STUDENT_EMAIL,
		username: DEV_STUDENT_USERNAME,
		name: "Student",
		role: "STUDENT",
		password: DEV_STUDENT_USERNAME,
	});
	console.log(
		`[dev] created default accounts: ${DEV_ADMIN_USERNAME}, ${DEV_INSTRUCTOR_USERNAME}, ${DEV_STUDENT_USERNAME} (passwords match usernames)`,
	);
}

let demoCoursesPromise: Promise<void> | null = null;

/**
 * Dev-only convenience: seeds two demo courses (with instructors and enrolled
 * students) when the database has no courses yet. Same guard as
 * {@link ensureDevAdmin} — Playwright specs need a course to open, and
 * `/courses` renders nothing useful on a fresh database otherwise.
 */
export function ensureDemoCourses(): Promise<void> {
	if (!DEVELOPMENT) {
		return Promise.resolve();
	}
	demoCoursesPromise ??= createDemoCoursesIfMissing();
	return demoCoursesPromise;
}

async function createDemoCoursesIfMissing(): Promise<void> {
	const existing = await db.course.findMany({}, FULL_ACCESS);
	if (existing.length > 0) {
		console.log("[seed] courses already exist, skipping demo courses.");
		return;
	}

	const ada = await demoUser({
		email: "ada@codehood.local",
		username: "ada",
		name: "Ada Lovelace",
		role: "INSTRUCTOR",
		password: "ada",
	});
	const alan = await demoUser({
		email: "alan.turing@codehood.local",
		username: "alan",
		name: "Alan Turing",
		role: "INSTRUCTOR",
		password: "alan",
	});
	const hopper = await demoUser({
		email: "hopper@codehood.local",
		username: "hopper",
		name: "Grace Hopper",
		role: "STUDENT",
		password: "hopper",
	});
	const hamilton = await demoUser({
		email: "hamilton@codehood.local",
		username: "hamilton",
		name: "Margaret Hamilton",
		role: "STUDENT",
		password: "hamilton",
	});
	const liskov = await demoUser({
		email: "liskov@codehood.local",
		username: "liskov",
		name: "Barbara Liskov",
		role: "STUDENT",
		password: "liskov",
	});
	const bob = await demoUser({
		email: "bob@codehood.local",
		username: "bob",
		name: "Bob Martin",
		role: "STUDENT",
		password: "bob",
	});
	const dijkstra = await demoUser({
		email: "dijkstra@codehood.local",
		username: "dijkstra",
		name: "Edsger Dijkstra",
		role: "STUDENT",
		password: "dijkstra",
	});
	const wirth = await demoUser({
		email: "wirth@codehood.local",
		username: "wirth",
		name: "Niklaus Wirth",
		role: "STUDENT",
		password: "wirth",
	});
	const cohort: User[] = [];
	for (const [username, name] of [
		["knuth", "Donald Knuth"],
		["ritchie", "Dennis Ritchie"],
		["thompson", "Ken Thompson"],
		["backus", "John Backus"],
	] as const) {
		cohort.push(
			await demoUser({
				email: `${username}@codehood.local`,
				username,
				name,
				role: "STUDENT",
				password: username,
			}),
		);
	}

	for (const discipline of [
		{ slug: "cs101", name: "Introduction to Programming" },
		{ slug: "cs201", name: "Data Structures" },
	]) {
		await db.discipline.create(discipline, FULL_ACCESS);
	}

	// Every date is derived from the seed time, so the dev database always has
	// a past (expired) edition and a live one holding today, whenever it is
	// seeded. Terms follow the slug rule: 1 for January to June, 2 for July to
	// December, taken from the edition's start date.
	const now = new Date();
	const liveStart = mondayOfWeek(now, -6);
	const liveEnd = mondayOfWeek(now, 10);
	const pastEnd = new Date(now);
	pastEnd.setMonth(pastEnd.getMonth() - 5);
	const pastStart = new Date(pastEnd);
	pastStart.setMonth(pastStart.getMonth() - 4);

	const live = {
		slug: editionSlugOf(liveStart),
		name: editionNameOf(liveStart),
		startAt: liveStart,
		endAt: liveEnd,
	};
	const past = {
		slug: editionSlugOf(pastStart),
		name: editionNameOf(pastStart),
		startAt: pastStart,
		endAt: pastEnd,
	};
	if (live.slug === past.slug) {
		throw new Error(
			`[seed] past and live editions share the slug ${live.slug}`,
		);
	}
	for (const edition of [past, live]) {
		await db.edition.create(edition, FULL_ACCESS);
	}

	const cs101 = await db.course.create(
		{
			discipline: "cs101",
			instructor: ada.username,
			edition: live.slug,
			description:
				"A first course in programming: variables, control flow, functions, and enough data structures to get dangerous.",
			startAt: live.startAt,
			endAt: live.endAt,
		},
		FULL_ACCESS,
	);
	const cs201 = await db.course.create(
		{
			discipline: "cs201",
			instructor: alan.username,
			edition: live.slug,
			description:
				"Arrays, linked lists, trees, and graphs, with an eye toward complexity.",
			startAt: live.startAt,
			endAt: live.endAt,
		},
		FULL_ACCESS,
	);

	for (const student of [hopper, hamilton, liskov, bob, ...cohort]) {
		await db.enrollment.create(
			{ course: cs101.id, username: student.username },
			FULL_ACCESS,
		);
	}

	// A student who dropped: absent from the grades table, present in its CSV.
	await db.enrollment.create(
		{ course: cs101.id, username: dijkstra.username },
		FULL_ACCESS,
	);
	await db.enrollment.delete(
		{ course: cs101.id, username: dijkstra.username },
		FULL_ACCESS,
	);

	for (const student of [liskov, bob]) {
		await db.enrollment.create(
			{ course: cs201.id, username: student.username },
			FULL_ACCESS,
		);
	}

	// The default dev student takes cs101 and has a calendar feed; the dev
	// instructor has none, which is the profile's "no feed" state.
	await db.enrollment.create(
		{ course: cs101.id, username: DEV_STUDENT_USERNAME },
		FULL_ACCESS,
	);
	await prisma.calendarFeed.create({
		data: { username: DEV_STUDENT_USERNAME, token: DEV_STUDENT_FEED_TOKEN },
	});

	// One resource of each type, so /resources has something real to show.
	const syllabusFileBuffer = Buffer.from(
		"CS101 Syllabus\n\nGrading: 40% exams, 30% homework, 30% participation.\nOffice hours: Tuesdays 2-4pm.\n",
	);
	await db.resource.create(
		{
			course: cs101.id,
			slug: "syllabus",
			title: "Syllabus",
			description: "Grading, schedule, and course policy.",
			data: {
				type: "FILE",
				buffer: syllabusFileBuffer,
				filename: "syllabus.txt",
			},
			rev: "syllabus-hash",
		},
		FULL_ACCESS,
	);
	await db.resource.create(
		{
			course: cs101.id,
			slug: "sicp-ch1",
			title: "SICP, chapter 1",
			data: {
				type: "LINK",
				url: "https://mitp-content-server.mit.edu/books/content/sectbyfn/books_pres_0/6515/sicp.zip/full-text/book/book-Z-H-10.html",
			},
			rev: "demo-sicp-v1",
		},
		FULL_ACCESS,
	);
	await db.resource.create(
		{
			course: cs101.id,
			slug: "toolchain",
			title: "Setting up your toolchain",
			description: "Local dev environment, in three steps.",
			data: {
				type: "MD",
				content:
					"Install Node 22 and `pnpm`, then run `pnpm dev`.\n\n- Clone the course repository\n- Run `pnpm install`\n- Ask on the forum if anything fails",
			},
			rev: "demo-toolchain-v1",
		},
		FULL_ACCESS,
	);
	await db.resource.create(
		{
			course: cs101.id,
			slug: "factorial",
			title: "factorial.py",
			data: {
				type: "CODE",
				language: "python",
				content:
					"def factorial(n):\n    return 1 if n <= 1 else n * factorial(n - 1)\n",
			},
			rev: "demo-factorial-v1",
		},
		FULL_ACCESS,
	);

	// cs201 gets its own small set, themed for data structures rather than a
	// copy of cs101's — an empty second course would leave /admin/courses
	// looking like resources only ever land on the first one seeded.
	const bigOFile = Buffer.from(
		"CS201 Cheat Sheet\n\nArray: O(1) index, O(n) insert/delete.\nLinked list: O(n) index, O(1) insert/delete at a known node.\nBalanced tree: O(log n) search/insert/delete.\nHash table: O(1) average, O(n) worst case.\n",
	);
	await db.resource.create(
		{
			course: cs201.id,
			slug: "complexity-cheat-sheet",
			title: "Complexity cheat sheet",
			description: "Time complexity for the structures covered this term.",
			data: {
				type: "FILE",
				buffer: bigOFile,
				filename: "complexity-cheat-sheet.txt",
			},
			rev: "demo-cheatsheet-v1",
		},
		FULL_ACCESS,
	);
	await db.resource.create(
		{
			course: cs201.id,
			slug: "clrs-trees",
			title: "CLRS, chapter 12: Binary search trees",
			data: {
				type: "LINK",
				url: "https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/",
			},
			rev: "demo-clrs-v1",
		},
		FULL_ACCESS,
	);
	await db.resource.create(
		{
			course: cs201.id,
			slug: "when-to-use-what",
			title: "Which structure, when",
			description:
				"A rule of thumb for picking a structure under time pressure.",
			data: {
				type: "MD",
				content:
					"Need order-preserving iteration? Array or linked list.\n\nNeed fast lookup by key? Hash table.\n\nNeed sorted order *and* fast insert? Balanced tree.\n\nWhen in doubt, start with an array. You can always change it once a profiler tells you to.",
			},
			rev: "demo-when-to-use-v1",
		},
		FULL_ACCESS,
	);
	await db.resource.create(
		{
			course: cs201.id,
			slug: "linked-list-node",
			title: "linked_list.py",
			data: {
				type: "CODE",
				language: "python",
				content:
					"class Node:\n    def __init__(self, value, next=None):\n        self.value = value\n        self.next = next\n",
			},
			rev: "demo-linkedlist-v1",
		},
		FULL_ACCESS,
	);

	// A weekly pattern plus a few weeks of the term calendar for each course, so
	// /calendar, /<course>/schedule, and the course home page all have real
	// data to render. cs101 gets a holiday and a cancelled lab so the muted/
	// struck-through rendering has something to show, and descriptions from
	// none to a full lesson plan, so the schedule shows how they sit together.
	const cs101Mon = await db.timeSlot.create(
		{
			course: cs101.id,
			slug: "mon",
			title: "Lecture",
			day: "MONDAY",
			start: { hour: 14, minute: 0 },
			duration: { hours: 2 },
		},
		FULL_ACCESS,
	);
	const cs101Wed = await db.timeSlot.create(
		{
			course: cs101.id,
			slug: "wed",
			title: "Lab",
			day: "WEDNESDAY",
			start: { hour: 14, minute: 0 },
			duration: { hours: 2 },
		},
		FULL_ACCESS,
	);
	for (const event of [
		{
			slug: "w01-mon",
			slot: cs101Mon,
			week: 1,
			kind: "REGULAR" as const,
			title: "Course overview and tooling",
			description: [
				"How the term works and the tools we use all semester.",
				"",
				"- Course policies: grading, late work, collaboration",
				"- The weekly rhythm: lecture on Monday, lab on Wednesday",
				"- Tour of the editor, the terminal and `codehood`",
				"- Where to ask for help: office hours and the forum",
				"",
				"Before Wednesday, read [the setup guide](https://docs.python.org/3/using/index.html)",
				"and bring a laptop.",
			].join("\n"),
		},
		{
			slug: "w01-wed",
			slot: cs101Wed,
			week: 1,
			kind: "REGULAR" as const,
			title: "Environment setup",
			description: "Installing the interpreter and the course CLI.",
		},
		{
			slug: "w02-mon",
			slot: cs101Mon,
			week: 2,
			kind: "REGULAR" as const,
			title: "Variables and control flow",
			description: [
				"- Names, values and types: `int`, `float`, `str`, `bool`",
				"- Comparisons and boolean logic",
				"- `if`, `elif` and `else`",
				"- `while` loops and when they stop",
				"- `for` over a `range`",
			].join("\n"),
		},
		{
			slug: "w02-wed",
			slot: cs101Wed,
			week: 2,
			kind: "REGULAR" as const,
			title: "Practice: control flow",
		},
		{
			slug: "w03-mon",
			slot: cs101Mon,
			week: 3,
			kind: "HOLIDAY" as const,
			title: "University holiday",
			description: "No class (university holiday).",
		},
		{
			slug: "w03-wed",
			slot: cs101Wed,
			week: 3,
			kind: "REGULAR" as const,
			title: "Practice: functions",
			description: "Exercises 3.1 to 3.8 in pairs.",
		},
		{
			slug: "w04-mon",
			slot: cs101Mon,
			week: 4,
			kind: "REGULAR" as const,
			title: "Functions and recursion",
			description: [
				"Functions as the unit of reuse, then functions that call themselves.",
				"",
				"1. Parameters, arguments and return values",
				"2. Local and global scope",
				"3. The call stack, drawn by hand",
				"4. Recursion: base case and recursive step",
				"5. Factorial, Fibonacci and why the naive Fibonacci is slow",
				"",
				"We finish with a live trace of `fib(5)` and count the calls.",
				"Chapter 4 of the notes covers everything here.",
			].join("\n"),
		},
		{
			slug: "w04-wed",
			slot: cs101Wed,
			week: 4,
			kind: "CANCELLED" as const,
			title: "Lab: recursion practice",
			description: "Instructor traveling; make-up session posted online.",
		},
	]) {
		await db.calendarEvent.create(
			{
				course: cs101.id,
				timeSlot: event.slot.id,
				week: event.week,
				kind: event.kind,
				title: event.title,
				description: event.description ?? null,
				rev: `demo-${event.slug}-v1`,
			},
			FULL_ACCESS,
		);
	}

	// A few meetings in the coming weeks, counted from the day the seed runs,
	// so the calendar's upcoming list and "today" always have something near.
	const weeksSoFar = Math.floor(
		(Date.now() - (cs101.startAt?.getTime() ?? Date.now())) /
			(7 * 24 * 3600 * 1000),
	);
	for (const event of [
		{
			slot: cs101Mon,
			week: weeksSoFar + 1,
			title: "Review: recursion",
			description: [
				"- Recursion on lists and strings",
				"- Turning a recursion into a loop",
				"- Common mistakes: a missing base case, a step that never shrinks",
			].join("\n"),
		},
		{
			slot: cs101Wed,
			week: weeksSoFar + 1,
			title: "Project clinic",
			description: "Bring your project questions.",
		},
		{
			slot: cs101Mon,
			week: weeksSoFar + 2,
			title: "Review: data structures",
			description: [
				"Lists, dictionaries and sets side by side, and how to pick one.",
				"",
				"- Lists: order and indexing, `append` versus `insert`",
				"- Dictionaries: lookups by key, iterating over `items()`",
				"- Sets: membership tests and removing duplicates",
				"- The cost of each operation, from the complexity cheat sheet",
				"",
				"Solve the [practice set](https://example.com/cs101/ds-practice) before class;",
				"we go over the hardest three together.",
			].join("\n"),
		},
	]) {
		await db.calendarEvent.create(
			{
				course: cs101.id,
				timeSlot: event.slot.id,
				week: event.week,
				title: event.title,
				description: event.description,
				rev: `demo-upcoming-${event.week}-${event.slot.slug}-v1`,
			},
			FULL_ACCESS,
		);
	}

	// A meeting on the day the seed runs, late enough to still be ahead, so
	// the schedule offers to open its roll call.
	const cs101Today = await db.timeSlot.create(
		{
			course: cs101.id,
			slug: "office-hours",
			title: "Office hours",
			day: weekdayOf(new Date()),
			start: { hour: 22, minute: 0 },
			duration: { hours: 1, minutes: 59 },
		},
		FULL_ACCESS,
	);
	const todayWeek = [weeksSoFar - 1, weeksSoFar, weeksSoFar + 1].find(
		(week) =>
			week >= 0 &&
			cs101.startAt &&
			localDateOf(slotInstant(cs101.startAt, cs101Today.day, week, 22 * 60)) ===
				localDateOf(new Date()),
	);
	if (todayWeek !== undefined) {
		await db.calendarEvent.create(
			{
				course: cs101.id,
				timeSlot: cs101Today.id,
				week: todayWeek,
				title: "Office hours",
				rev: "demo-office-hours-v1",
			},
			FULL_ACCESS,
		);
	}

	// Every other week of the term gets a plain lecture and lab, so the schedule
	// has a meeting in each slot from the first week to the last.
	const totalWeeks = Math.round(
		((cs101.endAt?.getTime() ?? 0) - (cs101.startAt?.getTime() ?? 0)) /
			(7 * 24 * 3600 * 1000),
	);
	for (let week = 0; week < totalWeeks; week++) {
		for (const slot of [cs101Mon, cs101Wed]) {
			const taken = await db.calendarEvent.findOne(
				{ course: cs101.id, week, timeSlot: slot.slug },
				FULL_ACCESS,
			);
			if (taken) continue;
			await db.calendarEvent.create(
				{
					course: cs101.id,
					timeSlot: slot.id,
					week,
					title: `${slot.title} ${week + 1}`,
					rev: `demo-w${week}-${slot.slug}-v1`,
				},
				FULL_ACCESS,
			);
		}
	}

	// Material attached to meetings: every type under a past lecture, and a
	// file and a link under one ahead, so the schedule shows both and the
	// Resources tab shows they are kept off it.
	const recursion = { week: 4, timeSlot: cs101Mon.slug };
	const dataStructures = { week: weeksSoFar + 2, timeSlot: cs101Mon.slug };
	for (const resource of [
		{
			slug: "w04-recursion-slides",
			title: "Slides: functions and recursion",
			event: recursion,
			data: {
				type: "FILE" as const,
				buffer: Buffer.from(
					"Functions and recursion\n\n1. Parameters and return values\n2. Scope\n3. The call stack\n4. Recursion\n",
				),
				filename: "recursion-slides.txt",
			},
		},
		{
			slug: "w04-recursion-notes",
			title: "Lecture notes: recursion",
			event: recursion,
			data: {
				type: "MD" as const,
				content: [
					"# Recursion",
					"",
					"A recursive function has a **base case** that answers directly and a",
					"**recursive step** that calls itself on a smaller input.",
					"",
					"Tracing `fib(5)` by hand makes 15 calls; the memoized version makes 9.",
				].join("\n"),
			},
		},
		{
			slug: "w04-fib",
			title: "fib.py",
			event: recursion,
			data: {
				type: "CODE" as const,
				language: "python",
				content: [
					"def fib(n: int) -> int:",
					"    if n < 2:",
					"        return n",
					"    return fib(n - 1) + fib(n - 2)",
				].join("\n"),
			},
		},
		{
			slug: "w04-visualizer",
			title: "Python Tutor: watch the call stack",
			event: recursion,
			data: { type: "LINK" as const, url: "https://pythontutor.com/" },
		},
		{
			slug: "review-ds-cheat-sheet",
			title: "Complexity cheat sheet",
			event: dataStructures,
			data: {
				type: "LINK" as const,
				url: "https://wiki.python.org/moin/TimeComplexity",
			},
		},
		{
			slug: "review-ds-practice",
			title: "Practice set: data structures",
			event: dataStructures,
			data: {
				type: "FILE" as const,
				buffer: Buffer.from(
					"1. Remove duplicates from a list, keeping the order.\n2. Count words with a dictionary.\n3. Intersect two lists with sets.\n",
				),
				filename: "ds-practice.txt",
			},
		},
	]) {
		await db.resource.create(
			{ course: cs101.id, ...resource, rev: `demo-${resource.slug}-v1` },
			FULL_ACCESS,
		);
	}

	const cs201Mon = await db.timeSlot.create(
		{
			course: cs201.id,
			slug: "mon",
			title: "Lecture",
			day: "MONDAY",
			start: { hour: 10, minute: 0 },
			duration: { hours: 1, minutes: 30 },
		},
		FULL_ACCESS,
	);
	for (const event of [
		{
			slug: "w01-mon",
			week: 1,
			kind: "REGULAR" as const,
			title: "Arrays and linked lists",
			description: "Time and space complexity of the basic sequences.",
		},
		{
			slug: "w02-mon",
			week: 2,
			kind: "REGULAR" as const,
			title: "Stacks and queues",
		},
		{
			slug: "w03-mon",
			week: 3,
			kind: "REGULAR" as const,
			title: "Binary search trees",
		},
	]) {
		await db.calendarEvent.create(
			{
				course: cs201.id,
				timeSlot: cs201Mon.id,
				week: event.week,
				kind: event.kind,
				title: event.title,
				description: event.description ?? "",
				rev: `demo-cs201-${event.slug}-v1`,
			},
			FULL_ACCESS,
		);
	}

	// A handful of questions per course, covering several MDQ types and both
	// draft and published status, so /<course>/questions has real data to list.
	await db.question.create(
		{
			course: cs101.id,
			slug: "recursion-basics",
			status: "PUBLISHED",
			version: "v1",
			question: {
				type: "multiple-choice",
				title: "Recursion basics",
				stem: "Which of the following is required for a recursive function to terminate?",
				tags: ["recursion", "functions"],
				choices: [
					{ id: "base-case", text: "A base case", score: 1 },
					{ id: "tail-call", text: "A tail call" },
				],
			},
		},
		FULL_ACCESS,
	);
	await db.question.create(
		{
			course: cs101.id,
			slug: "loop-invariants",
			status: "PUBLISHED",
			version: "v1",
			question: {
				type: "true-false",
				title: "Loop invariants",
				stem: "Judge each statement about loop invariants as true or false.",
				tags: ["loops"],
				choices: [
					{
						id: "hold-before",
						text: "An invariant must hold before the first iteration.",
						correct: true,
					},
					{
						id: "hold-only-after",
						text: "An invariant must hold only after the loop terminates.",
						correct: false,
					},
				],
			},
		},
		FULL_ACCESS,
	);
	await db.question.create(
		{
			course: cs101.id,
			slug: "linked-list-invariants",
			status: "DRAFT",
			version: "v1",
			question: {
				type: "essay",
				title: "Linked list invariants",
				stem: "Describe the invariant your `insert` implementation must preserve, and show where it could break.",
				tags: ["data-structures"],
				input: "text",
			},
		},
		FULL_ACCESS,
	);
	await db.question.create(
		{
			course: cs101.id,
			slug: "factorial-of-five",
			status: "PUBLISHED",
			version: "v1",
			question: {
				type: "numeric",
				title: "Factorial of five",
				stem: "What is 5! (five factorial)?",
				tags: ["recursion"],
				answer: 120,
				domain: "integer",
			},
		},
		FULL_ACCESS,
	);
	await db.question.create(
		{
			course: cs101.id,
			slug: "big-o-warmup",
			status: "DRAFT",
			version: "v1",
			question: {
				type: "multiple-selection",
				title: "Big-O warm-up",
				stem: "Select every statement below that correctly describes O(n log n) growth.",
				tags: ["complexity"],
				choices: [
					{
						id: "merge-sort",
						text: "Merge sort's comparisons grow this way.",
						correct: true,
					},
					{
						id: "linear-search",
						text: "Linear search's comparisons grow this way.",
						correct: false,
					},
				],
			},
		},
		FULL_ACCESS,
	);

	await db.question.create(
		{
			course: cs201.id,
			slug: "bst-lookup",
			status: "PUBLISHED",
			version: "v1",
			question: {
				type: "multiple-choice",
				title: "BST lookup complexity",
				stem: "In a balanced binary search tree, what is the worst-case time complexity of a lookup?",
				tags: ["trees", "complexity"],
				choices: [
					{ id: "log-n", text: "O(log n)", score: 1 },
					{ id: "n", text: "O(n)" },
				],
			},
		},
		FULL_ACCESS,
	);
	await db.question.create(
		{
			course: cs201.id,
			slug: "stack-vs-queue",
			status: "DRAFT",
			version: "v1",
			question: {
				type: "essay",
				title: "Stack vs. queue",
				stem: "Describe a scenario where a queue is the wrong structure and a stack is the right one, or vice versa.",
				tags: ["stacks", "queues"],
				input: "text",
			},
		},
		FULL_ACCESS,
	);

	// Exams in several states, so a course page can show a draft being written,
	// one waiting to start, one running, and one already over.
	await db.exam.create(
		{
			course: cs101.id,
			slug: "quiz-01",
			type: "QUIZ",
			status: "ONGOING",
			title: "Quiz 1: recursion",
			description: "A short warm-up quiz on recursive functions.",
			preamble: "Answer both questions. You may consult the course notes.",
			duration: { minutes: 30 },
			tags: ["recursion"],
			questions: [
				{ slug: "recursion-basics", version: "v1" },
				{ slug: "factorial-of-five", version: "v1" },
			],
		},
		FULL_ACCESS,
	);
	await db.exam.create(
		{
			course: cs101.id,
			slug: "midterm",
			type: "EXAM",
			status: "SCHEDULED",
			title: "Midterm exam",
			description: "Everything from weeks 1 to 7.",
			// A week ahead: a scheduled exam waiting to start.
			scheduledAt: toInstant(
				localDateOf(new Date(Date.now() + 7 * 24 * 3600 * 1000)),
				14 * 60,
			),
			duration: { hours: 2 },
			tags: ["midterm"],
			questions: [
				{ slug: "recursion-basics", version: "v1" },
				{ slug: "loop-invariants", version: "v1" },
				{ slug: "factorial-of-five", version: "v1" },
			],
		},
		FULL_ACCESS,
	);
	await db.exam.update(
		{ course: cs101.id, slug: "midterm" },
		{ extraTime: { minutes: 15 } },
		FULL_ACCESS,
	);
	await db.exam.create(
		{
			course: cs101.id,
			slug: "final",
			type: "EXAM",
			status: "DRAFT",
			title: "Final exam",
			description: "Still being written.",
			// Dated four weeks from the seed, so the instructor's calendar shows
			// a draft coming up, which students never see.
			scheduledAt: toInstant(
				localDateOf(new Date(Date.now() + 28 * 24 * 3600 * 1000)),
				14 * 60,
			),
			duration: { hours: 2 },
			tags: ["final"],
			questions: [{ slug: "big-o-warmup", version: "v1" }],
		},
		FULL_ACCESS,
	);
	await db.exam.create(
		{
			course: cs201.id,
			slug: "practice-trees",
			type: "PRACTICE",
			status: "ONGOING",
			title: "Practice: binary search trees",
			description: "Ungraded practice, open until the end of the term.",
			tags: ["trees", "practice"],
			questions: [{ slug: "bst-lookup", version: "v1" }],
		},
		FULL_ACCESS,
	);

	await seedReleasedQuiz(cs101, { hopper, hamilton });
	await seedGradedExam(cs101.id, ada, { hopper, hamilton, liskov, bob });
	await seedOpenQuiz(cs101.id);
	await seedGradeColumns(cs101.id, { hopper, hamilton, liskov, dijkstra });
	await seedRollCalls(cs101.id, {
		hopper,
		hamilton,
		liskov,
		bob,
		dijkstra,
		wirth,
	});

	// A quiz two weeks from the day the seed runs, so the calendar's upcoming
	// list always has an exam in it.
	await db.exam.create(
		{
			course: cs101.id,
			slug: "quiz-03",
			type: "QUIZ",
			status: "SCHEDULED",
			title: "Quiz 3: data structures",
			description: "Lists, stacks and queues.",
			scheduledAt: toInstant(
				localDateOf(new Date(Date.now() + 14 * 24 * 3600 * 1000)),
				14 * 60,
			),
			duration: { minutes: 30 },
			tags: ["data-structures"],
			questions: [{ slug: "recursion-basics", version: "v1" }],
		},
		FULL_ACCESS,
	);

	await seedExamExceptions(cs101.id, { hamilton, bob, liskov });
	await seedQuestionStatsExam(cs101.id, [
		hopper,
		hamilton,
		...cohort,
		liskov,
		bob,
	]);

	await seedRegradeExam(cs101.id, ada, { hopper, hamilton });

	// An ended course in the past edition, so admin views keep an expired one.
	const ended = await db.course.create(
		{
			discipline: "cs101",
			instructor: ada.username,
			edition: past.slug,
			description: "Last term's run of the course, already over.",
			startAt: past.startAt,
			endAt: past.endAt,
		},
		FULL_ACCESS,
	);
	await db.enrollment.create(
		{ course: ended.id, username: hopper.username },
		FULL_ACCESS,
	);

	console.log(
		`[dev] created demo courses cs101/${ada.username}_${live.slug} and cs201/${alan.username}_${live.slug}, plus the ended cs101/${ada.username}_${past.slug}.`,
	);
}

/// The `YYYY-N` edition slug of the term `start` falls in: 1 up to June, 2 after.
function editionSlugOf(start: Date): string {
	const [year, month] = localDateOf(start).split("-").map(Number) as [
		number,
		number,
	];
	return `${year}-${month <= 6 ? 1 : 2}`;
}

/// The edition display name matching {@link editionSlugOf}.
function editionNameOf(start: Date): string {
	const slug = editionSlugOf(start);
	return `${slug.slice(0, 4)} · ${slug.endsWith("1") ? "first" : "second"} term`;
}

/// Midnight (server time zone) of the Monday `weeks` weeks away from the one of `date`'s week.
function mondayOfWeek(date: Date, weeks: number): Date {
	const [year, month, day] = localDateOf(date).split("-").map(Number) as [
		number,
		number,
		number,
	];
	const sinceMonday =
		(new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
	const monday = new Date(
		Date.UTC(year, month - 1, day - sinceMonday + weeks * 7),
	);
	return toInstant(monday.toISOString().slice(0, 10), 0);
}

/// Roll calls on three past cs101 meetings, covering the attendance states the grid shows.
///
/// Enrollment dates and attendance sources are set directly, because the services
/// only create enrollments at the current time and only record manual entries.
async function seedRollCalls(
	course: Course["id"],
	students: Record<
		"hopper" | "hamilton" | "liskov" | "bob" | "dijkstra" | "wirth",
		User
	>,
): Promise<void> {
	const existing = await db.rollCall.findMany({ course }, FULL_ACCESS);
	if (existing.length > 0) return;

	const DAY_MS = 24 * 3600 * 1000;
	const opening = await eventAt(course, 0, "mon");
	const first = await eventAt(course, 1, "mon");
	const second = await eventAt(course, 2, "mon");
	const third = await eventAt(course, 3, "wed");

	// Enrolled before the course starts, so every meeting counts for them.
	for (const student of [
		students.hopper,
		students.hamilton,
		students.liskov,
		students.dijkstra,
	]) {
		await setEnrollmentDate(
			course,
			student.username,
			new Date(opening.startAt.getTime() - DAY_MS),
		);
	}

	// Bob enrolls through the second meeting's check-in, after the first one.
	await setEnrollmentDate(
		course,
		students.bob.username,
		new Date(second.startAt.getTime() + 60_000),
	);

	// Wirth creates an account and enrolls at the third meeting.
	await db.enrollment.create(
		{ course, username: students.wirth.username },
		FULL_ACCESS,
	);
	await setEnrollmentDate(
		course,
		students.wirth.username,
		new Date(third.startAt.getTime() + 60_000),
	);

	// The first meeting is the only one with a check-in from the dropped student.
	await seedClosedRollCall(first, {
		checks: [
			{ username: "hopper", deviceHash: "device-hopper", minutes: 3 },
			{ username: "hamilton", deviceHash: "device-hamilton", minutes: 4 },
			{ username: "liskov", deviceHash: "device-liskov", minutes: 5 },
			{ username: "dijkstra", deviceHash: "device-dijkstra", minutes: 6 },
		],
	});

	// Two students share a device; bob joins through this check-in.
	await seedClosedRollCall(second, {
		actsAsInvite: true,
		checks: [
			{ username: "hopper", deviceHash: "device-shared", minutes: 2 },
			{ username: "liskov", deviceHash: "device-shared", minutes: 4 },
			{ username: "hamilton", deviceHash: "device-hamilton", minutes: 3 },
			{
				username: "bob",
				deviceHash: "device-bob",
				joined: "ENROLLMENT",
				minutes: 5,
			},
		],
	});

	// Wirth joins through this check-in and gets an account; hamilton's absence is covered by a manual entry.
	await seedClosedRollCall(third, {
		actsAsInvite: true,
		checks: [
			{ username: "hopper", deviceHash: "device-hopper", minutes: 2 },
			{ username: "bob", deviceHash: "device-bob", minutes: 3 },
			{
				username: "wirth",
				deviceHash: "device-wirth",
				joined: "ACCOUNT",
				minutes: 4,
			},
		],
		manual: { username: "hamilton", note: "atestado" },
	});

	// The remaining past meetings that actually took place get a closed roll
	// call with a varying crowd: hopper never misses, the others now and then,
	// and only students already enrolled at the time can check in.
	const special = new Set([first.id, second.id, third.id]);
	const meetings = await db.calendarEvent.findMany({ course }, FULL_ACCESS);
	const enrolledSince: Record<string, Date | undefined> = {
		hopper: opening.startAt,
		hamilton: opening.startAt,
		liskov: opening.startAt,
		bob: second.startAt,
		wirth: third.startAt,
	};
	const ordered = meetings
		.filter(
			(event) =>
				event.kind === "REGULAR" &&
				event.startAt.getTime() < Date.now() &&
				!special.has(event.id),
		)
		.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
	for (const [index, event] of ordered.entries()) {
		const present = Object.entries(enrolledSince).filter(
			([username, since], i) =>
				since !== undefined &&
				since.getTime() < event.startAt.getTime() &&
				(username === "hopper" || (index + i) % 3 !== 0),
		);
		await seedClosedRollCall(event, {
			checks: present.map(([username], i) => ({
				username,
				deviceHash: `device-${username}`,
				minutes: 2 + i,
			})),
		});
	}
}

/// Finds the cs101 event in a week and slot, or fails loudly when the demo calendar lacks it.
async function eventAt(
	course: Course["id"],
	week: number,
	slot: string,
): Promise<CalendarEvent> {
	const event = await db.calendarEvent.findOne(
		{ course, week, timeSlot: slot },
		FULL_ACCESS,
	);
	if (!event) {
		throw new Error(
			`[seed] no event in course ${course}, week ${week}, ${slot}`,
		);
	}
	return event;
}

/// Sets when an enrollment was created, which decides whether a meeting counts as before it.
async function setEnrollmentDate(
	course: Course["id"],
	username: string,
	createdAt: Date,
): Promise<void> {
	await prisma.enrollment.update({
		where: { username_courseId: { username, courseId: course } },
		data: { createdAt },
	});
}

/// Opens a roll call on a past event, then sets its window to close 15 minutes after the meeting starts.
///
/// Check-ins are stored as code-sourced attendances, and an optional manual entry is added through the service.
async function seedClosedRollCall(
	event: CalendarEvent,
	options: {
		actsAsInvite?: boolean;
		checks?: CodeCheck[];
		manual?: { username: string; note: string };
	},
): Promise<void> {
	const { id } = await db.rollCall.create(
		{ event: { id: event.id }, actsAsInvite: options.actsAsInvite ?? false },
		FULL_ACCESS,
	);
	const at = (minutes: number) =>
		new Date(event.startAt.getTime() + minutes * 60_000);

	await prisma.rollCall.update({
		where: { id },
		data: { closesAt: at(15) },
	});
	for (const check of options.checks ?? []) {
		await prisma.attendance.create({
			data: {
				rollCallId: id,
				username: check.username,
				source: "CODE",
				deviceHash: check.deviceHash,
				joined: check.joined ?? null,
				createdAt: at(check.minutes),
			},
		});
	}
	if (options.manual) {
		await db.rollCall.update(
			{ id },
			{
				attendances: {
					[options.manual.username]: { note: options.manual.note },
				},
			},
			FULL_ACCESS,
		);
	}
}

/// A code check-in seeded into a roll call; `minutes` is the offset from the meeting start.
type CodeCheck = {
	username: string;
	deviceHash: string;
	joined?: "ENROLLMENT" | "ACCOUNT";
	minutes: number;
};

/// A released number column and a hidden label column; `bob` has no value in either, and the dropped `dijkstra` only one.
async function seedGradeColumns(
	course: Course["id"],
	students: Record<"hopper" | "hamilton" | "liskov" | "dijkstra", User>,
): Promise<void> {
	await db.gradeColumn.upsert(
		{
			course,
			slug: "assignments",
			title: "Assignments",
			kind: "NUMBER",
			position: 0,
			values: [
				{ username: students.hopper.username, value: 87.456 },
				{ username: students.hamilton.username, value: 92 },
				{ username: students.liskov.username, value: 71.5 },
				{ username: students.dijkstra.username, value: 60 },
			],
		},
		FULL_ACCESS,
	);
	await db.gradeColumn.release({ course, slug: "assignments" }, FULL_ACCESS);
	await db.gradeColumn.upsert(
		{
			course,
			slug: "final",
			title: "Final grade",
			kind: "LABEL",
			position: 1,
			values: [
				{ username: students.hopper.username, value: "MS" },
				{ username: students.hamilton.username, value: "SS" },
				{ username: students.liskov.username, value: "MM" },
			],
		},
		FULL_ACCESS,
	);
}

/// One student's answers to a seeded exam, by question slug.
type SeededAnswers = Record<string, Record<string, unknown>>;

/// Answers `exam` as `student` and closes the attempt; returns each answer's submission id by question slug.
async function answerExam(
	course: Course["id"],
	exam: string,
	student: User,
	answers: SeededAnswers,
): Promise<Record<string, string>> {
	const submissions: Record<string, string> = {};
	for (const [question, payload] of Object.entries(answers)) {
		const response = await db.response.submit(
			{ course, exam, question, payload },
			{ actor: student },
		);
		submissions[question] = response.submissions.at(-1)?.publicId ?? "";
	}
	await db.response.finish({ course, exam }, { actor: student });
	return submissions;
}

/// Grades one submission as the auto-grading bot.
async function botGrade(
	submission: string | undefined,
	score: string,
): Promise<void> {
	await db.feedback.create(
		{
			submission: { publicId: submission ?? "" },
			ref: "auto-1",
			score,
			bot: "auto",
		},
		FULL_ACCESS,
	);
}

/**
 * Closes the first quiz with two students' answers graded, so its results are out.
 *
 * A quiz releases its results as soon as it closes, which gives a student a
 * released score and per-question outcomes to look at. The quiz only takes
 * answers while open, so it gets its date after the answers are in.
 */
async function seedReleasedQuiz(
	cs101: Course,
	students: { hopper: User; hamilton: User },
): Promise<void> {
	const course = cs101.id;
	const exam = "quiz-01";

	const hopper = await answerExam(course, exam, students.hopper, {
		"recursion-basics": { choice: "base-case" },
		"factorial-of-five": { value: 120 },
	});
	await botGrade(hopper["recursion-basics"], "1");
	await botGrade(hopper["factorial-of-five"], "1");

	const hamilton = await answerExam(course, exam, students.hamilton, {
		"recursion-basics": { choice: "base-case" },
		"factorial-of-five": { value: 25 },
	});
	await botGrade(hamilton["recursion-basics"], "1");
	await botGrade(hamilton["factorial-of-five"], "0");

	await db.exam.update(
		{ course, slug: exam },
		{
			status: "COMPLETED",
			// The Monday lecture of the course's fourth week, long over by now.
			scheduledAt: slotInstant(
				cs101.startAt ?? new Date(),
				"MONDAY",
				3,
				14 * 60,
			),
		},
		FULL_ACCESS,
	);
}

/**
 * Seeds an open, timed quiz nobody has started, with one question of each answerable type.
 *
 * It has no date, so each student gets the full duration from the moment
 * they start, and the taking screen, its countdown and autosave can be tried
 * on any day.
 */
async function seedOpenQuiz(course: Course["id"]): Promise<void> {
	await db.question.create(
		{
			course,
			slug: "stack-overflow-name",
			status: "PUBLISHED",
			version: "v1",
			question: {
				type: "short-answer",
				title: "Runaway recursion",
				stem: "What error does a recursion without a base case usually end in?",
				tags: ["recursion"],
				accept: [{ pattern: "stack overflow" }],
				reject: [{ pattern: "*" }],
			},
		},
		FULL_ACCESS,
	);
	await db.question.create(
		{
			course,
			slug: "recursive-sum",
			status: "PUBLISHED",
			version: "v1",
			question: {
				type: "fill-in",
				title: "Recursive sum",
				stem: "A recursive `sum(xs)` returns [^base] for an empty list, and otherwise adds the first element to a call on the [^rest] of the list.",
				tags: ["recursion"],
				blanks: [
					{ id: "base", type: "numeric", answer: 0 },
					{
						id: "rest",
						type: "multiple-choice",
						choices: [
							{ id: "tail", text: "rest", score: 1 },
							{ id: "head", text: "first element" },
						],
					},
				],
			},
		},
		FULL_ACCESS,
	);
	await db.exam.create(
		{
			course,
			slug: "quiz-02",
			type: "QUIZ",
			status: "ONGOING",
			title: "Quiz 2: recursion in practice",
			description: "Recursion on lists and trees, written by hand.",
			preamble: "Answers are saved as you go. Submit when you are done.",
			duration: { minutes: 45 },
			tags: ["recursion"],
			questions: [
				{ slug: "recursion-basics", version: "v1" },
				{ slug: "loop-invariants", version: "v1" },
				{ slug: "factorial-of-five", version: "v1" },
				{ slug: "stack-overflow-name", version: "v1" },
				{ slug: "recursive-sum", version: "v1" },
				{ slug: "explain-recursion", version: "v1" },
			],
		},
		FULL_ACCESS,
	);
}

/**
 * Seeds a closed, unreleased exam with answers in every grading state.
 *
 * Gives the grading queue, the exam's results, the attempt pages and the
 * grades table something to show: answers graded by a bot and by the
 * instructor, pending ones, one marked will-not-grade, and questions left
 * unanswered.
 */
async function seedGradedExam(
	course: Course["id"],
	instructor: User,
	students: { hopper: User; hamilton: User; liskov: User; bob: User },
): Promise<void> {
	const exam = "test-01";

	await db.question.create(
		{
			course,
			slug: "explain-recursion",
			status: "PUBLISHED",
			version: "v1",
			question: {
				type: "essay",
				title: "Explain recursion",
				stem: "Explain, in your own words, why a recursive function needs a base case.",
				tags: ["recursion"],
				input: "text",
			},
		},
		FULL_ACCESS,
	);
	await db.exam.create(
		{
			course,
			slug: exam,
			type: "EXAM",
			status: "ONGOING",
			title: "Test 1: recursion",
			description: "Base cases, the call stack and recursive definitions.",
			tags: ["recursion"],
			questions: [
				{ slug: "recursion-basics", version: "v1" },
				{ slug: "factorial-of-five", version: "v1" },
				{ slug: "explain-recursion", version: "v1" },
			],
		},
		FULL_ACCESS,
	);

	// Hopper: objective answers graded by the bot, the essay still pending.
	const hopper = await answerExam(course, exam, students.hopper, {
		"recursion-basics": { choice: "base-case" },
		"factorial-of-five": { value: 120 },
		"explain-recursion": {
			essay:
				"Each call must get closer to a case it can answer without calling itself. Without it the calls never stop and the stack overflows.",
		},
	});
	await botGrade(hopper["recursion-basics"], "1");
	await botGrade(hopper["factorial-of-five"], "1");

	// Hamilton: everything graded, the essay by the instructor with a comment.
	const hamilton = await answerExam(course, exam, students.hamilton, {
		"recursion-basics": { choice: "tail-call" },
		"factorial-of-five": { value: 100 },
		"explain-recursion": {
			essay: "The base case is where the function returns a value directly.",
		},
	});
	await botGrade(hamilton["recursion-basics"], "0");
	await botGrade(hamilton["factorial-of-five"], "0");
	await db.feedback.create(
		{
			submission: { publicId: hamilton["explain-recursion"] ?? "" },
			ref: "manual-1",
			score: "0.8",
			feedback: "Right, but say what happens without one.",
		},
		{ actor: instructor },
	);

	// Liskov: one question unanswered, and an empty essay marked will-not-grade.
	const liskov = await answerExam(course, exam, students.liskov, {
		"recursion-basics": { choice: "base-case" },
		"explain-recursion": { essay: "" },
	});
	await botGrade(liskov["recursion-basics"], "1");
	await db.feedback.create(
		{
			submission: { publicId: liskov["explain-recursion"] ?? "" },
			ref: "wng-manual-1",
			score: "0",
			feedback: "Submitted empty.",
		},
		{ actor: instructor },
	);
	await db.submission.update(
		{ publicId: liskov["explain-recursion"] ?? "" },
		{ status: "WILL_NOT_GRADE" },
		FULL_ACCESS,
	);

	// Bob: nothing graded yet, not even the objective answer.
	await answerExam(course, exam, students.bob, {
		"recursion-basics": { choice: "tail-call" },
		"explain-recursion": {
			essay: "Recursion is when a function calls itself until it is done.",
		},
	});

	await db.exam.update(
		{ course, slug: exam },
		{ status: "COMPLETED" },
		FULL_ACCESS,
	);
}

/**
 * Seeds the three states an exam exception can leave an exam in.
 *
 * The dev student has 30 extra minutes on the upcoming quiz 3. Test 2 ended
 * and Bob, who missed it, has a makeup in two days, so its grades cannot be
 * released yet. Test 3's window ended half an hour ago, but Liskov has extra
 * time, so her closed attempt can still be reopened. It is an `EXAM`: a `QUIZ`
 * releases when it closes, and a released exam takes no new exception.
 */
async function seedExamExceptions(
	course: Course["id"],
	students: { hamilton: User; bob: User; liskov: User },
): Promise<void> {
	const now = Date.now();
	const minutes = (count: number) => new Date(now + count * 60_000);

	await db.examException.create(
		{
			course,
			exam: "quiz-03",
			username: DEV_STUDENT_USERNAME,
			extraTime: { minutes: 30 },
			note: "Accommodation on file",
		},
		FULL_ACCESS,
	);

	// Answered while open, then moved into the past: an exam cannot be answered once its window is over.
	await db.exam.create(
		{
			course,
			slug: "test-02",
			type: "EXAM",
			status: "ONGOING",
			title: "Test 2: lists and stacks",
			description: "Linked lists, stacks and queues.",
			tags: ["data-structures"],
			questions: [{ slug: "recursion-basics", version: "v1" }],
		},
		FULL_ACCESS,
	);
	const hamilton = await answerExam(course, "test-02", students.hamilton, {
		"recursion-basics": { choice: "base-case" },
	});
	await botGrade(hamilton["recursion-basics"], "1");
	await db.exam.update(
		{ course, slug: "test-02" },
		{
			status: "COMPLETED",
			scheduledAt: minutes(-5 * 24 * 60),
			duration: { hours: 1 },
		},
		FULL_ACCESS,
	);
	await db.examException.create(
		{
			course,
			exam: "test-02",
			username: students.bob.username,
			scheduledAt: minutes(2 * 24 * 60),
			note: "Missed the exam, medical note",
		},
		FULL_ACCESS,
	);

	await db.exam.create(
		{
			course,
			slug: "test-03",
			type: "EXAM",
			status: "ONGOING",
			title: "Test 3: recursion trees",
			description: "Drawing call trees by hand.",
			tags: ["recursion"],
			questions: [{ slug: "recursion-basics", version: "v1" }],
		},
		FULL_ACCESS,
	);
	await answerExam(course, "test-03", students.liskov, {
		"recursion-basics": { choice: "base-case" },
	});
	await db.exam.update(
		{ course, slug: "test-03" },
		{ scheduledAt: minutes(-90), duration: { hours: 1 } },
		FULL_ACCESS,
	);
	await db.examException.create(
		{
			course,
			exam: "test-03",
			username: students.liskov.username,
			extraTime: { hours: 6 },
			note: "Connection dropped",
		},
		FULL_ACCESS,
	);
}

/**
 * Seeds a closed, graded exam with released grades, answered by eight students, for the question statistics.
 *
 * It has a multiple choice with a popular distractor and a choice nobody
 * picks, a multiple selection, a true-false, a question the best students on
 * the rest of the exam miss (negative discrimination), a numeric, and one
 * everybody gets right (no variance).
 */
async function seedQuestionStatsExam(
	course: Course["id"],
	students: User[],
): Promise<void> {
	const exam = "test-04";
	const question = (
		slug: string,
		body: Record<string, unknown>,
	): Promise<unknown> =>
		db.question.create(
			{
				course,
				slug,
				status: "PUBLISHED",
				version: "v1",
				question: { tags: ["algorithms"], ...body } as never,
			},
			FULL_ACCESS,
		);
	await question("fastest-sort", {
		type: "multiple-choice",
		title: "Fastest general sort",
		stem: "Which sort has an O(n log n) worst case?",
		choices: [
			{ id: "merge", text: "Merge sort", score: 1 },
			{ id: "bubble", text: "Bubble sort" },
			{ id: "insertion", text: "Insertion sort" },
			{ id: "bogo", text: "Bogosort" },
		],
	});
	await question("n-log-n", {
		type: "multiple-selection",
		title: "O(n log n) algorithms",
		stem: "Select every algorithm that runs in O(n log n) on average.",
		choices: [
			{ id: "merge", text: "Merge sort", correct: true },
			{ id: "quick", text: "Quicksort", correct: true },
			{ id: "bubble", text: "Bubble sort", correct: false },
			{ id: "binary-search", text: "Binary search", correct: false },
		],
	});
	await question("stack-facts", {
		type: "true-false",
		title: "Stack facts",
		stem: "Judge each statement about stacks.",
		choices: [
			{ id: "lifo", text: "A stack is last in, first out.", correct: true },
			{ id: "fifo", text: "A stack is first in, first out.", correct: false },
			{ id: "push", text: "Push adds to the top.", correct: true },
		],
	});
	await question("pivot-trap", {
		type: "multiple-choice",
		title: "Worst case of quicksort",
		stem: "What is the worst-case time of quicksort with a fixed pivot?",
		choices: [
			{ id: "quadratic", text: "O(n^2)", score: 1 },
			{ id: "linearithmic", text: "O(n log n)" },
		],
	});
	await question("stack-top", {
		type: "multiple-choice",
		title: "Stack access",
		stem: "Which end of a stack does `pop` remove from?",
		choices: [
			{ id: "top", text: "The top", score: 1 },
			{ id: "bottom", text: "The bottom" },
		],
	});
	await db.exam.create(
		{
			course,
			slug: exam,
			type: "EXAM",
			status: "ONGOING",
			title: "Test 4: algorithms",
			description: "Sorting and stacks, with a question that needs rework.",
			tags: ["algorithms"],
			questions: [
				{ slug: "fastest-sort", version: "v1" },
				{ slug: "n-log-n", version: "v1" },
				{ slug: "stack-facts", version: "v1" },
				{ slug: "pivot-trap", version: "v1" },
				{ slug: "factorial-of-five", version: "v1" },
				{ slug: "stack-top", version: "v1" },
			],
		},
		FULL_ACCESS,
	);

	/// Each row: the answer and its score to every question, by student in `students` order.
	const rows: [string, Record<string, unknown>, string][][] = [
		[
			["fastest-sort", { choice: "merge" }, "1"],
			["n-log-n", { choices: ["merge", "quick"] }, "1"],
			[
				"stack-facts",
				{ answers: { lifo: true, fifo: false, push: true } },
				"1",
			],
			["pivot-trap", { choice: "linearithmic" }, "0"],
			["factorial-of-five", { value: 120 }, "1"],
			["stack-top", { choice: "top" }, "1"],
		],
		[
			["fastest-sort", { choice: "merge" }, "1"],
			["n-log-n", { choices: ["merge", "quick"] }, "1"],
			[
				"stack-facts",
				{ answers: { lifo: true, fifo: false, push: true } },
				"1",
			],
			["pivot-trap", { choice: "linearithmic" }, "0"],
			["factorial-of-five", { value: 120 }, "1"],
			["stack-top", { choice: "top" }, "1"],
		],
		[
			["fastest-sort", { choice: "merge" }, "1"],
			["n-log-n", { choices: ["merge", "quick"] }, "1"],
			[
				"stack-facts",
				{ answers: { lifo: true, fifo: false, push: true } },
				"1",
			],
			["pivot-trap", { choice: "linearithmic" }, "0"],
			["factorial-of-five", { value: 120 }, "1"],
			["stack-top", { choice: "top" }, "1"],
		],
		[
			["fastest-sort", { choice: "insertion" }, "0"],
			["n-log-n", { choices: ["merge"] }, "0.5"],
			["stack-facts", { answers: { lifo: true, fifo: false } }, "0.67"],
			["pivot-trap", { choice: "linearithmic" }, "0"],
			["factorial-of-five", { value: 120 }, "1"],
			["stack-top", { choice: "top" }, "1"],
		],
		[
			["fastest-sort", { choice: "merge" }, "1"],
			["n-log-n", { choices: ["merge", "quick", "bubble"] }, "0.5"],
			[
				"stack-facts",
				{ answers: { lifo: true, fifo: true, push: true } },
				"0.33",
			],
			["pivot-trap", { choice: "quadratic" }, "1"],
			["factorial-of-five", { value: 120 }, "1"],
			["stack-top", { choice: "top" }, "1"],
		],
		[
			["fastest-sort", { choice: "bubble" }, "0"],
			["n-log-n", { choices: ["merge"] }, "0.5"],
			[
				"stack-facts",
				{ answers: { lifo: true, fifo: false, push: true } },
				"1",
			],
			["pivot-trap", { choice: "quadratic" }, "1"],
			["factorial-of-five", { value: 100 }, "0"],
			["stack-top", { choice: "top" }, "1"],
		],
		[
			["fastest-sort", { choice: "bubble" }, "0"],
			["n-log-n", { choices: [] }, "0"],
			[
				"stack-facts",
				{ answers: { lifo: false, fifo: true, push: false } },
				"0",
			],
			["pivot-trap", { choice: "quadratic" }, "1"],
			["factorial-of-five", { value: 100 }, "0"],
			["stack-top", { choice: "top" }, "1"],
		],
		[
			["fastest-sort", { choice: "bubble" }, "0"],
			["n-log-n", { choices: ["bubble"] }, "0"],
			[
				"stack-facts",
				{ answers: { lifo: false, fifo: true, push: false } },
				"0",
			],
			["pivot-trap", { choice: "quadratic" }, "1"],
			["factorial-of-five", { value: 24 }, "0"],
			["stack-top", { choice: "top" }, "1"],
		],
	];
	for (const [index, student] of students.entries()) {
		const row = rows[index] ?? [];
		const submissions = await answerExam(
			course,
			exam,
			student,
			Object.fromEntries(row.map(([slug, payload]) => [slug, payload])),
		);
		for (const [slug, , score] of row) {
			await botGrade(submissions[slug], score);
		}
	}

	await db.exam.update(
		{ course, slug: exam },
		{
			status: "COMPLETED",
			scheduledAt: new Date(Date.now() - 6 * 24 * 3600 * 1000),
			duration: { hours: 2 },
		},
		FULL_ACCESS,
	);
	await db.exam.releaseGrades({ course, slug: exam }, FULL_ACCESS);
}

/**
 * Seeds an exam whose grades were just released, with a regrade request in each state.
 *
 * The dev student has an open request on a wrong answer and can still ask
 * for a regrade of the other. Hopper's was accepted with a new score and
 * Hamilton's rejected.
 */
async function seedRegradeExam(
	course: Course["id"],
	instructor: User,
	students: { hopper: User; hamilton: User },
): Promise<void> {
	const exam = "test-05";
	const student = await db.user.findOne(
		{ username: DEV_STUDENT_USERNAME },
		FULL_ACCESS,
	);
	if (!student) throw new Error("The dev student account is missing.");

	await db.exam.create(
		{
			course,
			slug: exam,
			type: "EXAM",
			status: "ONGOING",
			title: "Test 5: regrades",
			description: "Grades out, with regrade requests to look at.",
			tags: ["recursion"],
			questions: [
				{ slug: "recursion-basics", version: "v1" },
				{ slug: "factorial-of-five", version: "v1" },
			],
		},
		FULL_ACCESS,
	);
	const own = await answerExam(course, exam, student, {
		"recursion-basics": { choice: "tail-call" },
		"factorial-of-five": { value: 120 },
	});
	await botGrade(own["recursion-basics"], "0");
	await botGrade(own["factorial-of-five"], "1");
	const hopper = await answerExam(course, exam, students.hopper, {
		"recursion-basics": { choice: "tail-call" },
		"factorial-of-five": { value: 120 },
	});
	await botGrade(hopper["recursion-basics"], "0");
	await botGrade(hopper["factorial-of-five"], "1");
	const hamilton = await answerExam(course, exam, students.hamilton, {
		"recursion-basics": { choice: "base-case" },
		"factorial-of-five": { value: 25 },
	});
	await botGrade(hamilton["recursion-basics"], "1");
	await botGrade(hamilton["factorial-of-five"], "0");

	await db.exam.update(
		{ course, slug: exam },
		{
			status: "COMPLETED",
			scheduledAt: new Date(Date.now() - 3 * 24 * 3600 * 1000),
			duration: { hours: 1 },
		},
		FULL_ACCESS,
	);
	await db.exam.releaseGrades({ course, slug: exam }, FULL_ACCESS);

	const ask = (author: User, submission: string | undefined, message: string) =>
		db.regradeRequest.create(
			{ course, submission: submission ?? "", message },
			{ actor: author },
		);
	await ask(
		student,
		own["recursion-basics"],
		"I picked tail call because the function returns right away, please check.",
	);
	const accepted = await ask(
		students.hopper,
		hopper["recursion-basics"],
		"A tail call is a recursive call, so my answer should count.",
	);
	await db.regradeRequest.accept(
		{ publicId: accepted.publicId },
		{
			score: "1",
			reply: "You are right, the wording of the question was loose.",
		},
		{ actor: instructor },
	);
	const rejected = await ask(
		students.hamilton,
		hamilton["factorial-of-five"],
		"I computed the factorial of four by mistake, can I get partial credit?",
	);
	await db.regradeRequest.reject(
		{ publicId: rejected.publicId },
		{ reply: "The question asks for five, so there is no partial credit." },
		{ actor: instructor },
	);
}

//
// Utility functions
//
async function demoUser(input: {
	email: string;
	username: string;
	name: string;
	role: "INSTRUCTOR" | "STUDENT" | "ADMIN";
	password?: string;
}): Promise<User> {
	const existing = await db.user.findOne(
		{ username: input.username },
		FULL_ACCESS,
	);
	if (existing) return existing;
	return db.user.create(
		{
			...input,
			githubId: input.username,
			schoolId: input.username,
			password: input.password ?? input.username,
		},
		FULL_ACCESS,
	);
}
