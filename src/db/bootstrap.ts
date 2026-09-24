import { FULL_ACCESS } from "@/auth/actor";
import { DEVELOPMENT } from "@/core/constants";
import { db, type User } from "@/db";

const DEV_ADMIN_USERNAME = "admin";
const DEV_ADMIN_EMAIL = "admin@codehood.local";
const DEV_INSTRUCTOR_USERNAME = "instructor";
const DEV_INSTRUCTOR_EMAIL = "instructor@codehood.local";
const DEV_STUDENT_USERNAME = "student";
const DEV_STUDENT_EMAIL = "student@codehood.local";

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

	for (const discipline of [
		{ slug: "cs101", name: "Introduction to Programming" },
		{ slug: "cs201", name: "Data Structures" },
	]) {
		await db.discipline.create(discipline, FULL_ACCESS);
	}

	// Two terms: 2026-1 is the one the demo courses run in, fixed safely in the
	// past so it always reads as expired. The second is computed around seed
	// time rather than a fixed date, so it always reads as the live one — a
	// hardcoded window would only look alive until its own end date passed,
	// then quietly leave the admin UI with two closed editions to show.
	const now = new Date();
	const liveStart = new Date(now);
	liveStart.setMonth(liveStart.getMonth() - 1);
	const liveEnd = new Date(now);
	liveEnd.setMonth(liveEnd.getMonth() + 4);

	for (const edition of [
		{
			slug: "2026-1",
			name: "2026 · first term",
			startAt: new Date("2026-01-05"),
			endAt: new Date("2026-05-15"),
		},
		{
			slug: `${now.getFullYear()}-2`,
			name: `${now.getFullYear()} · second term`,
			startAt: liveStart,
			endAt: liveEnd,
		},
	]) {
		await db.edition.create(edition, FULL_ACCESS);
	}

	const cs101 = await db.course.create(
		{
			discipline: "cs101",
			instructor: ada.username,
			edition: "2026-1",
			description:
				"A first course in programming: variables, control flow, functions, and enough data structures to get dangerous.",
			startAt: new Date("2026-01-05"),
			endAt: new Date("2026-05-15"),
		},
		FULL_ACCESS,
	);
	const cs201 = await db.course.create(
		{
			discipline: "cs201",
			instructor: alan.username,
			edition: "2026-1",
			description:
				"Arrays, linked lists, trees, and graphs, with an eye toward complexity.",
			startAt: new Date("2026-01-05"),
			endAt: new Date("2026-05-15"),
		},
		FULL_ACCESS,
	);

	for (const student of [hopper, hamilton, liskov, bob]) {
		await db.enrollment.create(
			{ course: cs101.id, username: student.username },
			FULL_ACCESS,
		);
	}

	for (const student of [liskov, bob]) {
		await db.enrollment.create(
			{ course: cs201.id, username: student.username },
			FULL_ACCESS,
		);
	}

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
			ref: "syllabus-hash",
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
			ref: "demo-sicp-v1",
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
			ref: "demo-toolchain-v1",
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
			ref: "demo-factorial-v1",
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
			ref: "demo-cheatsheet-v1",
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
			ref: "demo-clrs-v1",
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
					"Need order-preserving iteration? Array or linked list.\n\nNeed fast lookup by key? Hash table.\n\nNeed sorted order *and* fast insert? Balanced tree.\n\nWhen in doubt, start with an array — you can always change it once a profiler tells you to.",
			},
			ref: "demo-when-to-use-v1",
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
			ref: "demo-linkedlist-v1",
		},
		FULL_ACCESS,
	);

	// A weekly pattern plus a few weeks of the term calendar for each course, so
	// /calendar, /<course>/schedule, and the course home page all have real
	// data to render. cs101 gets a holiday and a cancelled lab so the muted/
	// struck-through rendering has something to show.
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
			description: "Setting up the toolchain; how the term is graded.",
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
			title: "Martin Luther King Jr. Day",
			description: "No class — university holiday.",
		},
		{
			slug: "w03-wed",
			slot: cs101Wed,
			week: 3,
			kind: "REGULAR" as const,
			title: "Practice: functions",
		},
		{
			slug: "w04-mon",
			slot: cs101Mon,
			week: 4,
			kind: "REGULAR" as const,
			title: "Functions and recursion",
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
				ref: `demo-${event.slug}-v1`,
			},
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
				ref: `demo-cs201-${event.slug}-v1`,
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
			status: "COMPLETED",
			title: "Quiz 1: recursion",
			description: "A short warm-up quiz on recursive functions.",
			preamble: "Answer both questions. You may consult the course notes.",
			scheduledAt: new Date("2026-01-26T14:00:00"),
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
			scheduledAt: new Date("2026-03-09T14:00:00"),
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

	console.log(
		`[dev] created demo courses cs101/${ada.username}_2026-1 and cs201/${alan.username}_2026-1.`,
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
