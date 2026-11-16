import { readFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { type CodeQuestion, parse, resolveTests } from "mdq";
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
import type { IsoDate } from "@/typing/iso-date";
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

	const accounts = new Map<string, User>();
	for (const [username, name, role, email] of [
		["ada", "Ada Lovelace", "INSTRUCTOR", "ada@codehood.local"],
		["alan", "Alan Turing", "INSTRUCTOR", "alan.turing@codehood.local"],
		["hopper", "Grace Hopper", "STUDENT"],
		["hamilton", "Margaret Hamilton", "STUDENT"],
		["liskov", "Barbara Liskov", "STUDENT"],
		["bob", "Bob Martin", "STUDENT"],
		["dijkstra", "Edsger Dijkstra", "STUDENT"],
		["wirth", "Niklaus Wirth", "STUDENT"],
		["knuth", "Donald Knuth", "STUDENT"],
		["ritchie", "Dennis Ritchie", "STUDENT"],
		["thompson", "Ken Thompson", "STUDENT"],
		["backus", "John Backus", "STUDENT"],
	] as const) {
		accounts.set(
			username,
			await demoUser({
				email: email ?? `${username}@codehood.local`,
				username,
				name,
				role,
				password: username,
			}),
		);
	}
	const account = (username: string): User => accounts.get(username) as User;
	const [ada, alan, hopper, hamilton, liskov, bob, dijkstra, wirth] = [
		"ada",
		"alan",
		"hopper",
		"hamilton",
		"liskov",
		"bob",
		"dijkstra",
		"wirth",
	].map(account) as [User, User, User, User, User, User, User, User];
	const cohort = ["knuth", "ritchie", "thompson", "backus"].map(account);

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
		startDate: liveStart,
		endDate: liveEnd,
	};
	const past = {
		slug: editionSlugOf(localDateOf(pastStart)),
		name: editionNameOf(localDateOf(pastStart)),
		startDate: localDateOf(pastStart),
		endDate: localDateOf(pastEnd),
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
			startDate: live.startDate,
			endDate: live.endDate,
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
			startDate: live.startDate,
			endDate: live.endDate,
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
	await createResource(
		cs101.id,
		"syllabus",
		"Syllabus",
		{
			type: "FILE",
			buffer: syllabusFileBuffer,
			filename: "syllabus.txt",
		},
		"syllabus-hash",
		"Grading, schedule, and course policy.",
	);
	await createResource(
		cs101.id,
		"sicp-ch1",
		"SICP, chapter 1",
		{
			type: "LINK",
			url: "https://mitp-content-server.mit.edu/books/content/sectbyfn/books_pres_0/6515/sicp.zip/full-text/book/book-Z-H-10.html",
		},
		"demo-sicp-v1",
	);
	await createResource(
		cs101.id,
		"toolchain",
		"Setting up your toolchain",
		{
			type: "MD",
			content:
				"Install Node 22 and `pnpm`, then run `pnpm dev`.\n\n- Clone the course repository\n- Run `pnpm install`\n- Ask on the forum if anything fails",
		},
		"demo-toolchain-v1",
		"Local dev environment, in three steps.",
	);
	// One resource per language of the code runner.
	for (const [slug, title, language, description, content] of [
		[
			"factorial",
			"factorial.py",
			"python",
			undefined,
			"def factorial(n):\n    return 1 if n <= 1 else n * factorial(n - 1)\n\n\nprint(factorial(5))\n",
		],
		[
			"prolog-factorial",
			"factorial.pl",
			"prolog",
			"Consulted on Run; then query it at the Prolog prompt.",
			[
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
		],
		[
			"python-greet",
			"greet.py",
			"python",
			"Reads a name with input() and greets it.",
			'name = input("What is your name? ")\nprint("Hello, " + name + "!")\n',
		],
		[
			"lua-greet",
			"greet.lua",
			"lua",
			"Reads a name with io.read and greets it.",
			'io.write("What is your name? ")\nlocal name = io.read("l")\nprint("Hello, " .. name .. "!")\n',
		],
		[
			"scheme-greet",
			"greet.scm",
			"scheme",
			"Reads a name with read-line; an error reports its top-level form.",
			[
				"(define (greet name)",
				'  (string-append "Hello, " name "!"))',
				"",
				'(display "What is your name? ")',
				"(display (greet (read-line)))",
				"(newline)",
				"",
			].join("\n"),
		],
		[
			"ts-greet",
			"greet.ts",
			"typescript",
			"Types are removed, not checked; prompt() reads a name.",
			[
				"interface Greeting {",
				"  name: string;",
				"}",
				"",
				'const who: Greeting = { name: prompt("What is your name?") ?? "" };',
				"console.log('Hello, ' + who.name + '!');",
				"",
			].join("\n"),
		],
		[
			"elm-lists",
			"Lists.elm",
			"elm",
			"Run compiles it and runs `tests` (one fails on purpose), then opens the REPL.",
			[
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
		],
		[
			"elm-repl",
			"Shapes.elm",
			"elm",
			"No tests: Run opens the REPL with these definitions.",
			[
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
		],
	] as const) {
		await createResource(
			cs101.id,
			slug,
			title,
			{ type: "CODE", language, content },
			`demo-${slug}-v1`,
			description,
		);
	}
	await createResource(
		cs101.id,
		"elm-notes",
		"Elm notes",
		{
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
				"",
				"<!-- This comment is an authoring note and is not rendered. -->",
				"",
				"Press <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to run. Squaring costs O(n<sup>2</sup>) digit steps.",
				"",
				"<details>",
				"<summary>Why `square`?</summary>",
				"",
				"A small pure function is the easiest thing to try in the REPL.",
				"",
				"</details>",
			].join("\n"),
		},
		"demo-elm-notes-v1",
		"A runnable Elm block in a note.",
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
		await createResource(
			cs101.id,
			slug,
			title,
			{ type: "CODE", language: "javascript", content },
			`demo-${slug}-v1`,
			description,
		);
	}
	await createResource(
		cs101.id,
		"js-notes",
		"JavaScript notes",
		{
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
		"demo-js-notes-v1",
		"Runnable blocks, a static one and one without a driver.",
	);

	// cs201 gets one resource of its own, so /admin/courses does not look like
	// resources only ever land on the first course seeded.
	await createResource(
		cs201.id,
		"when-to-use-what",
		"Which structure, when",
		{
			type: "MD",
			content:
				"Need order-preserving iteration? Array or linked list.\n\nNeed fast lookup by key? Hash table.\n\nNeed sorted order *and* fast insert? Balanced tree.\n\nWhen in doubt, start with an array. You can always change it once a profiler tells you to.",
		},
		"demo-when-to-use-v1",
		"A rule of thumb for picking a structure under time pressure.",
	);
	// A weekly pattern plus a few weeks of the term calendar for each course, so
	// /calendar, /<course>/schedule, and the course home page all have real
	// data to render. cs101 gets a holiday and a cancelled lab so the muted/
	// struck-through rendering has something to show, and descriptions from
	// none to a full lesson plan, so the schedule shows how they sit together.
	const cs101Mon = await createSlot(
		cs101.id,
		"mon",
		"Lecture",
		"MONDAY",
		{ hour: 14, minute: 0 },
		{ hours: 2 },
	);
	const cs101Wed = await createSlot(
		cs101.id,
		"wed",
		"Lab",
		"WEDNESDAY",
		{ hour: 14, minute: 0 },
		{ hours: 2 },
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
		(Date.parse(`${localDateOf(new Date())}T00:00:00Z`) -
			Date.parse(`${courseWeekZero(cs101.startDate)}T00:00:00Z`)) /
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
	const cs101Today = await createSlot(
		cs101.id,
		"office-hours",
		"Office hours",
		weekdayOf(new Date()),
		{ hour: 22, minute: 0 },
		{ hours: 1, minutes: 59 },
	);
	const todayWeek = [weeksSoFar - 1, weeksSoFar, weeksSoFar + 1].find(
		(week) =>
			week >= 0 &&
			localDateOf(
				slotInstant(cs101.startDate, cs101Today.day, week, 22 * 60),
			) === localDateOf(new Date()),
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
		(Date.parse(`${cs101.endDate}T00:00:00Z`) -
			Date.parse(`${cs101.startDate}T00:00:00Z`)) /
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

	const cs201Mon = await createSlot(
		cs201.id,
		"mon",
		"Lecture",
		"MONDAY",
		{ hour: 10, minute: 0 },
		{ hours: 1, minutes: 30 },
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
	await createQuestion(cs101.id, "recursion-basics", {
		type: "multiple-choice",
		title: "Recursion basics",
		stem: [
			"Which of the following is required for a recursive function such as `countdown` to terminate?",
			"",
			"```python",
			"def countdown(n):",
			"    if n == 0:",
			'        return "liftoff"',
			"    return countdown(n - 1)",
			"```",
		].join("\n"),
		tags: ["recursion", "functions"],
		choices: [
			{ id: "base-case", text: "A base case", score: 1 },
			{ id: "tail-call", text: "A tail call" },
		],
	});
	await createQuestion(cs101.id, "loop-invariants", {
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
	});
	await createQuestion(cs101.id, "factorial-of-five", {
		type: "numeric",
		title: "Factorial of five",
		stem: "What is 5! (five factorial)?",
		tags: ["recursion"],
		answer: 120,
		domain: "integer",
	});
	await createQuestion(
		cs101.id,
		"big-o-warmup",
		{
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
		"DRAFT",
	);

	await createQuestion(cs201.id, "bst-lookup", {
		type: "multiple-choice",
		title: "BST lookup complexity",
		stem: "In a balanced binary search tree, what is the worst-case time complexity of a lookup?",
		tags: ["trees", "complexity"],
		choices: [
			{ id: "log-n", text: "O(log n)", score: 1 },
			{ id: "n", text: "O(n)" },
		],
	});
	// A blank that matches no pattern goes to the instructor, who grades it on its own.
	await createQuestion(cs101.id, "base-case-blanks", {
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
	});

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
			// Under a week ahead, so a seed run in the morning still lists it as coming up.
			scheduledAt: toInstant(
				localDateOf(new Date(Date.now() + 6 * 24 * 3600 * 1000)),
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
	await seedReleasedQuiz(cs101, { hopper, hamilton });
	await seedElmQuestion(cs101.id);
	await seedGradingShowcase(cs101.id, ada, {
		hopper,
		hamilton,
		liskov,
		bob,
		knuth: cohort[0] as User,
		ritchie: cohort[1] as User,
		thompson: cohort[2] as User,
		backus: cohort[3] as User,
	});
	await seedExternalGradingExams(cs101.id, ada, {
		hopper,
		hamilton,
		liskov,
		bob,
		knuth: cohort[0] as User,
		ritchie: cohort[1] as User,
		thompson: cohort[2] as User,
		backus: cohort[3] as User,
	});
	await seedHistoryOffExam(cs101.id, hopper);
	await seedGradeColumns(cs101.id, { hopper, hamilton, liskov, dijkstra });
	await seedRollCalls(cs101.id, {
		hopper,
		hamilton,
		liskov,
		bob,
		dijkstra,
		wirth,
	});

	await seedMidtermException(cs101.id);
	await seedReleasedExam(cs101.id, ada, [
		hopper,
		hamilton,
		...cohort,
		liskov,
		bob,
	]);

	await seedAttachments(cs101.id);
	await seedOpenQuiz(cs101.id, cohort[0] as User);
	await seedPracticeAndSimulations(cs101.id, ada);
	await seedRepositories(cs101.id);
	await seedClassroomInvites(cs101.id, ada);

	await seedTreesExam(cs201.id, { liskov, bob });

	// An ended course in the past edition, so admin views keep an expired one.
	const ended = await db.course.create(
		{
			discipline: "cs101",
			instructor: ada.username,
			edition: past.slug,
			description: "Last term's run of the course, already over.",
			startDate: past.startDate,
			endDate: past.endDate,
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

/// A one-page PDF with one line of Helvetica text, with exact xref offsets.
function minimalPdf(line: string): Buffer {
	const stream = `BT /F1 18 Tf 72 720 Td (${line}) Tj ET`;
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];
	let pdf = "%PDF-1.4\n";
	const offsets = objects.map((body, i) => {
		const offset = pdf.length;
		pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
		return offset;
	});
	const xref = pdf.length;
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets) {
		pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
	}
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(pdf, "latin1");
}

/**
 * Seeds question and exam attachments: fenced and linked files, a linked PDF,
 * a question whose linked CSV changes between versions, an exam open to the
 * dev student with its own files, and a scheduled exam that keeps them shut.
 */
async function seedAttachments(course: Course["id"]): Promise<void> {
	const csv = Buffer.from("x,y\n1,2\n3,5\n", "utf8");
	const csvHash = hashBytes(csv);
	const csvV2 = Buffer.from("x,y\n1,2\n3,5\n4,7\n", "utf8");
	const csvV2Hash = hashBytes(csvV2);
	const pdf = minimalPdf("Reference sheet: recursion lab");
	const pdfHash = hashBytes(pdf);
	const schedule = Buffer.from("day,room\n1,A1\n2,B2\n", "utf8");
	const scheduleHash = hashBytes(schedule);

	await db.question.create(
		{
			course,
			slug: "csv-attachments",
			status: "PUBLISHED",
			version: "v1",
			question: {
				type: "multiple-choice",
				title: "Reading the data file",
				stem: "Look at the attached `data.csv`. Which row has the largest `y`?",
				tags: ["attachments"],
				attachments: [
					{
						name: "notes.txt",
						format: "txt",
						text: "Each row is one measurement.",
					},
					{ name: "data.csv", format: "csv", origin: "data.csv" },
				],
				choices: [
					{ id: "row-2", text: "Row 2", score: 1 },
					{ id: "row-1", text: "Row 1" },
				],
			},
			files: { "data.csv": csvHash },
			blobs: { [csvHash]: csv },
		},
		FULL_ACCESS,
	);
	await db.question.create(
		{
			course,
			slug: "pdf-attachment",
			status: "PUBLISHED",
			version: "v1",
			question: {
				type: "multiple-choice",
				title: "Reading the reference sheet",
				stem: "The attached PDF is the reference sheet for this lab. Which tool does it name?",
				tags: ["attachments"],
				attachments: [
					{ name: "reference.pdf", format: "pdf", origin: "reference.pdf" },
				],
				choices: [
					{ id: "sheet", text: "The reference sheet", score: 1 },
					{ id: "none", text: "No tool" },
				],
			},
			files: { "reference.pdf": pdfHash },
			blobs: { [pdfHash]: pdf },
		},
		FULL_ACCESS,
	);

	// The stem stays the same; only the linked CSV changes between versions.
	const versioned = {
		type: "multiple-choice" as const,
		title: "Growth of the table",
		stem: "Read the attached `table.csv`. Which row has the largest `y` in the latest data?",
		tags: ["attachments"],
		attachments: [{ name: "table.csv", format: "csv", origin: "table.csv" }],
		choices: [
			{ id: "row-3", text: "Row 3", score: 1 },
			{ id: "row-1", text: "Row 1" },
		],
	};
	await db.question.create(
		{
			course,
			slug: "csv-versions",
			status: "PUBLISHED",
			version: "v1",
			question: versioned,
			files: { "table.csv": csvHash },
			blobs: { [csvHash]: csv },
		},
		FULL_ACCESS,
	);
	await db.question.upsert(
		{
			course,
			slug: "csv-versions",
			status: "PUBLISHED",
			version: "v2",
			question: versioned,
			files: { "table.csv": csvV2Hash },
			blobs: { [csvV2Hash]: csvV2 },
		},
		FULL_ACCESS,
	);

	// The exam has not opened: its file stays 404 until it does.
	await db.exam.update(
		{ course, slug: "midterm" },
		{
			questions: [
				{ slug: "recursion-basics", version: "v1" },
				{ slug: "loop-invariants", version: "v1" },
				{ slug: "factorial-of-five", version: "v1" },
				{ slug: "csv-attachments", version: "v1" },
			],
			attachments: [
				{ name: "schedule.csv", format: "csv", origin: "schedule.csv" },
			],
			files: { "schedule.csv": scheduleHash },
			blobs: { [scheduleHash]: schedule },
		},
		FULL_ACCESS,
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
			kind: "CONTENT",
			course,
			message:
				"The slides of lecture 6 link to a reading list that returns a 404.",
			url: sent.url,
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
function editionSlugOf(start: IsoDate): string {
	const [year, month] = start.split("-").map(Number) as [number, number];
	return `${year}-${month <= 6 ? 1 : 2}`;
}

/// The edition display name matching {@link editionSlugOf}.
function editionNameOf(start: IsoDate): string {
	const slug = editionSlugOf(start);
	return `${slug.slice(0, 4)} · ${slug.endsWith("1") ? "first" : "second"} term`;
}

/// Midnight (server time zone) of the Monday `weeks` weeks away from the one of `date`'s week.
function mondayOfWeek(date: Date, weeks: number): IsoDate {
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
	return monday.toISOString().slice(0, 10) as IsoDate;
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

	// The dev student is in the class from the opening, so every meeting counts for them.
	await setEnrollmentDate(
		course,
		DEV_STUDENT_USERNAME,
		new Date(opening.startAt.getTime() - DAY_MS),
	);

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
				username: DEV_STUDENT_USERNAME,
				deviceHash: "device-student",
				minutes: 6,
			},
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
				username: DEV_STUDENT_USERNAME,
				deviceHash: "device-student",
				minutes: 5,
			},
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
		[DEV_STUDENT_USERNAME]: opening.startAt,
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
/// Two classroom invite links on the settings page: one in use, one expired.
async function seedClassroomInvites(
	course: Course["id"],
	instructor: User,
): Promise<void> {
	const createdBy = { username: instructor.username, name: instructor.name };
	await db.invite.create(
		{
			kind: "CLASSROOM",
			invitedRole: "STUDENT",
			email: null,
			course,
			maxUses: 40,
			createdBy,
		},
		FULL_ACCESS,
	);
	await db.invite.create(
		{
			kind: "CLASSROOM",
			invitedRole: "STUDENT",
			email: null,
			course,
			maxUses: null,
			createdBy,
			expiresInMs: -7 * 24 * 60 * 60 * 1000,
		},
		FULL_ACCESS,
	);
}

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
				{ username: DEV_STUDENT_USERNAME, value: 78 },
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

	await answerExam(course, exam, students.hamilton, {
		"recursion-basics": "base-case",
		"factorial-of-five": 25,
		"base-case-blanks": { stop: "recursive", smaller: "smaller" },
	});

	await db.exam.update(
		{ course, slug: exam },
		{
			status: "COMPLETED",
			// The Monday lecture of the course's fourth week, long over by now.
			scheduledAt: slotInstant(cs101.startDate, "MONDAY", 3, 14 * 60),
		},
		FULL_ACCESS,
	);
}

/// The Elm question whose tests are an examples block: `{example}`, `{public}` and private regions.
const ELM_EXAMPLES_QUESTION = [
	"---",
	"id: elm-sequences",
	"title: Sequences and averages",
	"type: code",
	"language: elm",
	"file: Main.elm",
	"meta:",
	"  worker: elm-test",
	"---",
	"",
	"Define `collatzLength`, the number of terms of the Collatz sequence that starts at `n` (0 when `n` is not positive), and `media`, the average of a list of numbers (0 for the empty list).",
	"",
	"[code]",
	"",
	"## [template]",
	"",
	"```elm",
	"module Main exposing (..)",
	"",
	"",
	"collatzLength : Int -> Int",
	"collatzLength n =",
	"    0",
	"",
	"",
	"media : List Float -> Float",
	"media xs =",
	"    0",
	"```",
	"",
	"## [tests]",
	"",
	"```elm",
	"-- mdq: [0] {example} Examples from the statement",
	"collatzLength 5 ==> 6",
	"collatzLength -42 ==> 0 -- negative numbers have length zero",
	"",
	"-- mdq: [+2] {public} Average",
	"media [ 7, 8 ] ~= 7.5",
	"media [] ~= 0 -- the empty list averages to zero",
	"",
	"-- mdq: [+3] Long sequences",
	"collatzLength 27 ==> 112",
	"collatzLength 1 ==> 1",
	"```",
	"",
].join("\n");

/// The Elm question whose tests are linked modules in the course style: `import Main as S`.
const ELM_MODULE_QUESTION = [
	"---",
	"id: elm-vowels",
	"title: Counting vowels",
	"type: code",
	"language: elm",
	"file: Main.elm",
	"meta:",
	"  worker: elm-test",
	"---",
	"",
	"Define `countVowels`, the number of vowels (`a`, `e`, `i`, `o`, `u`, in either case) in a string.",
	"",
	"[code]",
	"",
	"## [template]",
	"",
	"```elm",
	"module Main exposing (..)",
	"",
	"",
	"countVowels : String -> Int",
	"countVowels text =",
	"    0",
	"```",
	"",
	"## [tests]",
	"",
	"[Public](XPublic.elm)",
	"",
	"[Private](XPrivate.elm)",
	"",
].join("\n");

/// The linked test sources of {@link ELM_MODULE_QUESTION}.
const ELM_MODULE_TESTS = {
	"XPublic.elm": [
		"module XPublic exposing (tests)",
		"",
		"import Expect",
		"import Main as S",
		"import Test exposing (Test, describe, test)",
		"",
		"",
		"-- mdq: [0] {example} Examples from the statement",
		"",
		"",
		"tests : Test",
		"tests =",
		'    describe "Examples"',
		'        [ test "one vowel" <| \\_ -> Expect.equal 1 (S.countVowels "sky and")',
		'        , test "empty string" <| \\_ -> Expect.equal 0 (S.countVowels "")',
		"        ]",
		"",
	].join("\n"),
	"XPrivate.elm": [
		"module XPrivate exposing (tests)",
		"",
		"import Expect",
		"import Main as S",
		"import Test exposing (Test, describe, test)",
		"",
		"",
		"-- mdq: [1] Upper case and repeated vowels",
		"",
		"",
		"tests : Test",
		"tests =",
		'    describe "Hidden"',
		'        [ test "upper case" <| \\_ -> Expect.equal 3 (S.countVowels "AEIxyz")',
		'        , test "repeated" <| \\_ -> Expect.equal 4 (S.countVowels "banana!a")',
		"        ]",
		"",
	].join("\n"),
};

/**
 * Creates two Elm questions whose pretests run in the browser.
 *
 * One takes an examples block (`{example}`, a scored `{public}` and a private
 * region) and the other linked test modules. The answer keys are, for the
 * examples block:
 *
 * ```elm
 * collatzLength n =
 *     if n < 1 then 0
 *     else if n == 1 then 1
 *     else 1 + collatzLength (if modBy 2 n == 0 then n // 2 else 3 * n + 1)
 *
 * media xs =
 *     if List.isEmpty xs then 0 else List.sum xs / toFloat (List.length xs)
 * ```
 *
 * and for the modules, a fold over `String.toList` that counts the vowels.
 */
async function seedElmPretestQuestions(course: Course["id"]): Promise<void> {
	const examples = parse(ELM_EXAMPLES_QUESTION, {
		kind: "question",
	}) as CodeQuestion;
	const modules = resolveTests(
		parse(ELM_MODULE_QUESTION, { kind: "question" }) as CodeQuestion,
		ELM_MODULE_TESTS,
	);
	for (const [slug, question] of [
		["elm-sequences", examples],
		["elm-vowels", modules],
	] as const) {
		await db.question.create(
			{ course, slug, status: "PUBLISHED", version: "v1", question },
			FULL_ACCESS,
		);
	}
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
 * Seeds an open, timed quiz nobody has started, with one question of each answerable type.
 *
 * It has no date, so each student gets the full duration from the moment
 * they start, and the taking screen, its countdown and autosave can be tried
 * on any day.
 */
async function seedOpenQuiz(course: Course["id"], knuth: User): Promise<void> {
	const values = Buffer.from("n,fact\n0,1\n1,1\n2,2\n3,6\n", "utf8");
	const valuesHash = hashBytes(values);
	await createQuestion(course, "stack-overflow-name", {
		type: "short-answer",
		title: "Runaway recursion",
		stem: "What error does a recursion without a base case usually end in?",
		tags: ["recursion"],
		accept: [{ pattern: "stack overflow" }],
	});
	await createQuestion(course, "recursive-sum", {
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
	});
	await createQuestion(course, "factorial-lines", {
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
	});
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
				{ slug: "n-log-n", version: "v1" },
				{ slug: "js-double-it", version: "v1" },
				{ slug: "csv-attachments", version: "v1" },
				{ slug: "pdf-attachment", version: "v1" },
				{ slug: "csv-versions", version: "v1" },
			],
			attachments: [
				{
					name: "formulas.txt",
					format: "txt",
					text: "factorial(n) = n * factorial(n - 1), with factorial(0) = 1.",
				},
				{ name: "values.csv", format: "csv", origin: "values.csv" },
			],
			files: { "values.csv": valuesHash },
			blobs: { [valuesHash]: values },
		},
		FULL_ACCESS,
	);

	// Knuth opened an attempt two hours ago and never delivered it: the 45
	// minutes ran out with two answers saved.
	for (const [question, payload] of [
		["recursion-basics", "base-case"],
		["stack-overflow-name", "stack overflow"],
	] as const) {
		await db.response.submit(
			{ course, exam: "quiz-02", question, payload },
			{ actor: knuth },
		);
	}
	await prisma.response.updateMany({
		where: {
			authorId: knuth.username,
			exam: { slug: "quiz-02", courseId: course },
		},
		data: { createdAt: new Date(Date.now() - 2 * 3_600_000) },
	});
}

/// Has hopper type the JavaScript answer of `test-03` with the edit history on, then switches the history off for the exam.
async function seedHistoryOffExam(
	course: Course["id"],
	hopper: User,
): Promise<void> {
	const exam = "test-03";
	const question = "js-double-it";
	const attempt = await prisma.response.findFirstOrThrow({
		where: {
			authorId: hopper.username,
			exam: { slug: exam, courseId: course },
		},
	});
	await prisma.response.update({
		where: { publicId: attempt.publicId },
		data: { createdAt: new Date(Date.now() - 40 * 60_000) },
	});
	const typed = new SeededTyping(
		hopper,
		{ course, exam, attempt: attempt.publicId },
		question,
	);
	const line = 'const n = Number(prompt("Number?"));';
	await typed.type("tab-1", new Date(Date.now() - 30 * 60_000), [
		...typingEdits(1000, line, 0),
		...typingEdits(50_000, "\nconsole.log(n * 2);", line.length),
	]);
	await db.response.submit(
		{ course, exam, question, payload: typed.text },
		{ actor: hopper },
	);
	await db.exam.setAnswerHistory({ course, slug: exam }, false, FULL_ACCESS);
}

/// The edits of typing `insertedText` word by word from `position`, starting at `startMs`.
function typingEdits(
	startMs: number,
	insertedText: string,
	position: number,
): SeededEdit[] {
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
}

/// The rubric of the essay `prolog-caso-base`: groups three levels deep, standalone items (one negative) and a base of zero.
async function seedEssayRubric(pk: {
	course: Course["id"];
	exam: string;
	question: string;
}): Promise<void> {
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
}

/// What the students wrote for the essay `prolog-caso-base`.
const CASO_BASE_TEXT = {
	hopper:
		"Sem o caso base, `comprimento/2` chama a si mesmo sem parar e a pilha estoura.",
	hamilton:
		"O caso base deveria ser `comprimento([_], 1)`, mas assim a lista vazia nunca casa. Sem ele a pilha de chamadas cresce até estourar.",
	liskov: "Precisa para a recursão parar em algum momento.",
	bob: "Se a lista vazia ficar sem cláusula, a consulta falha ou entra em laço. O caso base fica antes da recursiva e usa `[]`.",
	same: "Sem a cláusula do caso base a recursão não tem onde parar, e o Prolog continua tentando até acabar a memória.",
	other:
		"O caso base é a resposta que não depende de chamada recursiva. Ele ancora a definição indutiva do predicado.",
};

/**
 * Seeds `test-02`, an exam whose window just ended and that is being corrected.
 *
 * It holds a student in each state of the correction: objective answers
 * graded on delivery, manual grades with a comment, a rubric in use and an
 * initial one the exam did not copy, answers waiting equal up to spaces, one
 * marked will-not-grade, a blank question, code to run (JavaScript, Python and
 * Prolog), Elm sends corrected by the bot `runner`, the instructor's edit
 * history of the typed answers, and the exceptions of the exam (`liskov` has
 * a personal window still open, `backus` a makeup). The exam stays `ONGOING`
 * with its window over: `COMPLETED` would not let an extra time reopen it.
 */
async function seedGradingShowcase(
	course: Course["id"],
	instructor: User,
	students: {
		hopper: User;
		hamilton: User;
		liskov: User;
		bob: User;
		knuth: User;
		ritchie: User;
		thompson: User;
		backus: User;
	},
): Promise<void> {
	const exam = "test-02";
	const worker = "elm-test";
	const bot = { actor: { ...instructor, bot: "runner" } };
	const { hopper, hamilton, liskov, bob, knuth, ritchie, thompson, backus } =
		students;
	const devStudent = await db.user.findOne(
		{ username: DEV_STUDENT_USERNAME },
		FULL_ACCESS,
	);
	if (!devStudent) throw new Error("The dev student account is missing.");
	const [basics, five, returns, blanks, essay, js, py, prolog, elm] = [
		"recursion-basics",
		"factorial-of-five",
		"factorial-returns",
		"base-case-blanks",
		"prolog-caso-base",
		"js-double-it",
		"py-count-up",
		"prolog-comprimento-de-lista",
		"elm-soma",
	] as const;

	await createQuestion(course, "explain-recursion", {
		type: "essay",
		title: "Explain recursion",
		stem: "Explain, in your own words, why a recursive function needs a base case.",
		tags: ["recursion"],
		content: "text",
	});
	await createQuestion(course, returns, {
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
	});
	for (const question of [
		{
			slug: js,
			title: "Double the number",
			stem: "Read a number and print its double.\n\nStart from [the loop reference](https://developer.mozilla.org/docs/Web/JavaScript/Guide/Loops_and_iteration).",
			epilogue:
				"Print only the number. Anything else on the output is ignored.",
			language: "javascript",
			weight: 2,
		},
		{
			slug: py,
			title: "Count up",
			stem: "Print the numbers from 1 to `n`, one per line, where `n` is read from the input.",
			language: "python",
		},
	]) {
		await createQuestion(course, question.slug, {
			type: "essay",
			title: question.title,
			stem: question.stem,
			tags: [question.language],
			content: "code",
			highlight: question.language,
			...(question.weight ? { weight: question.weight } : {}),
			...(question.epilogue ? { epilogue: question.epilogue } : {}),
		} as never);
	}
	await createQuestion(course, prolog, {
		type: "essay",
		title: "Comprimento de uma lista em Prolog",
		stem: "Defina `comprimento(Lista, N)` de modo que `N` seja o número de elementos de `Lista`. Não use `length/2`.",
		tags: ["prolog"],
		content: "code",
		highlight: "prolog",
	});
	// The question document has no rubric field, so the initial rubric is
	// written into the stored version the way a pushed question carries it.
	const stored = await prisma.questionData.findFirstOrThrow({
		where: { versionHash: "v1", ref: { courseId: course, slug: prolog } },
	});
	await prisma.questionData.update({
		where: { id: stored.id },
		data: {
			privatePayload: {
				...(stored.privatePayload as Record<string, unknown>),
				rubric: [
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
				],
			},
		},
	});
	await createQuestion(course, essay, {
		type: "essay",
		title: "O caso base da recursão em Prolog",
		stem: "Por que um predicado recursivo em Prolog precisa de uma cláusula para o caso base? O que acontece com `comprimento/2` sem ela?",
		tags: ["prolog", "recursion"],
		content: "text",
	});
	await db.exam.create(
		{
			course,
			slug: exam,
			type: "EXAM",
			status: "ONGOING",
			title: "Test 2: recursion and code",
			description:
				"Objective questions, an essay corrected with a rubric, and code in four languages.",
			tags: ["recursion", "prolog"],
			questions: [
				basics,
				five,
				returns,
				blanks,
				essay,
				js,
				py,
				prolog,
				elm,
			].map((slug) => ({ slug, version: "v1" })),
		},
		FULL_ACCESS,
	);
	const pk = { course, exam, question: essay };
	await seedEssayRubric(pk);

	const now = Date.now();
	/// A time `minutes` before the seed ran.
	const ago = (minutes: number) => new Date(now - minutes * 60_000);
	/// Opens an attempt that started `minutes` ago.
	const attempt = async (student: User, minutes: number) => {
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
	/// Saves each answer of `student`; returns the submission ids by question.
	const put = async (
		student: User,
		answers: Record<string, QuestionResponse>,
	): Promise<Record<string, string>> => {
		const ids: Record<string, string> = {};
		for (const [question, payload] of Object.entries(answers)) {
			const response = await db.response.submit(
				{ course, exam, question, payload },
				{ actor: student },
			);
			ids[question] = response.submissions.at(-1)?.publicId ?? "";
		}
		return ids;
	};
	const finish = async (student: User) => {
		await db.response.finish({ course, exam }, { actor: student });
	};
	/// Sends an Elm answer and has the bot correct it with `verdicts`.
	const sendElm = async (
		student: User,
		payload: string,
		verdicts: Parameters<typeof elmReport>[0],
	): Promise<void> => {
		const response = await db.response.submit(
			{ course, exam, question: elm, payload, kind: "SUBMIT" },
			{ actor: student },
		);
		const sent = response.submissions.at(-1)?.publicId ?? "";
		const [job] = await db.gradingJob.claim(
			{ workers: [worker], limit: 1, exam },
			bot,
		);
		if (job?.submission !== sent) {
			throw new Error(
				`[seed] the bot claimed ${job?.submission}, not ${sent}.`,
			);
		}
		await db.gradingJob.complete(sent, elmReport(verdicts), bot);
	};
	const all = (verdict: ElmVerdict) => ({
		empty: verdict,
		one: verdict,
		long: verdict,
		negatives: verdict,
	});
	const as = { actor: instructor };
	const listing = (...lines: string[]) => lines.join("\n");
	const rightOrder: [number, string][] = [
		[0, "factorial(0) returns 1"],
		[0, "factorial(1) returns 1"],
		[0, "factorial(2) returns 2"],
		[0, "factorial(3) returns 6"],
	];
	const definition = CASO_BASE_TEXT.liskov;

	// Hopper: everything answered. The essay is typed, pasted into and trimmed,
	// the rubric grades it, the JavaScript is graded by hand, and Elm went from
	// a partial send to a full one.
	{
		const ref = await attempt(hopper, 50);
		const text = new SeededTyping(hopper, ref, essay);
		const first = `Ah, ${CASO_BASE_TEXT.hopper}`;
		await text.type("tab-1", ago(44), [
			...typingEdits(1000, first.slice(0, 30), 0),
			...typingEdits(9000, first.slice(30), 30),
		]);
		await text.type("tab-1", ago(40), [
			{
				position: first.length,
				deleteCount: 0,
				insertedText:
					" A cláusula `comprimento([], 0)` encerra a recursão. Cada chamada trabalha sobre uma lista menor até chegar à lista vazia, onde o predicado responde direto e as chamadas voltam uma a uma.",
				startMs: 31_000,
				durationMs: 120,
				kind: "paste",
			},
			{
				position: 0,
				deleteCount: 4,
				insertedText: "",
				startMs: 140_000,
				durationMs: 300,
				kind: "delete",
			},
		]);
		const program = new SeededTyping(hopper, ref, js);
		const line = 'const n = Number(prompt("Number?"));';
		await program.type("tab-1", ago(30), [
			...typingEdits(200_000, line, 0),
			...typingEdits(215_000, "\nconsole.log(n * 2);", line.length),
		]);
		const saved = await put(hopper, {
			[basics]: "base-case",
			[five]: 120,
			[returns]: rightOrder,
			// "lighter" matches no pattern, so the blank waits for the instructor.
			[blanks]: { stop: "base", smaller: "lighter" },
			[essay]: text.text,
			[js]: program.text,
			[py]: "n = int(input())\nfor i in range(1, n + 1):\n    print(i)",
			[prolog]: listing(
				"comprimento([], 0).",
				"comprimento([_|T], N) :- comprimento(T, M), N is M + 1.",
			),
		});
		await sendElm(hopper, ELM_ANSWERS.positives, {
			...all("pass"),
			negatives: "fail",
		});
		await sendElm(hopper, ELM_ANSWERS.correct, all("pass"));
		await finish(hopper);
		await db.feedback.create(
			{
				submission: { publicId: saved[essay] ?? "" },
				ref: "rubric-1",
				rubric: ["correta", "pilha"],
				feedback: "Resposta completa.",
			},
			as,
		);
		await db.feedback.create(
			{
				submission: { publicId: saved[js] ?? "" },
				ref: "manual-1",
				score: "0.8",
				feedback: "Right, but validate the input.",
			},
			as,
		);
	}

	// Hamilton: wrong objectives, an ordering with no key, a rubric pass with an
	// adjustment, code that fails, and an essay whose history has a marker, a
	// rebase and a final gap.
	{
		const ref = await attempt(hamilton, 55);
		const text = new SeededTyping(hamilton, ref, essay);
		const lost = "O caso base deveria ser `comprimento([_], 1)`.";
		await text.type("tab-1", ago(48), typingEdits(1000, lost, 0));
		await text.gap("input-lost", ago(42));
		const rebased = "O caso base deveria ser `comprimento([_], 1)`";
		await text.type(
			"tab-2",
			ago(36),
			typingEdits(500, ", mas assim a lista vazia nunca casa.", rebased.length),
			{ reason: "rebase", text: rebased },
		);
		const saved = await put(hamilton, {
			[basics]: "tail-call",
			[five]: 100,
			// The order of the calls, not of the returns: matches no key, so it is pending.
			[returns]: [...rightOrder].reverse(),
			[essay]: CASO_BASE_TEXT.hamilton,
			[js]: 'const n = Number(prompt("Number?"));\nconsole.log(doubled(n));',
			[py]: "n = int(input())\nfor i in range(1, n + 1):\n    print(j)",
			[prolog]: listing(
				":- use_module(library(clpfd)).",
				"comprimento([], 0).",
				"comprimento([_|T], N) :- N #> 0, M #= N - 1, comprimento(T, M).",
			),
		});
		await sendElm(hamilton, ELM_ANSWERS.template, {
			...all("pass"),
			one: "fail",
		});
		await finish(hamilton);
		await db.feedback.create(
			{
				submission: { publicId: saved[essay] ?? "" },
				ref: "rubric-1",
				rubric: ["errado", "pilha"],
				adjustment: "0.2",
				feedback: "O caso base está errado, mas o resto está bem explicado.",
			},
			as,
		);
	}

	// Liskov: a blank question, a pass that uses the item split further down,
	// code that loops, prints too much and does not load, and a history that
	// stopped at a limit.
	{
		const ref = await attempt(liskov, 45);
		const text = new SeededTyping(liskov, ref, essay);
		await text.type("tab-1", ago(40), typingEdits(1000, definition, 0));
		await text.overflow(ago(35));
		const saved = await put(liskov, {
			[basics]: "base-case",
			[essay]: definition,
			[js]: "let n = 1;\nwhile (true) {\n  n = n * 2;\n}",
			[py]: "n = int(input())\nfor i in range(1, 200000):\n    print(f'line {i}: ' + 'x' * 40)",
			[prolog]: listing(
				"comprimento([], 0)",
				"comprimento([_|T], N) :- N > 0, F is N *",
			),
		});
		await finish(liskov);
		await db.feedback.create(
			{
				submission: { publicId: saved[essay] ?? "" },
				ref: "rubric-1",
				rubric: ["vaga", "is-livre"],
			},
			as,
		);
	}

	// Bob: the bot graded the essay with the rubric and the Prolog with notes.
	// No typing reached the server for his answers.
	{
		await attempt(bob, 30);
		const saved = await put(bob, {
			[basics]: "tail-call",
			[essay]: CASO_BASE_TEXT.bob,
			[js]: 'console.log(Number(prompt("Number?")) * 2);',
			[py]: "n = int(input())\ni = 1\nwhile True:\n    i += 1",
			[prolog]: listing(
				"comprimento([_|T], N) :- comprimento(T, M), N is M + 1.",
				"comprimento([], 0).",
				"% comprimento([a, b, c], 3).",
			),
		});
		await finish(bob);
		await db.feedback.create(
			{
				submission: { publicId: saved[essay] ?? "" },
				ref: "auto-1",
				bot: "runner",
				rubric: ["inacessivel", "pilha"],
				notes: "Cláusulas na ordem trocada; o caso base nunca é alcançado.",
			},
			FULL_ACCESS,
		);
		await db.feedback.create(
			{
				submission: { publicId: saved[prolog] ?? "" },
				ref: "auto-2",
				score: "1",
				bot: "runner",
				feedback: "All tests passed.",
				notes: "The answer hard-codes an expected output in a comment.",
			},
			FULL_ACCESS,
		);
	}

	// Knuth and ritchie wrote the same essay up to spaces and stay pending;
	// knuth delivered an empty program, which the instructor will not grade.
	const knuthSaved = await put(knuth, {
		[basics]: "base-case",
		[essay]: CASO_BASE_TEXT.same,
		[js]: "",
	});
	await finish(knuth);
	await db.feedback.create(
		{
			submission: { publicId: knuthSaved[js] ?? "" },
			ref: "wng-manual-1",
			score: "0",
			feedback: "Submitted empty.",
		},
		as,
	);
	await db.submission.update(
		{ publicId: knuthSaved[js] ?? "" },
		{ status: "WILL_NOT_GRADE" },
		FULL_ACCESS,
	);
	await put(ritchie, {
		[basics]: "base-case",
		[essay]: `  ${CASO_BASE_TEXT.same.replace(", e o", ",   e o")}\n`,
	});
	await finish(ritchie);
	await put(thompson, { [basics]: "base-case", [essay]: CASO_BASE_TEXT.other });
	await finish(thompson);
	await put(devStudent, {
		[basics]: "base-case",
		[five]: 120,
		[essay]: "A base case stops the recursion, so the calls can return.",
	});
	await finish(devStudent);

	// The window ended half an hour ago. Backus never came and has a makeup.
	await db.exam.update(
		{ course, slug: exam },
		{ scheduledAt: ago(90), duration: { hours: 1 } },
		FULL_ACCESS,
	);
	await db.examException.create(
		{
			course,
			exam,
			username: liskov.username,
			extraTime: { hours: 6 },
			note: "Connection dropped",
		},
		FULL_ACCESS,
	);
	await db.examException.create(
		{
			course,
			exam,
			username: backus.username,
			scheduledAt: new Date(now + 2 * 24 * 3_600_000),
			note: "Missed the exam, medical note",
		},
		FULL_ACCESS,
	);

	// Last, so the pass above that applies "vaga" is the one to review.
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
}

/// The directory of the Elm example question, the one the grading worker's example course also uses.
const ELM_EXAMPLE_DIR = "workers/chalk-worker/example/questions/elm";

/// The example question with its linked test sources resolved, as the CLI pushes it.
function elmExampleQuestion(): CodeQuestion {
	const dir = path.resolve(process.cwd(), ELM_EXAMPLE_DIR);
	const read = (file: string) => readFileSync(path.join(dir, file), "utf8");
	const question = parse(read("soma.md"), { kind: "question" }) as CodeQuestion;
	const texts = Object.fromEntries(
		(question.tests ?? []).flatMap((source) =>
			source.origin ? [[source.origin, read(source.origin)]] : [],
		),
	);
	return resolveTests(question, texts);
}

/// Elm answers to the example question, from a correct one to a template left as it came.
const ELM_ANSWERS = {
	template:
		"module Main exposing (soma)\n\n\nsoma : List Int -> Int\nsoma xs =\n    0\n",
	firstOnly:
		"module Main exposing (soma)\n\n\nsoma : List Int -> Int\nsoma xs =\n    case xs of\n        [] ->\n            0\n\n        x :: _ ->\n            x\n",
	positives:
		"module Main exposing (soma)\n\n\nsoma : List Int -> Int\nsoma xs =\n    List.sum (List.filter (\\x -> x > 0) xs)\n",
	/// `firstOnly` and `positives` with a comment, for a student who sends them again: an identical send would not count.
	firstOnlyAgain:
		"module Main exposing (soma)\n\n\nsoma : List Int -> Int\nsoma xs =\n    -- again\n    case xs of\n        [] ->\n            0\n\n        x :: _ ->\n            x\n",
	positivesAgain:
		"module Main exposing (soma)\n\n\nsoma : List Int -> Int\nsoma xs =\n    -- again\n    List.sum (List.filter (\\x -> x > 0) xs)\n",
	correct:
		"module Main exposing (soma)\n\n\nsoma : List Int -> Int\nsoma xs =\n    List.foldl (+) 0 xs\n",
	unfinished:
		"module Main exposing (soma)\n\n\nsoma : List Int -> Int\nsoma xs =\n    List.fol",
};

type ElmVerdict = "pass" | "fail";

/// The runner report of the example question, with case ids as the worker writes them: the two public cases of `Pre.elm`, then the two hidden ones of `Hidden.elm`.
function elmReport(verdicts: {
	empty: ElmVerdict;
	one: ElmVerdict;
	long: ElmVerdict;
	negatives: ElmVerdict;
}): object {
	const failure = (expected: string, actual: string) => ({
		message: `Expected ${expected} but got ${actual}`,
		expected,
		actual,
	});
	return {
		status: "completed",
		runner: { name: "chalk-worker", version: "0.1.0", language: "elm" },
		cases: [
			{
				source: 0,
				line: 12,
				id: "Pre pre::vazia",
				verdict: verdicts.empty,
				duration: 0.004,
				...(verdicts.empty === "fail" ? failure("0", "1") : {}),
			},
			{
				source: 0,
				line: 13,
				id: "Pre pre::um",
				verdict: verdicts.one,
				duration: 0.003,
				...(verdicts.one === "fail" ? failure("7", "0") : {}),
			},
			{
				source: 1,
				line: 12,
				id: "Hidden hidden::longa",
				verdict: verdicts.long,
				duration: 0.006,
				...(verdicts.long === "fail" ? failure("55", "1") : {}),
			},
			{
				source: 1,
				line: 14,
				id: "Hidden hidden::negativos",
				verdict: verdicts.negatives,
				duration: 0.004,
				...(verdicts.negatives === "fail" ? failure("-3", "0") : {}),
			},
		],
	};
}

/// Creates `elm-soma`, the Elm question corrected by the external worker.
async function seedElmQuestion(course: Course["id"]): Promise<void> {
	await createQuestion(course, "elm-soma", {
		...elmExampleQuestion(),
		weight: 3,
	} as CodeQuestion);
}

/**
 * Seeds `test-03`, an open `EXAM` that runs code and sends an Elm question to a grading worker, with a student in each state of the queue.
 *
 * The bot `runner` (`ada`'s key) grades through the job service, so scores,
 * feedback and statuses come from the real code. Exam: `bob` waits in the
 * queue, `liskov` is being corrected (the lease outlasts a dev session),
 * `hopper` has a partial grade and then a full one, `hamilton` failed the
 * pretest, `knuth` hit the worker failure limit, `ritchie` replaced a
 * cancelled send, `thompson` spent every send, and `backus` only autosaved.
 */
async function seedExternalGradingExams(
	course: Course["id"],
	instructor: User,
	students: {
		hopper: User;
		hamilton: User;
		liskov: User;
		bob: User;
		knuth: User;
		ritchie: User;
		thompson: User;
		backus: User;
	},
): Promise<void> {
	const exam = "test-03";
	const question = "elm-soma";
	const worker = "elm-test";
	const bot = { actor: { ...instructor, bot: "runner" } };

	await db.exam.create(
		{
			course,
			slug: exam,
			type: "EXAM",
			status: "ONGOING",
			title: "Test 3: code",
			description:
				"An open exam that allows running code and sends Elm to a worker.",
			allowCodeRun: true,
			tags: ["elm", "javascript"],
			questions: [
				{ slug: "elm-soma", version: "v1" },
				{ slug: "js-double-it", version: "v1" },
			],
		},
		FULL_ACCESS,
	);
	/// Sends `payload` and returns the new submission's id.
	const send = async (
		examSlug: string,
		student: User,
		payload: string,
	): Promise<string> => {
		const response = await db.response.submit(
			{ course, exam: examSlug, question, payload, kind: "SUBMIT" },
			{ actor: student },
		);
		return response.submissions.at(-1)?.publicId ?? "";
	};
	/// Has the bot claim the only queued job, which must be `submission`'s.
	const claim = async (submission: string): Promise<void> => {
		const [job] = await db.gradingJob.claim(
			{ workers: [worker], limit: 1 },
			bot,
		);
		if (job?.submission !== submission) {
			throw new Error(
				`[seed] the bot claimed ${job?.submission}, not ${submission}.`,
			);
		}
	};
	/// Sends `payload`, then has the bot correct it with `verdicts`.
	const sendAndGrade = async (
		examSlug: string,
		student: User,
		payload: string,
		verdicts: Parameters<typeof elmReport>[0],
	): Promise<void> => {
		const submission = await send(examSlug, student, payload);
		await claim(submission);
		await db.gradingJob.complete(submission, elmReport(verdicts), bot);
	};
	const all = (verdict: ElmVerdict) => ({
		empty: verdict,
		one: verdict,
		long: verdict,
		negatives: verdict,
	});
	const partial = {
		empty: "pass",
		one: "pass",
		long: "pass",
		negatives: "fail",
	} as const;
	const noHidden = {
		empty: "pass",
		one: "pass",
		long: "fail",
		negatives: "fail",
	} as const;

	// Corrected sends first: a claim takes the oldest queued job, so the jobs
	// that stay queued are sent last.
	await sendAndGrade(exam, students.hopper, ELM_ANSWERS.positives, partial);
	await sendAndGrade(exam, students.hopper, ELM_ANSWERS.correct, all("pass"));

	const failedPretest = await send(
		exam,
		students.hamilton,
		ELM_ANSWERS.template,
	);
	await claim(failedPretest);
	await db.gradingJob.complete(
		failedPretest,
		elmReport({ ...all("pass"), one: "fail" }),
		bot,
	);

	for (const [payload, verdicts] of [
		[ELM_ANSWERS.firstOnly, noHidden],
		[ELM_ANSWERS.positives, partial],
		[ELM_ANSWERS.firstOnlyAgain, noHidden],
		[ELM_ANSWERS.positivesAgain, partial],
	] as const) {
		await sendAndGrade(exam, students.thompson, payload, verdicts);
	}

	const crashing = await send(exam, students.knuth, ELM_ANSWERS.correct);
	for (let attempt = 1; attempt <= 3; attempt++) {
		await claim(crashing);
		await db.gradingJob.fail(
			crashing,
			{
				error: "elm-test exited with status 137 (killed, out of memory)",
				retry: true,
			},
			bot,
		);
	}

	const claimed = await send(exam, students.liskov, ELM_ANSWERS.positives);
	await claim(claimed);
	// A long lease, so the page shows the send as being corrected through a dev session.
	await prisma.gradingJob.updateMany({
		where: { submission: { publicId: claimed } },
		data: { leaseUntil: new Date(Date.now() + 30 * 24 * 3_600_000) },
	});

	await seedElmEditHistory(course, exam, question, students.hopper);

	// The first send is cancelled by the second, which waits in the queue.
	await send(exam, students.ritchie, ELM_ANSWERS.unfinished);
	await send(exam, students.ritchie, ELM_ANSWERS.positives);
	await send(exam, students.bob, ELM_ANSWERS.correct);

	await db.response.submit(
		{
			course,
			exam,
			question,
			author: students.backus.username,
			payload: ELM_ANSWERS.unfinished,
		},
		{ actor: students.backus },
	);

	// The professor's page shows when the worker was last seen.
	await prisma.apiKey.updateMany({
		where: { name: "runner" },
		data: { lastUsedAt: new Date(Date.now() - 2 * 60_000) },
	});
}

/**
 * Seeds the edit history of `student` on the Elm code question of `exam`: the
 * body typed over the template, then replaced by a pasted line, which ends on
 * the answer the student sent last.
 */
async function seedElmEditHistory(
	course: Course["id"],
	exam: string,
	question: string,
	student: User,
): Promise<void> {
	const { publicId } = await prisma.response.findFirstOrThrow({
		where: {
			authorId: student.username,
			exam: { courseId: course, slug: exam },
		},
		select: { publicId: true },
	});
	const now = Date.now();
	// The attempt opened before the typing the server saw.
	await prisma.response.update({
		where: { publicId },
		data: { createdAt: new Date(now - 10 * 60_000) },
	});
	const program = new SeededTyping(
		student,
		{ course, exam, attempt: publicId },
		question,
	);
	program.text = ELM_ANSWERS.template;
	const body = ELM_ANSWERS.template.indexOf("    0\n") + 4;
	const typed = "List.sum (List.filter (\\x -> x > 0) xs)";
	let at = body;
	let when = 6_000;
	const words = (typed.match(/\S+\s*/g) ?? []).map((word) => {
		const edit: SeededEdit = {
			position: at,
			deleteCount: 0,
			insertedText: word,
			startMs: when,
			durationMs: 80 * word.length,
		};
		at += word.length;
		when += 400 + 80 * word.length;
		return edit;
	});
	await program.type("tab-1", new Date(now - 4 * 60_000), [
		{
			position: body,
			deleteCount: 1,
			insertedText: "",
			startMs: 5_000,
			durationMs: 60,
			kind: "delete",
		},
		...words,
	]);
	await program.type("tab-1", new Date(now - 2 * 60_000), [
		{
			position: body,
			deleteCount: typed.length,
			insertedText: "List.foldl (+) 0 xs",
			startMs: 95_000,
			durationMs: 40,
			kind: "paste",
		},
	]);
	if (program.text !== ELM_ANSWERS.correct) {
		throw new Error("[seed] the Elm edit history does not end on the answer.");
	}
}

/// Seeds `test-trees` in `cs201`, closed two days ago and graded on delivery, with its grades still to release.
async function seedTreesExam(
	course: Course["id"],
	students: { liskov: User; bob: User },
): Promise<void> {
	const exam = "test-trees";
	await db.exam.create(
		{
			course,
			slug: exam,
			type: "EXAM",
			status: "ONGOING",
			title: "Test 1: trees",
			description: "Closed and corrected, waiting for the grades to go out.",
			tags: ["trees"],
			questions: [{ slug: "bst-lookup", version: "v1" }],
		},
		FULL_ACCESS,
	);
	await answerExam(course, exam, students.liskov, { "bst-lookup": "log-n" });
	await answerExam(course, exam, students.bob, { "bst-lookup": "n" });
	await db.exam.update(
		{ course, slug: exam },
		{
			status: "COMPLETED",
			scheduledAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
			duration: { hours: 1 },
		},
		FULL_ACCESS,
	);
}

/// Gives the dev student 30 extra minutes on the midterm, a week ahead.
async function seedMidtermException(course: Course["id"]): Promise<void> {
	await db.examException.create(
		{
			course,
			exam: "midterm",
			username: DEV_STUDENT_USERNAME,
			extraTime: { minutes: 30 },
			note: "Accommodation on file",
		},
		FULL_ACCESS,
	);
}

/**
 * Seeds `test-01`, the exam whose grades were released three days ago.
 *
 * Nine students answered it, `students` plus the dev student. The objective
 * questions give the statistics a multiple choice with a popular distractor
 * and a choice nobody picks, a multiple selection, a true-false, a question
 * the best students on the rest of the exam miss (negative discrimination),
 * a numeric, and one everybody gets right (no variance). The first two
 * questions weigh 3 and 2. Three students answered the essay, graded with a
 * rubric, and the regrade requests are in each state: the dev student has an
 * open one, an accepted one and an answer without a request, hopper's was
 * accepted and hamilton's rejected.
 */
async function seedReleasedExam(
	course: Course["id"],
	instructor: User,
	others: User[],
): Promise<void> {
	const exam = "test-01";
	const essay = "prolog-caso-base";
	const dev = await db.user.findOne(
		{ username: DEV_STUDENT_USERNAME },
		FULL_ACCESS,
	);
	if (!dev) throw new Error("The dev student account is missing.");
	const students = [...others, dev];
	const algorithmQuestion = (slug: string, body: Record<string, unknown>) =>
		createQuestion(course, slug, { tags: ["algorithms"], ...body } as never);
	await algorithmQuestion("fastest-sort", {
		type: "multiple-choice",
		title: "Fastest general sort",
		weight: 3,
		stem: "Which sort has an O(n log n) worst case?",
		choices: [
			{ id: "merge", text: "Merge sort", score: 1 },
			{ id: "bubble", text: "Bubble sort" },
			{ id: "insertion", text: "Insertion sort" },
			{ id: "bogo", text: "Bogosort" },
		],
	});
	await algorithmQuestion("n-log-n", {
		type: "multiple-selection",
		title: "O(n log n) algorithms",
		weight: 2,
		stem: "Select every algorithm that runs in O(n log n) on average.",
		choices: [
			{ id: "merge", text: "Merge sort", correct: true },
			{ id: "quick", text: "Quicksort", correct: true },
			{ id: "bubble", text: "Bubble sort", correct: false },
			{ id: "binary-search", text: "Binary search", correct: false },
		],
	});
	await algorithmQuestion("stack-facts", {
		type: "true-false",
		title: "Stack facts",
		weight: 1,
		stem: "Judge each statement about stacks.",
		choices: [
			{ id: "lifo", text: "A stack is last in, first out.", correct: true },
			{ id: "fifo", text: "A stack is first in, first out.", correct: false },
			{ id: "push", text: "Push adds to the top.", correct: true },
		],
	});
	await algorithmQuestion("pivot-trap", {
		type: "multiple-choice",
		title: "Worst case of quicksort",
		stem: "What is the worst-case time of quicksort with a fixed pivot?",
		choices: [
			{ id: "quadratic", text: "O(n^2)", score: 1 },
			{ id: "linearithmic", text: "O(n log n)" },
		],
	});
	await algorithmQuestion("stack-top", {
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
			title: "Test 1: algorithms",
			description:
				"Sorting, stacks and a Prolog essay, with grades out and reviews to look at.",
			tags: ["algorithms"],
			questions: [
				{ slug: "fastest-sort", version: "v1" },
				{ slug: "n-log-n", version: "v1" },
				{ slug: "stack-facts", version: "v1" },
				{ slug: "pivot-trap", version: "v1" },
				{ slug: "factorial-of-five", version: "v1" },
				{ slug: "stack-top", version: "v1" },
				{ slug: essay, version: "v1" },
			],
		},
		FULL_ACCESS,
	);
	await seedEssayRubric({ course, exam, question: essay });

	/// Each row: the answer to every question, by student in `students` order. Closing the attempt scores them.
	const rows: [string, QuestionResponse][][] = [
		[
			["fastest-sort", "merge"],
			["n-log-n", ["merge", "quick"]],
			["stack-facts", { lifo: true, fifo: false, push: true }],
			["pivot-trap", "linearithmic"],
			["factorial-of-five", 120],
			["stack-top", "top"],
		],
		[
			["fastest-sort", "merge"],
			["n-log-n", ["merge", "quick"]],
			["stack-facts", { lifo: true, fifo: false, push: true }],
			["pivot-trap", "linearithmic"],
			["factorial-of-five", 120],
			["stack-top", "top"],
		],
		[
			["fastest-sort", "merge"],
			["n-log-n", ["merge", "quick"]],
			["stack-facts", { lifo: true, fifo: false, push: true }],
			["pivot-trap", "linearithmic"],
			["factorial-of-five", 120],
			["stack-top", "top"],
		],
		[
			["fastest-sort", "insertion"],
			["n-log-n", ["merge"]],
			["stack-facts", { lifo: true, fifo: false }],
			["pivot-trap", "linearithmic"],
			["factorial-of-five", 120],
			["stack-top", "top"],
		],
		[
			["fastest-sort", "merge"],
			["n-log-n", ["merge", "quick", "bubble"]],
			["stack-facts", { lifo: true, fifo: true, push: true }],
			["pivot-trap", "quadratic"],
			["factorial-of-five", 120],
			["stack-top", "top"],
		],
		[
			["fastest-sort", "bubble"],
			["n-log-n", ["merge"]],
			["stack-facts", { lifo: true, fifo: false, push: true }],
			["pivot-trap", "quadratic"],
			["factorial-of-five", 100],
			["stack-top", "top"],
		],
		[
			["fastest-sort", "bubble"],
			["n-log-n", []],
			["stack-facts", { lifo: false, fifo: true, push: false }],
			["pivot-trap", "quadratic"],
			["factorial-of-five", 100],
			["stack-top", "top"],
		],
		[
			["fastest-sort", "bubble"],
			["n-log-n", ["bubble"]],
			["stack-facts", { lifo: false, fifo: true, push: false }],
			["pivot-trap", "quadratic"],
			["factorial-of-five", 24],
			["stack-top", "top"],
		],
		[
			["fastest-sort", "merge"],
			["n-log-n", ["merge", "quick"]],
			["stack-facts", { lifo: true, fifo: true, push: true }],
			["pivot-trap", "linearithmic"],
			["factorial-of-five", 120],
			["stack-top", "top"],
		],
	];
	const essays: Record<string, string> = {
		[students[0]?.username ?? ""]: CASO_BASE_TEXT.hopper,
		[students[1]?.username ?? ""]: CASO_BASE_TEXT.hamilton,
		[dev.username]: CASO_BASE_TEXT.bob,
	};
	const submissions: Record<string, Record<string, string>> = {};
	for (const [index, student] of students.entries()) {
		const answers: SeededAnswers = Object.fromEntries(rows[index] ?? []);
		const text = essays[student.username];
		if (text) answers[essay] = text;
		submissions[student.username] = await answerExam(
			course,
			exam,
			student,
			answers,
		);
	}

	const grade = (
		username: string,
		rubric: string[],
		feedback: string,
		adjustment?: string,
	) =>
		db.feedback.create(
			{
				submission: { publicId: submissions[username]?.[essay] ?? "" },
				ref: "rubric-1",
				rubric,
				...(adjustment ? { adjustment } : {}),
				feedback,
			},
			{ actor: instructor },
		);
	await grade(
		students[0]?.username ?? "",
		["correta", "pilha"],
		"Resposta completa.",
	);
	await grade(
		students[1]?.username ?? "",
		["errado", "pilha"],
		"O caso base está errado, mas o resto está bem explicado.",
		"0.2",
	);
	await grade(
		dev.username,
		["correta", "vaga"],
		"Falta dizer como a recursão para.",
	);

	await db.exam.update(
		{ course, slug: exam },
		{
			status: "COMPLETED",
			scheduledAt: new Date(Date.now() - 3 * 24 * 3600 * 1000),
			duration: { hours: 2 },
		},
		FULL_ACCESS,
	);
	await db.exam.releaseGrades({ course, slug: exam }, FULL_ACCESS);

	const ask = (author: User, submission: string | undefined, message: string) =>
		db.regradeRequest.create(
			{ course, submission: submission ?? "", message },
			{ actor: author },
		);
	const own = submissions[dev.username] ?? {};
	await ask(
		dev,
		own["stack-facts"],
		"Push adds to the top and a stack is last in, first out, so I do not see what is wrong.",
	);
	const ownAccepted = await ask(
		dev,
		own[essay],
		"Eu disse que a recursão precisa parar; o enunciado não pedia mais que isso.",
	);
	await db.regradeRequest.accept(
		{ publicId: ownAccepted.publicId },
		{
			score: "0.8",
			reply:
				"Nota parcial: o enunciado pedia a parada, mas faltou o caso base.",
		},
		{ actor: instructor },
	);
	const accepted = await ask(
		students[0] as User,
		submissions[students[0]?.username ?? ""]?.[essay],
		"Descrevi o caso base e o estouro de pilha, a nota deveria ser cheia.",
	);
	await db.regradeRequest.accept(
		{ publicId: accepted.publicId },
		{
			score: "1",
			reply: "Você tem razão, a resposta cobre tudo o que a rubrica pede.",
		},
		{ actor: instructor },
	);
	const rejected = await ask(
		students[1] as User,
		submissions[students[1]?.username ?? ""]?.[essay],
		"Meu caso base cobre listas de um elemento, deveria valer algum ponto.",
	);
	await db.regradeRequest.reject(
		{ publicId: rejected.publicId },
		{ reply: "O caso base precisa cobrir a lista vazia, então a nota fica." },
		{ actor: instructor },
	);
}

/**
 * Seeds the `practice` exam and the instructor's two simulations.
 *
 * The dev student sent `elm-soma` three times in the practice, each one
 * corrected by the bot. The instructor's simulation of `practice` is
 * delivered: the objective answers are graded on delivery, the code answer
 * waits for manual correction and the Elm send was corrected by the bot. The
 * simulation of the draft `final` is under way, with an Elm send waiting for a
 * worker. Students see neither simulation.
 */
async function seedPracticeAndSimulations(
	course: Course["id"],
	instructor: User,
): Promise<void> {
	const worker = "elm-test";
	const bot = { actor: { ...instructor, bot: "runner" } };
	const devStudent = await db.user.findOne(
		{ username: DEV_STUDENT_USERNAME },
		FULL_ACCESS,
	);
	if (!devStudent) throw new Error("The dev student account is missing.");
	const essay =
		"A base case is where the recursion stops; without it the calls never return.";

	await createQuestion(course, "ts-sum-of-squares", {
		type: "essay",
		title: "Sum of squares, typed",
		stem: "Write a TypeScript function `sumOfSquares(n: number): number` and print `sumOfSquares(10)`.",
		epilogue: "Print only the number.",
		tags: ["typescript"],
		content: "code",
		highlight: "typescript",
	});
	await seedElmPretestQuestions(course);
	await db.exam.create(
		{
			course,
			slug: "practice",
			type: "PRACTICE",
			status: "ONGOING",
			title: "Practice: code and recursion",
			description:
				"Send as many times as you like. Code runs in the browser by the practice default, and two Elm questions run their pretests there: an examples block and linked test modules.",
			tags: ["practice", "javascript", "elm"],
			questions: [
				{ slug: "js-double-it", version: "v1" },
				{ slug: "ts-sum-of-squares", version: "v1" },
				{ slug: "recursion-basics", version: "v1" },
				{ slug: "factorial-of-five", version: "v1" },
				{ slug: "elm-soma", version: "v1" },
				{ slug: "elm-sequences", version: "v1" },
				{ slug: "elm-vowels", version: "v1" },
			],
		},
		FULL_ACCESS,
	);
	await db.exam.update(
		{ course, slug: "final" },
		{
			questions: [
				{ slug: "big-o-warmup", version: "v1" },
				{ slug: "recursion-basics", version: "v1" },
				{ slug: "explain-recursion", version: "v1" },
				{ slug: "elm-soma", version: "v1" },
			],
		},
		FULL_ACCESS,
	);

	/// Answers one question as `actor`; returns the submission id.
	const answer = async (
		actor: User,
		exam: string,
		question: string,
		payload: QuestionResponse,
		kind?: "SUBMIT",
	): Promise<string> => {
		const response = await db.response.submit(
			{ course, exam, question, payload, ...(kind ? { kind } : {}) },
			{ actor },
		);
		return response.submissions.at(-1)?.publicId ?? "";
	};
	/// Has the bot claim the queued job of `exam`, which must be `submission`'s.
	const claim = async (exam: string, submission: string): Promise<void> => {
		const [job] = await db.gradingJob.claim(
			{ workers: [worker], limit: 1, exam },
			bot,
		);
		if (job?.submission !== submission) {
			throw new Error(
				`[seed] the bot claimed ${job?.submission}, not ${submission}.`,
			);
		}
	};
	const partial = {
		empty: "pass",
		one: "pass",
		long: "pass",
		negatives: "fail",
	} as const;
	const noHidden = {
		empty: "pass",
		one: "pass",
		long: "fail",
		negatives: "fail",
	} as const;
	const pass = {
		empty: "pass",
		one: "pass",
		long: "pass",
		negatives: "pass",
	} as const;

	for (const [code, verdicts] of [
		[ELM_ANSWERS.firstOnly, noHidden],
		[ELM_ANSWERS.positives, partial],
		[ELM_ANSWERS.correct, pass],
	] as const) {
		const sent = await answer(
			devStudent,
			"practice",
			"elm-soma",
			code,
			"SUBMIT",
		);
		await claim("practice", sent);
		await db.gradingJob.complete(sent, elmReport(verdicts), bot);
	}

	await answer(instructor, "practice", "recursion-basics", "tail-call");
	await answer(instructor, "practice", "factorial-of-five", 120);
	await answer(
		instructor,
		"practice",
		"js-double-it",
		"const n = Number(prompt('Number?'));\nconsole.log(n * 2);",
	);
	const sent = await answer(
		instructor,
		"practice",
		"elm-soma",
		ELM_ANSWERS.positives,
		"SUBMIT",
	);
	await claim("practice", sent);
	await db.gradingJob.complete(sent, elmReport(partial), bot);
	await db.response.finish({ course, exam: "practice" }, { actor: instructor });

	await answer(instructor, "final", "recursion-basics", "base-case");
	await answer(instructor, "final", "explain-recursion", essay);
	await answer(
		instructor,
		"final",
		"elm-soma",
		ELM_ANSWERS.positives,
		"SUBMIT",
	);
}

//
// Utility functions
//
/// Creates a resource of `course`.
function createResource(
	course: Course["id"],
	slug: string,
	title: string,
	data: Parameters<typeof db.resource.create>[0]["data"],
	rev: string,
	description?: string,
): Promise<unknown> {
	return db.resource.create(
		{ course, slug, title, data, rev, ...(description ? { description } : {}) },
		FULL_ACCESS,
	);
}

/// Creates a weekly time slot of `course`.
function createSlot(
	course: Course["id"],
	slug: string,
	title: string,
	day: Parameters<typeof db.timeSlot.create>[0]["day"],
	start: Parameters<typeof db.timeSlot.create>[0]["start"],
	duration: Parameters<typeof db.timeSlot.create>[0]["duration"],
) {
	return db.timeSlot.create(
		{ course, slug, title, day, start, duration },
		FULL_ACCESS,
	);
}

/// Creates a v1 question of `course` from its body, published unless `status` says otherwise.
function createQuestion(
	course: Course["id"],
	slug: string,
	body: Parameters<typeof db.question.create>[0]["question"],
	status: "DRAFT" | "PUBLISHED" = "PUBLISHED",
): Promise<unknown> {
	return db.question.create(
		{ course, slug, status, version: "v1", question: body },
		FULL_ACCESS,
	);
}

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
