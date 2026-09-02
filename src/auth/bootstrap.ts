import { FULL_ACCESS } from "@/db/base-service";
import { calendarEventService } from "@/db/calendar-event.service";
import { courseService } from "@/db/course.service";
import { disciplineService } from "@/db/discipline.service";
import { editionService } from "@/db/edition.service";
import { fileService } from "@/db/file.service";
import { resourceService } from "@/db/resource.service";
import { timeSlotService } from "@/db/time-slot.service";
import { type user, userService } from "@/db/user.service";

const DEV_ADMIN_USERNAME = "admin";
const DEV_ADMIN_EMAIL = "admin@codehood.local";
const DEV_INSTRUCTOR_USERNAME = "instructor";
const DEV_INSTRUCTOR_EMAIL = "instructor@codehood.local";
const DEV_STUDENT_USERNAME = "student";
const DEV_STUDENT_EMAIL = "student@codehood.local";

let devAdminPromise: Promise<void> | null = null;

/**
 * Dev-only convenience: seeds a few default accounts when the database has no users yet.
 * Called from the Prisma seed script (`manage seed` / `prisma db seed`).
 */
export function ensureDevAdmin(): Promise<void> {
	if (process.env.NODE_ENV === "production") {
		console.log("[seed] production mode: skipping default admin account.");
		return Promise.resolve();
	}
	devAdminPromise ??= createDevAdminIfMissing();
	return devAdminPromise;
}

async function createDevAdminIfMissing(): Promise<void> {
	if ((await userService.findMany({ take: 1 }, FULL_ACCESS)).length > 0) {
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
 * students) when the database has no courses yet. Self-healing on first
 * request, same pattern as {@link ensureDevAdmin} — Playwright specs need a
 * course to open, and `/courses` renders nothing useful on a fresh database
 * otherwise.
 */
export function ensureDemoCourses(): Promise<void> {
	if (process.env.NODE_ENV === "production") {
		return Promise.resolve();
	}
	demoCoursesPromise ??= createDemoCoursesIfMissing();
	return demoCoursesPromise;
}

async function createDemoCoursesIfMissing(): Promise<void> {
	const existing = await courseService.findMany({}, FULL_ACCESS);
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
		await disciplineService.create(discipline, FULL_ACCESS);
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
		await editionService.create(edition, FULL_ACCESS);
	}

	const cs101 = await courseService.create(
		{
			disciplineSlug: "cs101",
			instructorUsername: ada.username,
			editionSlug: "2026-1",
			description:
				"A first course in programming: variables, control flow, functions, and enough data structures to get dangerous.",
			startAt: new Date("2026-01-05"),
			endAt: new Date("2026-05-15"),
		},
		FULL_ACCESS,
	);
	const cs201 = await courseService.create(
		{
			disciplineSlug: "cs201",
			instructorUsername: alan.username,
			editionSlug: "2026-1",
			description:
				"Arrays, linked lists, trees, and graphs, with an eye toward complexity.",
			startAt: new Date("2026-01-05"),
			endAt: new Date("2026-05-15"),
		},
		FULL_ACCESS,
	);

	for (const student of [hopper, hamilton, liskov, bob]) {
		await courseService.enroll(
			{ courseId: cs101.id, userId: student.id },
			FULL_ACCESS,
		);
	}

	for (const student of [liskov, bob]) {
		await courseService.enroll(
			{ courseId: cs201.id, userId: student.id },
			FULL_ACCESS,
		);
	}

	// One resource of each type, so /resources has something real to show —
	// see dev/specs/to-do/resources.md.
	const syllabusFile = await fileService.create(
		{
			bytes: Buffer.from(
				"CS101 Syllabus\n\nGrading: 40% exams, 30% homework, 30% participation.\nOffice hours: Tuesdays 2-4pm.\n",
			),
			mimeType: "text/plain",
		},
		FULL_ACCESS,
	);
	await resourceService.create(
		{
			courseId: cs101.id,
			slug: "syllabus",
			type: "FILE",
			title: "Syllabus",
			description: "Grading, schedule, and course policy.",
			fileId: syllabusFile.id,
			contentHash: "demo-syllabus-v1",
		},
		FULL_ACCESS,
	);
	await resourceService.create(
		{
			courseId: cs101.id,
			slug: "sicp-ch1",
			type: "LINK",
			title: "SICP, chapter 1",
			data: "https://mitp-content-server.mit.edu/books/content/sectbyfn/books_pres_0/6515/sicp.zip/full-text/book/book-Z-H-10.html",
			contentHash: "demo-sicp-v1",
		},
		FULL_ACCESS,
	);
	await resourceService.create(
		{
			courseId: cs101.id,
			slug: "toolchain",
			type: "MD",
			title: "Setting up your toolchain",
			description: "Local dev environment, in three steps.",
			data: "Install Node 22 and `pnpm`, then run `pnpm dev`.\n\n- Clone the course repository\n- Run `pnpm install`\n- Ask on the forum if anything fails",
			contentHash: "demo-toolchain-v1",
		},
		FULL_ACCESS,
	);
	await resourceService.create(
		{
			courseId: cs101.id,
			slug: "factorial",
			type: "CODE",
			title: "factorial.py",
			extra: "python",
			data: "def factorial(n):\n    return 1 if n <= 1 else n * factorial(n - 1)\n",
			contentHash: "demo-factorial-v1",
		},
		FULL_ACCESS,
	);

	// cs201 gets its own small set, themed for data structures rather than a
	// copy of cs101's — an empty second course would leave /admin/courses
	// looking like resources only ever land on the first one seeded.
	const bigOFile = await fileService.create(
		{
			bytes: Buffer.from(
				"CS201 Cheat Sheet\n\nArray: O(1) index, O(n) insert/delete.\nLinked list: O(n) index, O(1) insert/delete at a known node.\nBalanced tree: O(log n) search/insert/delete.\nHash table: O(1) average, O(n) worst case.\n",
			),
			mimeType: "text/plain",
		},
		FULL_ACCESS,
	);
	await resourceService.create(
		{
			courseId: cs201.id,
			slug: "complexity-cheat-sheet",
			type: "FILE",
			title: "Complexity cheat sheet",
			description: "Time complexity for the structures covered this term.",
			fileId: bigOFile.id,
			contentHash: "demo-cheatsheet-v1",
		},
		FULL_ACCESS,
	);
	await resourceService.create(
		{
			courseId: cs201.id,
			slug: "clrs-trees",
			type: "LINK",
			title: "CLRS, chapter 12: Binary search trees",
			data: "https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/",
			contentHash: "demo-clrs-v1",
		},
		FULL_ACCESS,
	);
	await resourceService.create(
		{
			courseId: cs201.id,
			slug: "when-to-use-what",
			type: "MD",
			title: "Which structure, when",
			description:
				"A rule of thumb for picking a structure under time pressure.",
			data: "Need order-preserving iteration? Array or linked list.\n\nNeed fast lookup by key? Hash table.\n\nNeed sorted order *and* fast insert? Balanced tree.\n\nWhen in doubt, start with an array — you can always change it once a profiler tells you to.",
			contentHash: "demo-when-to-use-v1",
		},
		FULL_ACCESS,
	);
	await resourceService.create(
		{
			courseId: cs201.id,
			slug: "linked-list-node",
			type: "CODE",
			title: "linked_list.py",
			extra: "python",
			data: "class Node:\n    def __init__(self, value, next=None):\n        self.value = value\n        self.next = next\n",
			contentHash: "demo-linkedlist-v1",
		},
		FULL_ACCESS,
	);

	// A weekly pattern plus a few weeks of the term calendar for each course, so
	// /calendar, /<course>/schedule, and the course home page all have real
	// data to render (dev/specs/to-review/calendar.md). cs101 gets a holiday
	// and a cancelled lab so the muted/struck-through rendering has something
	// to show.
	const cs101Mon = await timeSlotService.create(
		{
			courseId: cs101.id,
			slug: "mon",
			title: "Lecture",
			day: "MONDAY",
			startMin: 840, // 14:00
			durationMin: 120,
		},
		FULL_ACCESS,
	);
	const cs101Wed = await timeSlotService.create(
		{
			courseId: cs101.id,
			slug: "wed",
			title: "Lab",
			day: "WEDNESDAY",
			startMin: 840, // 14:00
			durationMin: 120,
		},
		FULL_ACCESS,
	);
	for (const event of [
		{
			slug: "w01-mon",
			slot: cs101Mon,
			date: "2026-01-05",
			week: 1,
			kind: "LECTURE" as const,
			title: "Course overview and tooling",
			description: "Setting up the toolchain; how the term is graded.",
		},
		{
			slug: "w01-wed",
			slot: cs101Wed,
			date: "2026-01-07",
			week: 1,
			kind: "LAB" as const,
			title: "Environment setup",
			description: "Installing the interpreter and the course CLI.",
		},
		{
			slug: "w02-mon",
			slot: cs101Mon,
			date: "2026-01-12",
			week: 2,
			kind: "LECTURE" as const,
			title: "Variables and control flow",
		},
		{
			slug: "w02-wed",
			slot: cs101Wed,
			date: "2026-01-14",
			week: 2,
			kind: "LAB" as const,
			title: "Practice: control flow",
		},
		{
			slug: "w03-mon",
			slot: cs101Mon,
			date: "2026-01-19",
			week: 3,
			kind: "HOLIDAY" as const,
			title: "Martin Luther King Jr. Day",
			description: "No class — university holiday.",
		},
		{
			slug: "w03-wed",
			slot: cs101Wed,
			date: "2026-01-21",
			week: 3,
			kind: "LAB" as const,
			title: "Practice: functions",
		},
		{
			slug: "w04-mon",
			slot: cs101Mon,
			date: "2026-01-26",
			week: 4,
			kind: "LECTURE" as const,
			title: "Functions and recursion",
		},
		{
			slug: "w04-wed",
			slot: cs101Wed,
			date: "2026-01-28",
			week: 4,
			kind: "CANCELLED" as const,
			title: "Lab: recursion practice",
			description: "Instructor traveling; make-up session posted online.",
		},
	]) {
		await calendarEventService.create(
			{
				courseId: cs101.id,
				timeSlotId: event.slot.id,
				slug: event.slug,
				date: event.date,
				week: event.week,
				kind: event.kind,
				title: event.title,
				description: event.description,
				contentHash: `demo-${event.slug}-v1`,
			},
			FULL_ACCESS,
		);
	}

	const cs201Mon = await timeSlotService.create(
		{
			courseId: cs201.id,
			slug: "mon",
			title: "Lecture",
			day: "MONDAY",
			startMin: 600, // 10:00
			durationMin: 90,
		},
		FULL_ACCESS,
	);
	for (const event of [
		{
			slug: "w01-mon",
			date: "2026-01-05",
			week: 1,
			kind: "LECTURE" as const,
			title: "Arrays and linked lists",
			description: "Time and space complexity of the basic sequences.",
		},
		{
			slug: "w02-mon",
			date: "2026-01-12",
			week: 2,
			kind: "LECTURE" as const,
			title: "Stacks and queues",
		},
		{
			slug: "w03-mon",
			date: "2026-01-19",
			week: 3,
			kind: "LECTURE" as const,
			title: "Binary search trees",
		},
	]) {
		await calendarEventService.create(
			{
				courseId: cs201.id,
				timeSlotId: cs201Mon.id,
				slug: event.slug,
				date: event.date,
				week: event.week,
				kind: event.kind,
				title: event.title,
				description: event.description,
				contentHash: `demo-cs201-${event.slug}-v1`,
			},
			FULL_ACCESS,
		);
	}

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
}): Promise<user> {
	const existing = await userService.findOne(
		{ username: input.username },
		FULL_ACCESS,
	);
	if (existing) return existing;
	return userService.create(
		{
			...input,
			githubId: input.username,
			schoolId: input.username,
			password: input.password ?? input.username,
		},
		FULL_ACCESS,
	);
}
