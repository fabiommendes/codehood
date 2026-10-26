import { expect, type Locator, type Page, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { type Course, db, type TimeSlot } from "@/db";
import { prisma } from "@/db/client";
import { persistedCalendarEventFactory } from "@/fixtures/calendar-event.factory";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedTimeSlotFactory } from "@/fixtures/time-slot.factory";
import { codeAt } from "@/services/roll-call-code";
import { courseHref } from "@/urls";
import {
	fillField,
	futureDate,
	logInAs,
	resetDatabase,
	seedUser,
} from "./helpers";

/*
 * UI contract assumed by these stories. The spec leaves the wording open, so
 * the implementation should use these strings (exact unless noted).
 *
 * Check-in page (`/check-in`)
 *   - A field in a fieldset with legend "Code" and a button "Register".
 *   - Success: "Attendance recorded for <meeting title>".
 *   - Typed code that matches no open roll call: "That code is not valid."
 *
 * Check-in link (`/c/<rollCallId>/<code>`)
 *   - Success: "<student name>, present!" and "Attendance recorded for <meeting title>".
 *   - Scanning again once present: "Attendance already recorded for <meeting title>".
 *   - Any refusal also reads "Attendance not recorded", with a link "Type the
 *     code instead" for a wrong or expired code and "Go to my courses" for the
 *     other refusals of a logged-in student.
 *   - Code that rotated away more than 30 s ago: "That code has expired."
 *   - Closed roll call: "This roll call is closed."
 *   - Not in the course and the roll call is not an invite:
 *     "You are not enrolled in this course."
 *   - Logged out, roll call not an invite: redirects to `/login` (the login
 *     form, with the ordinary labels); after logging in the user is back on
 *     the success text.
 *   - Logged out, roll call is an invite: the page holds the sign-up form of
 *     the classroom invite page (fieldsets Email, Username, Name, GitHub
 *     username, School id, Password, Confirm password; button "Create
 *     account"). Submitting it shows the success text.
 *   - When the check-in created the enrollment: "You joined <discipline name>."
 *
 * Course home (`<course>`)
 *   - While a roll call is open: a link "Check in".
 *   - A link "Attendance: <present> of <total> (<percent>%)" to the attendance
 *     page.
 *
 * Schedule (`<course>/schedule`)
 *   - Each meeting is an element whose id starts with `event-`. A past meeting
 *     with a roll call holds the text "Present" or "Absent" (exact).
 *
 * Attendance page (`<course>/attendance`)
 *   - Table with column headers "Student", one per meeting titled with the
 *     "Present", "Total", "%", then one per meeting title (date order). First cell: the
 *     name. Meeting cells read "Present", "Absent" or "-". The last three
 *     read like "2", "3", "67%". A student sees only their own row.
 *
 * Roll call management page (`<course>/roll-call/<week>/<timeSlot>`)
 *   - One table row per enrolled student, holding the student's name; a row
 *     whose attendance created the enrollment or the account holds the badge
 *     "New in this class".
 */

test.beforeEach(resetDatabase);

const DAY = 24 * 60 * 60_000;

test("student: Check in to class", async ({ page }) => {
	const instructor = await seedUser({
		role: "INSTRUCTOR",
		username: "sa-teacher",
	});
	const { course, href, slot } = await classroom(instructor.username);
	const arrays = await calendarEvent(course.id, slot.id, 0, "sa-Arrays");
	await calendarEvent(course.id, slot.id, 1, "sa-Sorting");
	await calendarEvent(course.id, slot.id, 2, "sa-Hashing");
	const ana = await enrolledStudent(course.id, "sa-ana", "Ana Prado");
	const other = await enrolledStudent(course.id, "sa-other", "Otto Hall");

	const rollArrays = await openRollCall(course.id, slot.id, 0);
	const rollSorting = await openRollCall(course.id, slot.id, 1);
	const rollHashing = await openRollCall(course.id, slot.id, 2);
	await db.rollCall.close({ id: rollHashing.id }, FULL_ACCESS);
	await db.rollCall.update(
		{ id: rollArrays.id },
		{ attendances: { [other.username]: {} } },
		FULL_ACCESS,
	);
	const beforeTerm = new Date(arrays.startAt.getTime() - DAY);
	for (const s of [ana, other]) {
		await prisma.enrollment.update({
			where: {
				username_courseId: { username: s.username, courseId: course.id },
			},
			data: { createdAt: beforeTerm },
		});
	}

	await logInAs(page, ana);

	await test.step("an open roll call puts a shortcut on the course home", async () => {
		await page.goto(href);
		await expect(page.getByRole("link", { name: "Check in" })).toBeVisible();
	});

	await test.step("a wrong code is refused", async () => {
		await page.getByRole("link", { name: "Check in" }).click();
		await expect(page).toHaveURL("/check-in");
		await fillField(page, "Code", "ZZZZZZ");
		await page.getByRole("button", { name: "Register" }).click();
		await expect(page.getByText("That code is not valid.")).toBeVisible();
	});

	await test.step("a code that rotated away long ago is refused as expired", async () => {
		const stale = codeAt(rollArrays.secret, new Date(Date.now() - 120_000));
		await page.goto(`/c/${rollArrays.id}/${stale.code}`);
		await expect(page.getByText("That code has expired.")).toBeVisible();
		await expect(page.getByText("Attendance not recorded")).toBeVisible();
		await expect(
			page.getByRole("link", { name: "Type the code instead" }),
		).toBeVisible();
		expect(await attended(rollArrays.id, ana.username)).toBe(false);
	});

	await test.step("a closed roll call sends to the courses, since typing the code cannot help", async () => {
		await page.goto(`/c/${rollHashing.id}/${currentCode(rollHashing)}`);
		await expect(page.getByText("This roll call is closed.")).toBeVisible();
		await expect(
			page.getByRole("link", { name: "Type the code instead" }),
		).toHaveCount(0);
		await expect(
			page.getByRole("link", { name: "Go to my courses" }),
		).toBeVisible();
	});

	await test.step("scanning the QR logged out goes through the login and back to the confirmation", async () => {
		await page.context().clearCookies();
		await page.goto(`/c/${rollArrays.id}/${currentCode(rollArrays)}`);
		await expect(page).toHaveURL(/\/login/);

		await fillField(page, "Email or username", ana.username);
		await fillField(page, "Password", ana.password);
		await page.getByRole("button", { name: "Log in" }).click();

		await expect(page.getByText("Ana Prado, present!")).toBeVisible();
		await expect(
			page.getByText("Attendance recorded for sa-Arrays"),
		).toBeVisible();
		expect(await attended(rollArrays.id, ana.username)).toBe(true);
	});

	await test.step("scanning again says the attendance was already recorded", async () => {
		await page.goto(`/c/${rollArrays.id}/${currentCode(rollArrays)}`);
		await expect(
			page.getByText("Attendance already recorded for sa-Arrays"),
		).toBeVisible();
		await expect(page.getByText("Attendance recorded for")).toHaveCount(0);
	});

	await test.step("a code typed at the check-in page registers another meeting", async () => {
		await page.goto("/check-in");
		await fillField(page, "Code", currentCode(rollSorting));
		await page.getByRole("button", { name: "Register" }).click();
		await expect(
			page.getByText("Attendance recorded for sa-Sorting"),
		).toBeVisible();
	});

	await test.step("the course home counts the roll calls attended, leading to their own row", async () => {
		await page.goto(href);
		await page.getByRole("link", { name: "Attendance: 2 of 3 (67%)" }).click();
		await expect(page).toHaveURL(`${href}/attendance`);

		await expect(page.getByRole("columnheader")).toHaveText([
			"Student",
			"Present",
			"Total",
			"%",
			"sa-Arrays",
			"sa-Sorting",
			"sa-Hashing",
		]);
		const own = page.getByRole("row").filter({ hasText: "Ana Prado" });
		const cells = own.getByRole("cell");
		for (const [i, text] of [
			"2",
			"3",
			"67%",
			"Present",
			"Present",
			"Absent",
		].entries()) {
			await expect(cells.nth(i + 1)).toHaveText(text);
		}
		await expect(
			page.getByRole("row").filter({ hasText: "Otto Hall" }),
		).toHaveCount(0);
	});

	await test.step("the schedule marks each past meeting that had a roll call", async () => {
		await page.goto(`${href}/schedule`);
		await expect(
			meeting(page, "sa-Arrays").getByText("Present", { exact: true }),
		).toBeVisible();
		await expect(
			meeting(page, "sa-Sorting").getByText("Present", { exact: true }),
		).toBeVisible();
		await expect(
			meeting(page, "sa-Hashing").getByText("Absent", { exact: true }),
		).toBeVisible();
	});
});

test("student: Join the class through the roll call", async ({
	page,
	browser,
}) => {
	const instructor = await seedUser({
		role: "INSTRUCTOR",
		username: "sj-teacher",
	});
	const { course, href, slot } = await classroom(instructor.username);
	await calendarEvent(course.id, slot.id, 0, "sj-Graphs");
	await calendarEvent(course.id, slot.id, 1, "sj-Trees");
	await enrolledStudent(course.id, "sj-regular", "Rita Regular");
	const visitor = await seedUser({
		role: "STUDENT",
		username: "sj-visitor",
		name: "Vera Visitor",
	});

	const invite = await openRollCall(course.id, slot.id, 0, true);
	const plain = await openRollCall(course.id, slot.id, 1, false);

	await logInAs(page, visitor);

	await test.step("a roll call that is not an invite refuses someone outside the course", async () => {
		await page.goto(`/c/${plain.id}/${currentCode(plain)}`);
		await expect(
			page.getByText("You are not enrolled in this course."),
		).toBeVisible();
		expect(await enrollmentOf(course.id, visitor.username)).toBeNull();
	});

	await test.step("an invite enrolls a student who has an account, and marks them present", async () => {
		await page.goto(`/c/${invite.id}/${currentCode(invite)}`);
		await expect(
			page.getByText("Attendance recorded for sj-Graphs"),
		).toBeVisible();
		await expect(
			page.getByText(`You joined ${course.discipline.name}.`),
		).toBeVisible();
		expect(await enrollmentOf(course.id, visitor.username)).toBe("ACTIVE");
	});

	await test.step("someone with no account signs up on the same page and ends up in the class", async () => {
		await page.context().clearCookies();
		await page.goto(`/c/${invite.id}/${currentCode(invite)}`);
		await fillField(page, "Email", "sj-newbie@codehood.test");
		await fillField(page, "Username", "sj-newbie");
		await fillField(page, "Name", "Nina Newbie");
		await fillField(page, "GitHub username", "sj-newbie");
		await fillField(page, "School id", "sj-newbie");
		await fillField(page, "Password", "correcthorse");
		await fillField(page, "Confirm password", "correcthorse");
		await page.getByRole("button", { name: "Create account" }).click();

		await expect(
			page.getByText("Attendance recorded for sj-Graphs"),
		).toBeVisible();
		await page.goto("/courses");
		await expect(
			page.getByRole("heading", { name: course.discipline.name }),
		).toBeVisible();
		expect(await enrollmentOf(course.id, "sj-newbie")).toBe("ACTIVE");
		const entries = await prisma.attendance.findMany({
			where: { rollCallId: invite.id },
			orderBy: { username: "asc" },
		});
		expect(entries.map((e) => [e.username, e.source, e.joined])).toEqual([
			["sj-newbie", "CODE", "ACCOUNT"],
			["sj-visitor", "CODE", "ENROLLMENT"],
		]);
	});

	await test.step("the instructor sees the newcomers flagged", async () => {
		const teacherContext = await browser.newContext();
		const teacher = await teacherContext.newPage();
		await logInAs(teacher, instructor);
		await teacher.goto(`${href}/roll-call/0/${slot.slug}`);

		for (const name of ["Nina Newbie", "Vera Visitor"]) {
			await expect(
				teacher.getByRole("row").filter({ hasText: name }),
			).toContainText("New in this class");
		}
		await expect(
			teacher.getByRole("row").filter({ hasText: "Rita Regular" }),
		).not.toContainText("New in this class");
		await teacherContext.close();
	});
});

/// A course that began four weeks ago, with a weekly slot on today's weekday.
async function classroom(instructor: string) {
	const course = await persistedCourseFactory.create({
		instructor,
		startAt: new Date(Date.now() - 28 * DAY),
		endAt: new Date(Date.now() + 70 * DAY),
	});
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor,
		edition: course.edition.slug,
	});
	const slot = await persistedTimeSlotFactory.create({
		course: course.id,
		day: futureDate(0).day,
	});
	return { course, href, slot };
}

/// The schedule entry holding `title`.
function meeting(page: Page, title: string): Locator {
	return page.locator('[id^="event-"]').filter({ hasText: title });
}

/// Creates a regular event of the time slot.
async function calendarEvent(
	course: Course["id"],
	timeSlot: TimeSlot["id"],
	week: number,
	title: string,
) {
	return persistedCalendarEventFactory.create({
		course,
		timeSlot,
		week,
		title,
	});
}

/// Seeds a student and enrolls them.
async function enrolledStudent(
	course: Course["id"],
	username: string,
	name: string,
) {
	const student = await seedUser({ role: "STUDENT", username, name });
	await db.enrollment.create({ course, username }, FULL_ACCESS);
	return student;
}

/// Opens the roll call of an event and reads back the secret its codes derive from.
async function openRollCall(
	course: Course["id"],
	timeSlot: TimeSlot["id"],
	week: number,
	actsAsInvite = false,
) {
	const created = await db.rollCall.create(
		{ event: { course, week, timeSlot }, actsAsInvite },
		FULL_ACCESS,
	);
	const row = await prisma.rollCall.findUniqueOrThrow({
		where: { id: created.id },
	});
	return { id: row.id, secret: row.secret };
}

/// The code the projector shows right now.
function currentCode(rollCall: { secret: string }): string {
	return codeAt(rollCall.secret, new Date()).code;
}

/// Whether `username` is marked present in the roll call.
async function attended(rollCallId: number, username: string) {
	const row = await prisma.attendance.findFirst({
		where: { rollCallId, username },
	});
	return row !== null;
}

/// The status of the enrollment, or null if there is none.
async function enrollmentOf(course: Course["id"], username: string) {
	const row = await prisma.enrollment.findFirst({
		where: { courseId: course, username },
	});
	return row?.status ?? null;
}
