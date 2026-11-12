import { deflateSync } from "node:zlib";
import { FULL_ACCESS } from "@/auth/actor";
import { hashToken } from "@/auth/token";
import { DEVELOPMENT, MAX_ANSWER_HISTORY_TEXT_BYTES } from "@/core/constants";
import { type CalendarEvent, type Course, db, type User } from "@/db";
import { prisma } from "@/db/client";
import type { AnswerEditBatchInput } from "@/db/services/answer-edit.service";
import type { QuestionResponse } from "@/mdq";
import {
	encodeEdits,
	type InputKind,
	replayEdits,
} from "@/services/answer-edits/codec";
import { hashBytes } from "@/utils/content-hash";
import {
	courseWeekZero,
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
/// Fixed so the CLI can authenticate as `ada` right after a reset.
export const DEV_ADA_CLI_TOKEN = "dev-ada-cli";
/// Fixed so a grading runner can authenticate with `ada`'s BOT key `runner` right after a reset.
export const DEV_RUNNER_TOKEN = "dev-runner-bot";

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
		// Has no course here: `pnpm run db:seed:cli` creates it with `ch push`.
		{ slug: "pyxel101", name: "Introdução à Programação com Python e Jogos" },
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

	// Written straight to the table, like the feed above: the service mints
	// its own random token.
	await prisma.apiKey.create({
		data: {
			publicId: "dev-ada-cli",
			keyHash: hashToken(DEV_ADA_CLI_TOKEN),
			name: "Dev CLI",
			kind: "CLI",
			createdById: ada.username,
		},
	});

	await prisma.apiKey.create({
		data: {
			publicId: "dev-runner",
			keyHash: hashToken(DEV_RUNNER_TOKEN),
			name: "runner",
			kind: "BOT",
			createdById: ada.username,
		},
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
					"def factorial(n):\n    return 1 if n <= 1 else n * factorial(n - 1)\n\n\nprint(factorial(5))\n",
			},
			rev: "demo-factorial-v1",
		},
		FULL_ACCESS,
	);
	await db.resource.create(
		{
			course: cs101.id,
			slug: "prolog-factorial",
			title: "factorial.pl",
			description: "Consulted on Run; then query it at the Prolog prompt.",
			data: {
				type: "CODE",
				language: "prolog",
				content: [
					"factorial(0, 1).",
					"factorial(N, F) :-",
					"    N > 0,",
					"    M is N - 1,",
					"    factorial(M, G),",
					"    F is N * G.",
					"",
					":- factorial(5, F), format('5! = ~w~n', [F]).",
					"",
				].join("\n"),
			},
			rev: "demo-prolog-factorial-v1",
		},
		FULL_ACCESS,
	);
	await db.resource.create(
		{
			course: cs101.id,
			slug: "python-greet",
			title: "greet.py",
			description: "Reads a name with input() and greets it.",
			data: {
				type: "CODE",
				language: "python",
				content:
					'name = input("What is your name? ")\nprint("Hello, " + name + "!")\n',
			},
			rev: "demo-python-greet-v1",
		},
		FULL_ACCESS,
	);

	await db.resource.create(
		{
			course: cs101.id,
			slug: "lua-greet",
			title: "greet.lua",
			description: "Reads a name with io.read and greets it.",
			data: {
				type: "CODE",
				language: "lua",
				content:
					'io.write("What is your name? ")\nlocal name = io.read("l")\nprint("Hello, " .. name .. "!")\n',
			},
			rev: "demo-lua-greet-v1",
		},
		FULL_ACCESS,
	);
	await db.resource.create(
		{
			course: cs101.id,
			slug: "scheme-greet",
			title: "greet.scm",
			description:
				"Reads a name with read-line; an error reports its top-level form.",
			data: {
				type: "CODE",
				language: "scheme",
				content: [
					"(define (greet name)",
					'  (string-append "Hello, " name "!"))',
					"",
					'(display "What is your name? ")',
					"(display (greet (read-line)))",
					"(newline)",
					"",
				].join("\n"),
			},
			rev: "demo-scheme-greet-v1",
		},
		FULL_ACCESS,
	);
	await db.resource.create(
		{
			course: cs101.id,
			slug: "ts-greet",
			title: "greet.ts",
			description: "Types are removed, not checked; prompt() reads a name.",
			data: {
				type: "CODE",
				language: "typescript",
				content: [
					"interface Greeting {",
					"  name: string;",
					"}",
					"",
					'const who: Greeting = { name: prompt("What is your name?") ?? "" };',
					"console.log('Hello, ' + who.name + '!');",
					"",
				].join("\n"),
			},
			rev: "demo-ts-greet-v1",
		},
		FULL_ACCESS,
	);
	await db.resource.create(
		{
			course: cs101.id,
			slug: "elm-lists",
			title: "Lists.elm",
			description:
				"Run compiles it and runs `tests` (one fails on purpose), then opens the REPL.",
			data: {
				type: "CODE",
				language: "elm",
				content: [
					"module Main exposing (..)",
					"",
					"import Expect",
					"import Test exposing (Test, describe, test)",
					"",
					"",
					"sumList : List Int -> Int",
					"sumList =",
					"    List.foldl (+) 0",
					"",
					"",
					"lastOf : List a -> Maybe a",
					"lastOf xs =",
					"    List.head xs",
					"",
					"",
					"tests : Test",
					"tests =",
					'    describe "lists"',
					'        [ test "sumList adds" (\\_ -> Expect.equal 6 (sumList [ 1, 2, 3 ]))',
					'        , test "lastOf takes the last" (\\_ -> Expect.equal (Just 3) (lastOf [ 1, 2, 3 ]))',
					"        ]",
					"",
				].join("\n"),
			},
			rev: "demo-elm-lists-v1",
		},
		FULL_ACCESS,
	);
	await db.resource.create(
		{
			course: cs101.id,
			slug: "elm-repl",
			title: "Shapes.elm",
			description: "No tests: Run opens the REPL with these definitions.",
			data: {
				type: "CODE",
				language: "elm",
				content: [
					"module Main exposing (..)",
					"",
					"",
					"type Shape",
					"    = Circle Float",
					"    | Rect Float Float",
					"",
					"",
					"area : Shape -> Float",
					"area shape =",
					"    case shape of",
					"        Circle r ->",
					"            pi * r * r",
					"",
					"        Rect w h ->",
					"            w * h",
					"",
				].join("\n"),
			},
			rev: "demo-elm-repl-v1",
		},
		FULL_ACCESS,
	);
	await db.resource.create(
		{
			course: cs101.id,
			slug: "elm-notes",
			title: "Elm notes",
			description: "A runnable Elm block in a note.",
			data: {
				type: "MD",
				content: [
					"Run the block, then try `List.map square [1, 2, 3]` in the REPL:",
					"",
					"```elm run",
					"module Main exposing (..)",
					"",
					"",
					"square : Int -> Int",
					"square n =",
					"    n * n",
					"```",
				].join("\n"),
			},
			rev: "demo-elm-notes-v1",
		},
		FULL_ACCESS,
	);

	// Runnable JavaScript, one resource per state of the code runner widget.
	const jsLinksCode = 'console.log("Docs: https://developer.mozilla.org/");\n';
	const runnableCode = [
		{
			slug: "js-hello",
			title: "hello.js",
			description: "Reads a name with prompt() and greets it.",
			content:
				'const name = prompt("What is your name?");\nconsole.log("Hello, " + name + "!");\n',
		},
		{
			slug: "js-forever",
			title: "forever.js",
			description: "Never ends: use Stop.",
			content: "while (true) {}\n",
		},
		{
			slug: "js-flood",
			title: "flood.js",
			description: "Prints more than the output limit allows.",
			content:
				'const line = "x".repeat(1023);\nfor (let i = 0; i < 4096; i++) console.log(line);\n',
		},
		{
			slug: "js-throws",
			title: "throws.js",
			description: "Throws an exception: the stack goes to the terminal.",
			content: 'function fail() {\n  throw new Error("boom");\n}\nfail();\n',
		},
		{
			slug: "js-links",
			title: "links.js",
			description: "Prints a URL: clicking it asks for confirmation.",
			content: jsLinksCode,
		},
	];
	for (const { slug, title, description, content } of runnableCode) {
		await db.resource.create(
			{
				course: cs101.id,
				slug,
				title,
				description,
				data: { type: "CODE", language: "javascript", content },
				rev: `demo-${slug}-v1`,
			},
			FULL_ACCESS,
		);
	}
	await db.resource.create(
		{
			course: cs101.id,
			slug: "js-notes",
			title: "JavaScript notes",
			description: "Runnable blocks, a static one and one without a driver.",
			data: {
				type: "MD",
				content: [
					"Run these two blocks, they share one runner:",
					"",
					"```js run",
					"let total = 0;",
					"for (let i = 1; i <= 10; i++) total += i;",
					"console.log(total);",
					"```",
					"",
					"```js run",
					'console.log("squares:", [1, 2, 3].map((n) => n * n));',
					"```",
					"",
					"This one is only code:",
					"",
					"```js",
					"console.log('not runnable');",
					"```",
					"",
					"No driver for this language yet:",
					"",
					"```haskell run",
					'main = putStrLn "hello"',
					"```",
				].join("\n"),
			},
			rev: "demo-js-notes-v1",
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
	const weeksSoFar = cs101.startAt
		? Math.floor(
				(Date.parse(`${localDateOf(new Date())}T00:00:00Z`) -
					Date.parse(`${courseWeekZero(cs101.startAt)}T00:00:00Z`)) /
					(7 * 24 * 3600 * 1000),
			)
		: 0;
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
				content: "text",
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
				content: "text",
			},
		},
		FULL_ACCESS,
	);

	// A blank that matches no pattern goes to the instructor, who grades it on its own.
	await db.question.create(
		{
			course: cs101.id,
			slug: "base-case-blanks",
			status: "PUBLISHED",
			version: "v1",
			question: {
				type: "fill-in",
				title: "Base case, in words",
				stem: "A recursive function stops at its [^stop] case, and each call works on a [^smaller] input.",
				tags: ["recursion"],
				unmatched: "manual",
				blanks: [
					{
						id: "stop",
						type: "multiple-choice",
						choices: [
							{ id: "base", text: "base", score: 1, feedback: "Right." },
							{ id: "recursive", text: "recursive" },
						],
					},
					{
						id: "smaller",
						type: "short-answer",
						accept: ["smaller", "simpler"],
					},
				],
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
				{ slug: "base-case-blanks", version: "v1" },
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
	await seedCodeExam(cs101.id, { hopper, hamilton, liskov, bob });
	await seedRunnableCodeExam(cs101.id, { hopper, hamilton, liskov, bob });
	await seedRubricExam(
		cs101.id,
		ada,
		{ hopper, hamilton, liskov, bob },
		cohort,
	);
	await seedOpenQuiz(cs101.id);
	await seedCodeAnswerExams(cs101.id);
	await seedAnswerEditHistoryExams(cs101.id, {
		hopper,
		hamilton,
		liskov,
		bob,
		practicing: cohort[0] as User,
	});
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
	await seedRepositories(cs101.id);

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

	await seedReports(ada, live.slug);

	console.log(
		`[dev] created demo courses cs101/${ada.username}_${live.slug} and cs201/${alan.username}_${live.slug}, plus the ended cs101/${ada.username}_${past.slug}.`,
	);
}

/// A solid-colour PNG of `width` x `height` pixels, standing in for a screenshot.
function solidPng(
	width: number,
	height: number,
	rgb: [number, number, number],
) {
	const crcTable = Array.from({ length: 256 }, (_, n) => {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		return c >>> 0;
	});
	const crc = (bytes: Buffer) => {
		let c = 0xffffffff;
		for (const b of bytes) c = (crcTable[(c ^ b) & 0xff] as number) ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	};
	const chunk = (type: string, data: Buffer) => {
		const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
		const head = Buffer.alloc(4);
		head.writeUInt32BE(data.length);
		const tail = Buffer.alloc(4);
		tail.writeUInt32BE(crc(body));
		return Buffer.concat([head, body, tail]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8; // bit depth
	header[9] = 2; // RGB
	const row = Buffer.concat([
		Buffer.from([0]), // filter: none
		Buffer.from(Array.from({ length: width }, () => rgb).flat()),
	]);
	const pixels = Buffer.concat(Array.from({ length: height }, () => row));
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(pixels)),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

/**
 * Seeds user reports in every kind and status, for the report screens.
 *
 * The student owns most of them; the instructor has one of their own and the
 * course's instructor gets an open `CONTENT` report in the queue.
 */
async function seedReports(instructor: User, edition: string): Promise<void> {
	const [admin, student, devInstructor] = await Promise.all(
		[DEV_ADMIN_USERNAME, DEV_STUDENT_USERNAME, DEV_INSTRUCTOR_USERNAME].map(
			(username) => db.user.findOne({ username }, FULL_ACCESS),
		),
	);
	if (!admin || !student || !devInstructor) {
		throw new Error(
			"[seed] the dev accounts are missing; cannot seed reports.",
		);
	}
	const course = {
		discipline: "cs101",
		instructor: instructor.username,
		edition,
	};
	const sent = {
		url: `http://localhost:4321/cs101/ada_${edition}`,
		userAgent:
			"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
		viewport: "1280x720",
	};

	await db.report.create(
		{
			kind: "BUG",
			message:
				"The calendar page shows last week's classes after I switch to the month view, and only a reload fixes it.",
			...sent,
			attachments: [
				{ filename: "calendar.png", bytes: solidPng(64, 40, [200, 70, 70]) },
			],
		},
		{ actor: student },
	);
	const suggestion = await db.report.create(
		{
			kind: "SUGGESTION",
			message:
				"It would help to filter the exam list by status. Right now I scroll through everything to find the open ones.",
			url: `http://localhost:4321/cs101/ada_${edition}/exams`,
			userAgent: sent.userAgent,
			viewport: "1440x900",
			attachments: [
				{ filename: "exams-1.png", bytes: solidPng(64, 40, [60, 120, 200]) },
				{ filename: "exams-2.png", bytes: solidPng(64, 40, [60, 180, 120]) },
			],
		},
		{ actor: student },
	);
	const content = await db.report.create(
		{
			kind: "CONTENT",
			course,
			message:
				"The recursion practice set asks for the base case before explaining what a base case is.",
			url: sent.url,
		},
		{ actor: student },
	);
	const other = await db.report.create(
		{
			kind: "OTHER",
			message:
				"My name appears with a typo in the attendance export. Who should I tell?",
		},
		{ actor: student },
	);
	await db.report.create(
		{
			kind: "CONTENT",
			course,
			message:
				"Lecture 4 says lists are immutable, but the example mutates one in place.",
			url: sent.url,
			userAgent: sent.userAgent,
			viewport: sent.viewport,
		},
		{ actor: student },
	);
	await db.report.create(
		{
			kind: "BUG",
			message:
				"Saving my profile with an empty bio returns an error page instead of a message.",
			url: "http://localhost:4321/profile",
			userAgent: sent.userAgent,
			viewport: "1280x720",
		},
		{ actor: devInstructor },
	);

	await db.report.update(
		{ publicId: suggestion.publicId },
		{ status: "TRIAGED", note: "Planned for the exams page. Tracked locally." },
		{ actor: admin },
	);
	await db.report.update(
		{ publicId: content.publicId },
		{ status: "RESOLVED", note: "Reordered the practice set. Fixed in rev 2." },
		{ actor: instructor },
	);
	await db.report.update(
		{ publicId: other.publicId },
		{
			status: "DISMISSED",
			note: "Not a Codehood problem: the name comes from the school registry.",
		},
		{ actor: admin },
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

/// A file of a demo repository: its path, its bytes and whether it is executable.
type DemoFile = { path: string; bytes: Buffer; executable?: boolean };

/// Adds `files` as one commit of a demo repository, sending the whole tree as the CLI does.
async function commitDemoFiles(
	repo: { course: Course["id"]; slug: string },
	files: DemoFile[],
	message: string,
): Promise<void> {
	const payload: Record<string, Buffer> = {};
	const tree: { path: string; mode: "100644" | "100755"; hash: string }[] =
		files.map((file) => {
			const hash = hashBytes(file.bytes);
			payload[hash] = file.bytes;
			return {
				path: file.path,
				mode: file.executable ? "100755" : "100644",
				hash,
			};
		});
	await db.repository.addFiles(repo, payload, FULL_ACCESS);
	await db.repository.commit(repo, { tree, message }, FULL_ACCESS);
}

/// The files of `lab-calculadora` with `subtracao` as the body of `subtrai`.
function labCalculadoraFiles(subtracao: string): DemoFile[] {
	const operacoes = [
		'"""Basic arithmetic operations."""',
		"",
		"",
		"def soma(a: float, b: float) -> float:",
		"    return a + b",
		"",
		"",
		"def subtrai(a: float, b: float) -> float:",
		`    return ${subtracao}`,
		"",
	].join("\n");
	const cli = [
		'"""Command line: python3 -m calc.cli OPERACAO A B."""',
		"",
		"import sys",
		"",
		"from calc.operacoes import soma, subtrai",
		"",
		'OPERACOES = {"soma": soma, "subtrai": subtrai}',
		"",
		"",
		"def main(argv: list[str]) -> int:",
		"    operacao, a, b = argv",
		"    print(OPERACOES[operacao](float(a), float(b)))",
		"    return 0",
		"",
		"",
		'if __name__ == "__main__":',
		"    sys.exit(main(sys.argv[1:]))",
		"",
	].join("\n");
	return [
		{
			path: "README.md",
			bytes: Buffer.from(
				[
					"# Lab: calculator",
					"",
					"Build a small calculator. The operations live in `calc/operacoes.py`",
					"and the command line in `calc/cli.py`.",
					"",
					"Run it with:",
					"",
					"    ./run.sh soma 2 3",
					"    ./run.sh subtrai 7 4",
					"",
					"The package notes are in [calc/README.md](calc/README.md).",
					"",
				].join("\n"),
			),
		},
		{
			path: "calc/README.md",
			bytes: Buffer.from(
				"# Package calc\n\nArithmetic is in `operacoes.py`, the command line in `cli.py`.\n",
			),
		},
		{
			path: "calc/__init__.py",
			bytes: Buffer.from('"""Calculator package."""\n'),
		},
		{ path: "calc/operacoes.py", bytes: Buffer.from(operacoes) },
		{ path: "calc/cli.py", bytes: Buffer.from(cli) },
		{
			path: "run.sh",
			bytes: Buffer.from(
				'#!/bin/sh\ncd "$(dirname "$0")" && exec python3 -m calc.cli "$@"\n',
			),
			executable: true,
		},
		{ path: "docs/diagrama.png", bytes: solidPng(16, 16, [90, 160, 90]) },
		{
			path: "dados/log-grande.txt",
			bytes: Buffer.from(
				Array.from(
					{ length: 40_000 },
					(_, i) => `${String(i).padStart(6, "0")} ${"-".repeat(30)}\n`,
				).join(""),
			),
		},
	];
}

/// Seeds the demo repositories of cs101 and cites `lab-calculadora` from two of its meetings.
async function seedRepositories(course: Course["id"]): Promise<void> {
	const lab = await db.repository.upsert(
		{ course, slug: "lab-calculadora" },
		FULL_ACCESS,
	);
	const labRef = { course, slug: lab.slug };
	await commitDemoFiles(
		labRef,
		labCalculadoraFiles("a + b  # bug, fixed in the next commit"),
		"First version of the lab",
	);
	await commitDemoFiles(
		labRef,
		labCalculadoraFiles("a - b"),
		"Fix subtraction",
	);
	for (const [week, slot] of [
		[2, "mon"],
		[2, "wed"],
	] as const) {
		const event = await eventAt(course, week, slot);
		await db.calendarEvent.update(
			{ id: event.id },
			{ repositories: [lab.slug] },
			FULL_ACCESS,
		);
	}

	const examples = await db.repository.upsert(
		{ course, slug: "exemplos-python" },
		FULL_ACCESS,
	);
	await commitDemoFiles(
		{ course, slug: examples.slug },
		[
			{
				path: "fibonacci.py",
				bytes: Buffer.from(
					"def fib(n: int) -> int:\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a\n",
				),
			},
		],
		"Examples",
	);

	await db.repository.upsert({ course, slug: "lab-futuro" }, FULL_ACCESS);

	console.log(`[dev] repository lab-calculadora clones from ${lab.cloneUrl}`);
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
type SeededAnswers = Record<string, QuestionResponse | null>;

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
		"recursion-basics": "base-case",
		"factorial-of-five": 120,
		"base-case-blanks": { stop: "base", smaller: "shorter" },
	});
	await botGrade(hopper["recursion-basics"], "1");
	await botGrade(hopper["factorial-of-five"], "1");
	// "shorter" matches no pattern: the instructor graded that blank on its own.
	await db.feedback.create(
		{
			submission: { publicId: hopper["base-case-blanks"] ?? "" },
			ref: "manual-1",
			score: "0.9",
			grader: "ada",
			blanks: {
				smaller: {
					score: 0.8,
					comment: "Shorter works for lists, not in general.",
				},
			},
		},
		FULL_ACCESS,
	);

	const hamilton = await answerExam(course, exam, students.hamilton, {
		"recursion-basics": "base-case",
		"factorial-of-five": 25,
		"base-case-blanks": { stop: "recursive", smaller: "smaller" },
	});
	await botGrade(hamilton["recursion-basics"], "1");
	await botGrade(hamilton["factorial-of-five"], "0");
	await botGrade(hamilton["base-case-blanks"], "0");

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
 * Seeds three open exams with the same JavaScript code question, one per way
 * the code-run setting can come out.
 *
 * `practice-js` runs code by the PRACTICE default, `quiz-js` does not run it
 * by the QUIZ default, and `test-js` is an EXAM that turns it on explicitly.
 */
async function seedCodeAnswerExams(course: Course["id"]): Promise<void> {
	await db.question.create(
		{
			course,
			slug: "js-sum-of-evens",
			status: "PUBLISHED",
			version: "v1",
			question: {
				type: "essay",
				title: "Sum of the even numbers",
				stem: "Write a program that prints the sum of the even numbers from 1 to 100.\n\nStart from [the loop reference](https://developer.mozilla.org/docs/Web/JavaScript/Guide/Loops_and_iteration).",
				epilogue:
					"Print only the number. Anything else on the output is ignored.",
				tags: ["javascript"],
				content: "code",
				highlight: "javascript",
			},
		},
		FULL_ACCESS,
	);
	await db.question.create(
		{
			course,
			slug: "ts-sum-of-squares",
			status: "PUBLISHED",
			version: "v1",
			question: {
				type: "essay",
				title: "Sum of squares, typed",
				stem: "Write a TypeScript function `sumOfSquares(n: number): number` and print `sumOfSquares(10)`.",
				epilogue: "Print only the number.",
				tags: ["typescript"],
				content: "code",
				highlight: "typescript",
			},
		},
		FULL_ACCESS,
	);
	const questions = [{ slug: "js-sum-of-evens", version: "v1" }];
	await db.exam.create(
		{
			course,
			slug: "practice-js",
			type: "PRACTICE",
			status: "ONGOING",
			title: "Practice: JavaScript loops",
			description: "Code runs in the browser by the practice default.",
			tags: ["javascript", "practice"],
			questions: [...questions, { slug: "ts-sum-of-squares", version: "v1" }],
		},
		FULL_ACCESS,
	);
	await db.exam.create(
		{
			course,
			slug: "quiz-js",
			type: "QUIZ",
			status: "ONGOING",
			title: "Quiz: JavaScript loops",
			description: "Running code is off by the quiz default.",
			duration: { minutes: 30 },
			tags: ["javascript"],
			questions,
		},
		FULL_ACCESS,
	);
	// The quiz default records the edit history; this one switches it off, so the toggle shows both states.
	await db.exam.setAnswerHistory(
		{ course, slug: "quiz-js" },
		false,
		FULL_ACCESS,
	);
	await db.exam.create(
		{
			course,
			slug: "test-js",
			type: "EXAM",
			status: "ONGOING",
			title: "Test: JavaScript loops",
			description: "A graded exam that allows running code.",
			duration: { hours: 1 },
			allowCodeRun: true,
			tags: ["javascript"],
			questions,
		},
		FULL_ACCESS,
	);
}

/// One edit of a seeded history, at `startMs` of its session.
interface SeededEdit {
	position: number;
	deleteCount: number;
	insertedText: string;
	startMs: number;
	durationMs: number;
	kind?: InputKind;
}

/**
 * Sends the batches of one seeded student to the history service, as that student's browser would.
 *
 * It follows the revision and sequence the server expects, so a call only
 * says what was typed. `receivedAt` is when the server saw the batch.
 */
class SeededTyping {
	text = "";
	private revision = 0;
	private seq = 0;
	private count = 0;

	constructor(
		private readonly student: User,
		private readonly ref: {
			course: Course["id"];
			exam: string;
			attempt: string;
		},
		private readonly question: string,
	) {}

	/// Sends one batch of `edits` typed in `session`; `base` starts it from another text, as a rebase does.
	async type(
		session: string,
		receivedAt: Date,
		edits: SeededEdit[],
		base?: { reason: "start" | "rebase"; text: string },
	): Promise<void> {
		const origin = edits[0]?.startMs ?? 0;
		const envelope = encodeEdits(
			edits.map((edit) => ({ kind: "typing", timing: null, ...edit })),
			origin,
		);
		/// The first batch of a field says where it starts from.
		const start =
			base ??
			(this.revision === 0
				? { reason: "start" as const, text: this.text }
				: undefined);
		const from = start?.text ?? this.text;
		const batch: AnswerEditBatchInput = {
			version: 1,
			batchId: `${this.question}-${++this.count}`,
			sessionId: session,
			timeOriginMs: origin,
			baseRevision: this.revision,
			firstSeq: this.seq,
			edits: envelope.edits,
			snapshot: replayEdits(from, envelope),
			...(start ? { base: start } : {}),
		};
		await this.send({ batch }, receivedAt);
		this.revision++;
		this.seq += edits.length;
		this.text = batch.snapshot;
	}

	/// Records that the browser stopped recording, at `receivedAt`.
	async gap(reason: string, receivedAt: Date): Promise<void> {
		await this.send(
			{ gaps: [{ reason, id: `${this.question}-gap` }] },
			receivedAt,
		);
	}

	/// Sends an insertion over the text limit of a field, which the server refuses and marks the field incomplete for.
	async overflow(receivedAt: Date): Promise<void> {
		const edit = {
			position: this.text.length,
			deleteCount: 0,
			insertedText: "x".repeat(MAX_ANSWER_HISTORY_TEXT_BYTES),
			startMs: 0,
			durationMs: 1,
		};
		await this.type("overflow", receivedAt, [edit]);
	}

	private async send(
		item: {
			batch?: AnswerEditBatchInput;
			gaps?: { reason: string; id: string }[];
		},
		now: Date,
	): Promise<void> {
		await db.answerEdit.append(
			{
				...this.ref,
				now,
				fields: [{ question: this.question, field: "answer", ...item }],
			},
			{ actor: this.student },
		);
	}
}

/**
 * Seeds the exams that show every state of the instructor's edit history.
 *
 * In `history-essays` (an exam on the default switch, which records), each
 * student is one situation: hopper typed normally and pasted a block, hamilton
 * has a marker, a rebase and a final gap, liskov hit a limit, bob answered
 * with no recorded typing. `history-off` was recorded and then switched off.
 * `history-practice` is a practice exam on the default, with nothing recorded.
 */
async function seedAnswerEditHistoryExams(
	course: Course["id"],
	students: {
		hopper: User;
		hamilton: User;
		liskov: User;
		bob: User;
		practicing: User;
	},
): Promise<void> {
	const { hopper, hamilton, liskov, bob, practicing } = students;
	const text = "essay-base-case";
	const code = "code-factorial";
	await db.question.create(
		{
			course,
			slug: text,
			status: "PUBLISHED",
			version: "v1",
			question: {
				type: "essay",
				title: "The base case",
				stem: "Explain why a recursive function needs a base case.",
				tags: ["recursion"],
				content: "text",
			},
		},
		FULL_ACCESS,
	);
	await db.question.create(
		{
			course,
			slug: code,
			status: "PUBLISHED",
			version: "v1",
			question: {
				type: "essay",
				title: "Factorial",
				stem: "Write a function `factorial(n)` in JavaScript.",
				tags: ["recursion"],
				content: "code",
				highlight: "javascript",
			},
		},
		FULL_ACCESS,
	);
	const questions = [
		{ slug: text, version: "v1" },
		{ slug: code, version: "v1" },
	];
	for (const [slug, title] of [
		["history-essays", "Edit history: essays"],
		["history-off", "Edit history: recording switched off"],
	] as const) {
		await db.exam.create(
			{
				course,
				slug,
				type: "EXAM",
				status: "ONGOING",
				title,
				description: "Open answers whose typing the browser records.",
				duration: { hours: 2 },
				questions,
			},
			FULL_ACCESS,
		);
	}
	await db.exam.create(
		{
			course,
			slug: "history-practice",
			type: "PRACTICE",
			status: "ONGOING",
			title: "Edit history: practice",
			description:
				"A practice exam on the default switch, which does not record.",
			questions,
		},
		FULL_ACCESS,
	);

	const now = Date.now();
	/// A time `minutes` before the seed ran.
	const ago = (minutes: number) => new Date(now - minutes * 60_000);
	/// Opens an attempt that started `minutes` ago.
	const attempt = async (exam: string, student: User, minutes: number) => {
		const opened = await db.response.create(
			{ course, exam, author: student.username },
			{ actor: student },
		);
		await prisma.response.update({
			where: { publicId: opened.publicId },
			data: { createdAt: ago(minutes) },
		});
		return { course, exam, attempt: opened.publicId };
	};
	const finish = async (exam: string, student: User) => {
		await db.response.finish({ course, exam }, { actor: student });
	};
	const save = async (
		exam: string,
		student: User,
		question: string,
		payload: string,
	) => {
		await db.response.submit(
			{ course, exam, question, payload },
			{ actor: student },
		);
	};
	const definition =
		"A recursive function calls itself, so without a base case it never stops.";
	/// The edits of typing `insertedText` word by word from `position`, starting at `startMs`.
	const typing = (
		startMs: number,
		insertedText: string,
		position: number,
	): SeededEdit[] => {
		let at = position;
		let when = startMs;
		return (insertedText.match(/\S+\s*|\s+/g) ?? []).map((word) => {
			const edit: SeededEdit = {
				position: at,
				deleteCount: 0,
				insertedText: word,
				startMs: when,
				durationMs: 70,
			};
			at += word.length;
			when += 300 + 50 * word.length;
			return edit;
		});
	};

	// Hopper: typed the text, pasted a long block, deleted a few words, then wrote the code.
	{
		const ref = await attempt("history-essays", hopper, 50);
		const essay = new SeededTyping(hopper, ref, text);
		const pasted =
			" Every call works on a smaller input until it reaches the smallest case, where the function answers directly and the calls return one by one.";
		await essay.type("tab-1", ago(44), [
			...typing(1000, "A recursive function", 0),
			...typing(
				9000,
				" calls itself, so without a base case it never stops.",
				20,
			),
		]);
		await essay.type("tab-1", ago(40), [
			{
				position: definition.length,
				deleteCount: 0,
				insertedText: pasted,
				startMs: 31_000,
				durationMs: 120,
				kind: "paste",
			},
			{
				position: 0,
				deleteCount: 2,
				insertedText: "",
				startMs: 140_000,
				durationMs: 300,
				kind: "delete",
			},
		]);
		const program = new SeededTyping(hopper, ref, code);
		await program.type("tab-1", ago(30), [
			...typing(200_000, "function factorial(n) {", 0),
			...typing(
				215_000,
				"\n  return n <= 1 ? 1 : n * factorial(n - 1);\n}",
				23,
			),
		]);
		await save("history-essays", hopper, text, essay.text);
		await save("history-essays", hopper, code, program.text);
		await finish("history-essays", hopper);
	}

	// Hamilton: the browser lost input once, restarted from another text, and the saved answer has more.
	{
		const ref = await attempt("history-essays", hamilton, 55);
		const essay = new SeededTyping(hamilton, ref, text);
		await essay.type("tab-1", ago(48), [
			...typing(1000, "The base case is the quick way out.", 0),
		]);
		await essay.gap("input-lost", ago(42));
		await essay.type(
			"tab-2",
			ago(36),
			typing(500, " Without it the calls never return.", 34),
			{ reason: "rebase", text: "The base case is the slow way out." },
		);
		await save(
			"history-essays",
			hamilton,
			text,
			`${essay.text} It also bounds the stack.`,
		);
		await finish("history-essays", hamilton);
	}

	// Liskov: the text outgrew what a field records, so the history stops at the first batch.
	{
		const ref = await attempt("history-essays", liskov, 45);
		const essay = new SeededTyping(liskov, ref, text);
		await essay.type("tab-1", ago(40), typing(1000, definition, 0));
		await essay.overflow(ago(35));
		await save("history-essays", liskov, text, definition);
		await finish("history-essays", liskov);
	}

	// Bob: answered, but no typing reached the server.
	await attempt("history-essays", bob, 30);
	await save("history-essays", bob, text, definition);
	await finish("history-essays", bob);

	// Hopper again, on the exam that is switched off afterwards: what was recorded stays.
	{
		const ref = await attempt("history-off", hopper, 40);
		const essay = new SeededTyping(hopper, ref, text);
		await essay.type("tab-1", ago(30), [
			...typing(1000, definition, 0),
			...typing(50_000, " It is the exit.", definition.length),
		]);
		await save("history-off", hopper, text, essay.text);
		await finish("history-off", hopper);
	}
	await db.exam.setAnswerHistory(
		{ course, slug: "history-off" },
		false,
		FULL_ACCESS,
	);

	// A student practices: the default does not record, so nothing is kept.
	await save("history-practice", practicing, text, definition);
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
	await db.question.create(
		{
			course,
			slug: "factorial-lines",
			status: "PUBLISHED",
			version: "v1",
			question: {
				type: "ordering",
				title: "Recursive factorial",
				stem: "Sort and indent the lines into a recursive `factorial(n)`. One line is not part of it.",
				tags: ["recursion"],
				content: "code",
				highlight: "python",
				indentation: "strict",
				lines: [
					[0, "def factorial(n):"],
					[1, "if n == 0:"],
					[2, "return 1"],
					[1, "return n * factorial(n - 1)"],
				],
				extra: [[1, "return factorial(n)"]],
				incorrectFeedback: "The base case comes before the recursive call.",
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
				{ slug: "factorial-lines", version: "v1" },
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
				content: "text",
			},
		},
		FULL_ACCESS,
	);
	await db.question.create(
		{
			course,
			slug: "factorial-returns",
			status: "PUBLISHED",
			version: "v1",
			question: {
				type: "ordering",
				title: "Returns of factorial(3)",
				stem: "In what order do the calls of `factorial(3)` return?",
				tags: ["recursion"],
				content: "text",
				// An order nobody keyed waits for the instructor instead of scoring 0.
				unmatched: "manual",
				lines: [
					[0, "factorial(0) returns 1"],
					[0, "factorial(1) returns 1"],
					[0, "factorial(2) returns 2"],
					[0, "factorial(3) returns 6"],
				],
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
				{ slug: "factorial-returns", version: "v1" },
				{ slug: "base-case-blanks", version: "v1" },
				{ slug: "explain-recursion", version: "v1" },
			],
		},
		FULL_ACCESS,
	);

	// Hopper: objective answers graded by the bot, the essay still pending.
	const hopper = await answerExam(course, exam, students.hopper, {
		"recursion-basics": "base-case",
		"factorial-of-five": 120,
		"factorial-returns": [
			[0, "factorial(0) returns 1"],
			[0, "factorial(1) returns 1"],
			[0, "factorial(2) returns 2"],
			[0, "factorial(3) returns 6"],
		],
		// "lighter" matches no pattern, so the blank waits for the instructor.
		"base-case-blanks": { stop: "base", smaller: "lighter" },
		"explain-recursion":
			"Each call must get closer to a case it can answer without calling itself. Without it the calls never stop and the stack overflows.",
	});
	await botGrade(hopper["recursion-basics"], "1");
	await botGrade(hopper["factorial-of-five"], "1");
	await botGrade(hopper["factorial-returns"], "1");

	// Hamilton: everything graded but the ordering, the essay by the instructor with a comment.
	const hamilton = await answerExam(course, exam, students.hamilton, {
		"recursion-basics": "tail-call",
		"factorial-of-five": 100,
		// The order of the calls, not of the returns: matches no key, so it is pending.
		"factorial-returns": [
			[0, "factorial(3) returns 6"],
			[0, "factorial(2) returns 2"],
			[0, "factorial(1) returns 1"],
			[0, "factorial(0) returns 1"],
		],
		"explain-recursion":
			"The base case is where the function returns a value directly.",
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
		"recursion-basics": "base-case",
		"explain-recursion": "",
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
		"recursion-basics": "tail-call",
		"explain-recursion":
			"Recursion is when a function calls itself until it is done.",
	});

	await db.exam.update(
		{ course, slug: exam },
		{ status: "COMPLETED" },
		FULL_ACCESS,
	);
}

/**
 * Closes an exam with a Prolog code question for a grading runner to correct.
 *
 * Four answers wait for a grade: one correct, one that still leans on CLP(FD)
 * and so inverts the relation, one that does not load, and one the bot
 * `runner` already graded with notes for the instructor.
 */
async function seedCodeExam(
	course: Course["id"],
	students: { hopper: User; hamilton: User; liskov: User; bob: User },
): Promise<void> {
	const exam = "test-06";
	const question = "prolog-factorial-with-is";

	await db.question.create(
		{
			course,
			slug: question,
			status: "PUBLISHED",
			version: "v1",
			question: {
				type: "essay",
				title: "Factorial in Prolog, without CLP(FD)",
				stem: "Define `factorial(N, F)` so that `F` is the factorial of `N`. Use `is`, not `clpfd`.",
				tags: ["prolog"],
				content: "code",
				highlight: "prolog",
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
			title: "Test 6: Prolog",
			description: "A code answer for a grading runner.",
			tags: ["prolog"],
			questions: [{ slug: question, version: "v1" }],
		},
		FULL_ACCESS,
	);

	await answerExam(course, exam, students.hopper, {
		[question]: [
			"factorial(0, 1).",
			"factorial(N, F) :-",
			"    N > 0,",
			"    M is N - 1,",
			"    factorial(M, G),",
			"    F is N * G.",
		].join("\n"),
	});
	await answerExam(course, exam, students.hamilton, {
		[question]: [
			":- use_module(library(clpfd)).",
			"factorial(0, 1).",
			"factorial(N, F) :-",
			"    N #> 0,",
			"    M #= N - 1,",
			"    F #= N * G,",
			"    factorial(M, G).",
		].join("\n"),
	});
	await answerExam(course, exam, students.liskov, {
		[question]: ["factorial(0, 1)", "factorial(N, F) :- N > 0, F is N *"].join(
			"\n",
		),
	});
	const bob = await answerExam(course, exam, students.bob, {
		[question]: [
			"factorial(0, 1).",
			"factorial(N, F) :- N > 0, M is N - 1, factorial(M, G), F is N * G.",
			"% factorial(10, 3628800).",
		].join("\n"),
	});
	await db.feedback.create(
		{
			submission: { publicId: bob[question] ?? "" },
			ref: "auto-1",
			score: "1",
			bot: "runner",
			feedback: "All tests passed.",
			notes: "The answer hard-codes an expected output in a comment.",
		},
		FULL_ACCESS,
	);

	await db.exam.update(
		{ course, slug: exam },
		{ status: "COMPLETED" },
		FULL_ACCESS,
	);
}

/**
 * Closes an exam with a JavaScript and a Python code question, so the grading
 * page can run every kind of answer.
 *
 * JavaScript, one answer per student: correct, throws, loops forever, reads a
 * line with `prompt`. Python: correct, a `NameError`, a long output, a loop
 * that never ends. All of them wait for a grade.
 */
async function seedRunnableCodeExam(
	course: Course["id"],
	students: { hopper: User; hamilton: User; liskov: User; bob: User },
): Promise<void> {
	const exam = "test-runnable";
	const js = "js-double-it";
	const py = "py-count-up";

	for (const question of [
		{
			slug: js,
			title: "Double the number",
			stem: "Read a number and print its double.",
			language: "javascript",
		},
		{
			slug: py,
			title: "Count up",
			stem: "Print the numbers from 1 to `n`, one per line, where `n` is read from the input.",
			language: "python",
		},
	]) {
		await db.question.create(
			{
				course,
				slug: question.slug,
				status: "PUBLISHED",
				version: "v1",
				question: {
					type: "essay",
					title: question.title,
					stem: question.stem,
					tags: [question.language],
					content: "code",
					highlight: question.language,
				},
			},
			FULL_ACCESS,
		);
	}
	await db.exam.create(
		{
			course,
			slug: exam,
			type: "EXAM",
			status: "ONGOING",
			title: "Test 8: runnable answers",
			description:
				"Code answers the grader can run: they work, fail, loop and ask for input.",
			tags: ["javascript", "python"],
			questions: [
				{ slug: js, version: "v1" },
				{ slug: py, version: "v1" },
			],
		},
		FULL_ACCESS,
	);

	await answerExam(course, exam, students.hopper, {
		[js]: 'const n = Number(prompt("Number?"));\nconsole.log(n * 2);',
		[py]: "n = int(input())\nfor i in range(1, n + 1):\n    print(i)",
	});
	await answerExam(course, exam, students.hamilton, {
		[js]: 'const n = Number(prompt("Number?"));\nconsole.log(doubled(n));',
		[py]: "n = int(input())\nfor i in range(1, n + 1):\n    print(j)",
	});
	await answerExam(course, exam, students.liskov, {
		[js]: "let n = 1;\nwhile (true) {\n  n = n * 2;\n}",
		[py]: "n = int(input())\nfor i in range(1, 200000):\n    print(f'line {i}: ' + 'x' * 40)",
	});
	await answerExam(course, exam, students.bob, {
		[js]: 'console.log(Number(prompt("Number?")) * 2);',
		[py]: "n = int(input())\ni = 1\nwhile True:\n    i += 1",
	});

	await db.exam.update(
		{ course, slug: exam },
		{ status: "COMPLETED" },
		FULL_ACCESS,
	);
}

/**
 * Closes an exam with released grades, where one question is graded with a rubric.
 *
 * The code question carries an initial rubric in its question version and no
 * pass uses it yet. The essay question's rubric is in use: group leaves three
 * levels deep, two standalone items (one negative) and an item that was split,
 * which Liskov's pass still applies. Hopper's pass is a group leaf plus an
 * item, Hamilton's adds an adjustment, and the bot `runner` graded Bob. Three
 * answers are left pending, two of them the same text up to whitespace.
 */
async function seedRubricExam(
	course: Course["id"],
	instructor: User,
	students: { hopper: User; hamilton: User; liskov: User; bob: User },
	cohort: User[],
): Promise<void> {
	const exam = "test-07";
	const code = "prolog-comprimento-de-lista";
	const essay = "prolog-caso-base";
	const [knuth, ritchie, thompson, backus] = cohort;
	if (!knuth || !ritchie || !thompson || !backus) {
		throw new Error("The seeded cohort is too small.");
	}

	const rubric = [
		{
			id: "vazia",
			path: "Recursão/Caso base",
			value: "0.3",
			text: "Trata a lista vazia",
			comment: "Basta a cláusula comprimento([], 0).",
			feedback: "Sua solução trata a lista vazia corretamente.",
		},
		{
			id: "passo",
			path: "Recursão/Passo",
			value: "0.5",
			text: "Passo recursivo correto",
			feedback: "O passo recursivo soma um ao comprimento da cauda.",
		},
		{
			id: "length",
			value: "-0.5",
			text: "Usa length/2",
			comment: "O enunciado proíbe o predicado embutido.",
		},
	];
	await db.question.create(
		{
			course,
			slug: code,
			status: "PUBLISHED",
			version: "v1",
			question: {
				type: "essay",
				title: "Comprimento de uma lista em Prolog",
				stem: "Defina `comprimento(Lista, N)` de modo que `N` seja o número de elementos de `Lista`. Não use `length/2`.",
				tags: ["prolog"],
				content: "code",
				highlight: "prolog",
			},
		},
		FULL_ACCESS,
	);
	// The question document has no rubric field, so the initial rubric is
	// written into the stored version the way a pushed question carries it.
	const stored = await prisma.questionData.findFirstOrThrow({
		where: { versionHash: "v1", ref: { courseId: course, slug: code } },
	});
	await prisma.questionData.update({
		where: { id: stored.id },
		data: {
			privatePayload: {
				...(stored.privatePayload as Record<string, unknown>),
				rubric,
			},
		},
	});
	await db.question.create(
		{
			course,
			slug: essay,
			status: "PUBLISHED",
			version: "v1",
			question: {
				type: "essay",
				title: "O caso base da recursão em Prolog",
				stem: "Por que um predicado recursivo em Prolog precisa de uma cláusula para o caso base? O que acontece com `comprimento/2` sem ela?",
				tags: ["prolog", "recursion"],
				content: "text",
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
			title: "Test 7: rubrics",
			description: "Grades out, one question graded with a rubric.",
			tags: ["prolog"],
			questions: [
				{ slug: code, version: "v1" },
				{ slug: essay, version: "v1" },
			],
		},
		FULL_ACCESS,
	);

	const pk = { course, exam, question: essay };
	await db.rubric.update(pk, { base: "0" }, FULL_ACCESS);
	const items = [
		{
			key: "correta",
			group: "Recursão",
			text: "Correta",
			value: "0.5",
			comment: "Cita a parada da recursão e o que ela garante.",
			feedback: "Você explicou bem por que a recursão termina.",
		},
		{
			key: "esqueceu",
			group: "Recursão/Errada/Caso base",
			text: "Esqueceu o caso base",
			value: "0.2",
			feedback: "Sem caso base a recursão não para; faltou dizer isso.",
		},
		{
			key: "inacessivel",
			group: "Recursão/Errada/Caso base",
			text: "Caso base inacessível",
			value: "0.3",
			comment: "A cláusula existe, mas fica depois de uma que sempre casa.",
			feedback:
				"O caso base precisa vir antes da cláusula recursiva, ou a busca nunca chega nele.",
		},
		{
			key: "errado",
			group: "Recursão/Errada",
			text: "Caso base errado",
			value: "0.1",
			feedback: "O caso base que você citou não cobre a lista vazia.",
		},
		{
			key: "pilha",
			group: null,
			text: "Descreve o estouro de pilha sem o caso base",
			value: "0.4",
			feedback: "Boa descrição do estouro de pilha.",
		},
		{
			key: "is-livre",
			group: null,
			text: "Usa is com variável livre",
			value: "-0.1",
			comment: "Exemplo com `X is Y + 1` sem Y instanciado.",
			feedback: "O `is` exige o lado direito instanciado.",
		},
		{
			key: "vaga",
			group: null,
			text: "Explicação vaga",
			value: "0.2",
			comment: "Diz que precisa parar, sem dizer como.",
		},
	];
	for (const item of items) {
		await db.rubric.createItem({ ...pk }, item, FULL_ACCESS);
	}

	const text = {
		hopper:
			"Sem o caso base, `comprimento/2` chama a si mesmo sem parar e a pilha estoura. A cláusula `comprimento([], 0)` encerra a recursão.",
		hamilton:
			"O caso base deveria ser `comprimento([_], 1)`, mas assim a lista vazia nunca casa. Sem ele a pilha de chamadas cresce até estourar.",
		liskov: "Precisa para a recursão parar em algum momento.",
		bob: "Se a lista vazia ficar sem cláusula, a consulta falha ou entra em laço. O caso base fica antes da recursiva e usa `[]`.",
		same: "Sem a cláusula do caso base a recursão não tem onde parar, e o Prolog continua tentando até acabar a memória.",
		other:
			"O caso base é a resposta que não depende de chamada recursiva. Ele ancora a definição indutiva do predicado.",
	};
	const answer = (student: User, solution: string, essayText: string) =>
		answerExam(course, exam, student, { [code]: solution, [essay]: essayText });
	const listing = (...lines: string[]) => lines.join("\n");

	const hopper = await answer(
		students.hopper,
		listing(
			"comprimento([], 0).",
			"comprimento([_|T], N) :- comprimento(T, M), N is M + 1.",
		),
		text.hopper,
	);
	const hamilton = await answer(
		students.hamilton,
		listing(
			"comprimento([_], 1).",
			"comprimento([_|T], N) :- comprimento(T, M), N is M + 1.",
		),
		text.hamilton,
	);
	const liskov = await answer(students.liskov, "length(L, N).", text.liskov);
	const bob = await answer(
		students.bob,
		listing(
			"comprimento([_|T], N) :- comprimento(T, M), N is M + 1.",
			"comprimento([], 0).",
		),
		text.bob,
	);
	await answer(
		knuth,
		listing(
			"comprimento([], 0).",
			"comprimento([_|T], N) :- comprimento(T, M), N is M + 1.",
		),
		text.same,
	);
	await answer(
		ritchie,
		listing(
			"comprimento([], 0).",
			"comprimento([_|T], N) :- comprimento(T, M), N is M + 1.",
		),
		`  ${text.same.replace(", e o", ",   e o")}\n`,
	);
	await answer(thompson, "comprimento(L, N) :- length(L, N).", text.other);

	const graded = (student: Record<string, string>) => ({
		publicId: student[essay] ?? "",
	});
	const as = { actor: instructor };
	await db.feedback.create(
		{
			submission: graded(hopper),
			ref: "rubric-1",
			rubric: ["correta", "pilha"],
			feedback: "Resposta completa.",
		},
		as,
	);
	await db.feedback.create(
		{
			submission: graded(hamilton),
			ref: "rubric-1",
			rubric: ["errado", "pilha"],
			adjustment: "0.2",
			feedback: "O caso base está errado, mas o resto está bem explicado.",
		},
		as,
	);
	await db.feedback.create(
		{
			submission: graded(liskov),
			ref: "rubric-1",
			rubric: ["vaga", "is-livre"],
		},
		as,
	);
	await db.feedback.create(
		{
			submission: graded(bob),
			ref: "auto-1",
			bot: "runner",
			rubric: ["inacessivel", "pilha"],
			notes: "Cláusulas na ordem trocada; o caso base nunca é alcançado.",
		},
		FULL_ACCESS,
	);

	await db.rubric.splitItem(
		{ ...pk, key: "vaga" },
		{
			children: [
				{
					key: "so-parada",
					group: "Explicação vaga",
					text: "Fala só da parada",
					value: "0.2",
				},
				{
					key: "sem-motivo",
					group: "Explicação vaga",
					text: "Não diz por que a pilha estoura",
					value: "0.1",
				},
			],
		},
		FULL_ACCESS,
	);

	await db.exam.update(
		{ course, slug: exam },
		{
			status: "COMPLETED",
			scheduledAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
			duration: { hours: 1 },
		},
		FULL_ACCESS,
	);
	// `releaseGrades` refuses while answers wait for a grade, and this exam
	// keeps some on purpose, so the release is stamped directly.
	await prisma.exam.updateMany({
		where: { courseId: course, slug: exam },
		data: { gradesReleasedAt: new Date() },
	});
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
		"recursion-basics": "base-case",
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
		"recursion-basics": "base-case",
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
	const rows: [string, QuestionResponse, string][][] = [
		[
			["fastest-sort", "merge", "1"],
			["n-log-n", ["merge", "quick"], "1"],
			["stack-facts", { lifo: true, fifo: false, push: true }, "1"],
			["pivot-trap", "linearithmic", "0"],
			["factorial-of-five", 120, "1"],
			["stack-top", "top", "1"],
		],
		[
			["fastest-sort", "merge", "1"],
			["n-log-n", ["merge", "quick"], "1"],
			["stack-facts", { lifo: true, fifo: false, push: true }, "1"],
			["pivot-trap", "linearithmic", "0"],
			["factorial-of-five", 120, "1"],
			["stack-top", "top", "1"],
		],
		[
			["fastest-sort", "merge", "1"],
			["n-log-n", ["merge", "quick"], "1"],
			["stack-facts", { lifo: true, fifo: false, push: true }, "1"],
			["pivot-trap", "linearithmic", "0"],
			["factorial-of-five", 120, "1"],
			["stack-top", "top", "1"],
		],
		[
			["fastest-sort", "insertion", "0"],
			["n-log-n", ["merge"], "0.5"],
			["stack-facts", { lifo: true, fifo: false }, "0.67"],
			["pivot-trap", "linearithmic", "0"],
			["factorial-of-five", 120, "1"],
			["stack-top", "top", "1"],
		],
		[
			["fastest-sort", "merge", "1"],
			["n-log-n", ["merge", "quick", "bubble"], "0.5"],
			["stack-facts", { lifo: true, fifo: true, push: true }, "0.33"],
			["pivot-trap", "quadratic", "1"],
			["factorial-of-five", 120, "1"],
			["stack-top", "top", "1"],
		],
		[
			["fastest-sort", "bubble", "0"],
			["n-log-n", ["merge"], "0.5"],
			["stack-facts", { lifo: true, fifo: false, push: true }, "1"],
			["pivot-trap", "quadratic", "1"],
			["factorial-of-five", 100, "0"],
			["stack-top", "top", "1"],
		],
		[
			["fastest-sort", "bubble", "0"],
			["n-log-n", [], "0"],
			["stack-facts", { lifo: false, fifo: true, push: false }, "0"],
			["pivot-trap", "quadratic", "1"],
			["factorial-of-five", 100, "0"],
			["stack-top", "top", "1"],
		],
		[
			["fastest-sort", "bubble", "0"],
			["n-log-n", ["bubble"], "0"],
			["stack-facts", { lifo: false, fifo: true, push: false }, "0"],
			["pivot-trap", "quadratic", "1"],
			["factorial-of-five", 24, "0"],
			["stack-top", "top", "1"],
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
 * The dev student has an open request on one wrong answer, an accepted one
 * on another, and can still ask for a regrade of the right one. Hopper's was
 * accepted with a new score and Hamilton's rejected.
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
				{ slug: "fastest-sort", version: "v1" },
			],
		},
		FULL_ACCESS,
	);
	const own = await answerExam(course, exam, student, {
		"recursion-basics": "tail-call",
		"factorial-of-five": 120,
		"fastest-sort": "bubble",
	});
	await botGrade(own["recursion-basics"], "0");
	await botGrade(own["factorial-of-five"], "1");
	await botGrade(own["fastest-sort"], "0");
	const hopper = await answerExam(course, exam, students.hopper, {
		"recursion-basics": "tail-call",
		"factorial-of-five": 120,
	});
	await botGrade(hopper["recursion-basics"], "0");
	await botGrade(hopper["factorial-of-five"], "1");
	const hamilton = await answerExam(course, exam, students.hamilton, {
		"recursion-basics": "base-case",
		"factorial-of-five": 25,
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
	const ownAccepted = await ask(
		student,
		own["fastest-sort"],
		"Bubble sort is O(n log n) with an early exit on sorted input, I think.",
	);
	await db.regradeRequest.accept(
		{ publicId: ownAccepted.publicId },
		{
			score: "0.5",
			reply:
				"Partial credit: the early exit is real, but the worst case is not.",
		},
		{ actor: instructor },
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
