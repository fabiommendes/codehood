import { expect, type Locator, type Page, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { type Course, db, type TimeSlot } from "@/db";
import { prisma } from "@/db/client";
import { persistedCalendarEventFactory } from "@/fixtures/calendar-event.factory";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedTimeSlotFactory } from "@/fixtures/time-slot.factory";
import { codeAt } from "@/services/roll-call-code";
import { courseHref } from "@/urls";
import { futureDate, logInAs, resetDatabase, seedUser } from "./helpers";

/*
 * UI contract assumed by these stories. The spec leaves the wording open, so
 * the implementation should use these strings (exact unless noted).
 *
 * Schedule (`<course>/schedule`)
 *   - Each meeting is an element whose id starts with `event-` and that holds
 *     the meeting title.
 *   - Eligible meetings (not holiday, not cancelled) hold a button "Roll call"
 *     when they have no roll call yet, and a link "Roll call" when they do.
 *   - The button opens a dialog with a checkbox "Counts as an invite"
 *     (unchecked) and a button "Open roll call". Submitting lands on the
 *     management page.
 *
 * Management page (`<course>/roll-call/<week>/<timeSlot>`)
 *   - Heading with the meeting title.
 *   - Text "Roll call open" or "Roll call closed"; while open, a countdown
 *     matching /Closes in \d+:\d{2}/.
 *   - Link "Project"; buttons "Close roll call" and "Reopen roll call" (only
 *     the one that applies is present).
 *   - One table row per enrolled student, holding the student's name, a
 *     checkbox "Present", a textbox "Note" and a button "Save". "Save" submits
 *     the checkbox and the note together. Checked + Save marks the student
 *     present by hand; unchecked + Save removes the attendance.
 *   - A badge "Same device as <username>" on a row whose attendance shares a
 *     browser with another student's.
 *   - While the roll call is open the page refreshes itself, so a check-in
 *     appears without reloading (within 15 s).
 *
 * Projection page (`.../project`)
 *   - An image named "QR code to check in".
 *   - The current code in an element labelled "Check-in code" (aria-label),
 *     text of the 6 characters, spaces allowed.
 *   - Text "<n> present" with the number of attendances.
 *   - Text matching /Closes in \d+:\d{2}/.
 *
 * Student side, used here only to make students arrive
 *   - `/c/<rollCallId>/<code>` for a logged in enrolled student shows
 *     "Attendance recorded for <meeting title>" or, when the roll call is
 *     closed, "This roll call is closed."
 *
 * Attendance page (`<course>/attendance`) and Grades tab
 *   - The Grades table has a column "Attendance" whose header is a link to the
 *     attendance page and whose cells read like "100%". There is no
 *     "Attendance" tab.
 *   - A table with column headers: "Student", one per meeting titled with the
 *     "Present", "Total", "%", then one per meeting title (date order). Rows are in
 *     username order. First cell: the student's name, plus the text "Dropped"
 *     for a dropped student. Meeting cells read "Present", "Absent" or "-".
 *     The last three cells read like "3", "3", "100%".
 *   - Button "Download CSV" (the `CsvDownload` component, as on `/grades`).
 *     Content follows `attendanceCsvRows`: header
 *     `username,name,schoolId,status,<week>/<timeSlot>...,present,total,%`;
 *     one `1`, `0` or `-` per meeting; status `active` or `dropped`; percent
 *     with two decimals (`33.33`). Lines are joined by CRLF, no trailing one.
 */

test.beforeEach(resetDatabase);

const DAY = 24 * 60 * 60_000;

test("instructor: Take the roll call in class", async ({ page, browser }) => {
	const instructor = await seedUser({
		role: "INSTRUCTOR",
		username: "ia-teacher",
	});
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		startAt: new Date(Date.now() - 28 * DAY),
		endAt: new Date(Date.now() + 70 * DAY),
	});
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: instructor.username,
		edition: course.edition.slug,
	});
	const slot = await persistedTimeSlotFactory.create({
		course: course.id,
		day: futureDate(0).day,
	});
	await calendarEvent(course.id, slot.id, 0, "ia-Pointers");
	await calendarEvent(course.id, slot.id, 1, "ia-Spring break", "HOLIDAY");

	const ana = await enrolledStudent(course.id, "ia-ana", "Ana Prado");
	const bia = await enrolledStudent(course.id, "ia-bia", "Bia Lima");
	const caio = await enrolledStudent(course.id, "ia-caio", "Caio Reis");
	const dia = await enrolledStudent(course.id, "ia-dia", "Dia Sol");

	await logInAs(page, instructor);
	await page.goto(`${href}/schedule`);

	await test.step("a holiday offers no roll call", async () => {
		const holiday = meeting(page, "ia-Spring break");
		await expect(holiday).toBeVisible();
		await expect(
			holiday.getByRole("button", { name: "Roll call" }),
		).toHaveCount(0);
		await expect(holiday.getByRole("link", { name: "Roll call" })).toHaveCount(
			0,
		);
	});

	await test.step("opening the roll call of a meeting lands on its page", async () => {
		await meeting(page, "ia-Pointers")
			.getByRole("button", { name: "Roll call" })
			.click();
		const dialog = page.getByRole("dialog");
		await expect(
			dialog.getByRole("checkbox", { name: "Counts as an invite" }),
		).not.toBeChecked();
		await dialog.getByRole("button", { name: "Open roll call" }).click();

		await expect(page).toHaveURL(`${href}/roll-call/0/${slot.slug}`);
		await expect(
			page.getByRole("heading", { name: "ia-Pointers" }),
		).toBeVisible();
		await expect(page.getByText("Roll call open")).toBeVisible();
		await expect(page.getByText(/Closes in \d+:\d{2}/)).toBeVisible();
	});

	const rollCall = await prisma.rollCall.findFirstOrThrow({
		where: { event: { courseId: course.id } },
	});
	const manage = page.url();

	await test.step("the projection shows the QR code, the current code and who is in", async () => {
		await page.getByRole("link", { name: "Project" }).click();
		await expect(page).toHaveURL(`${manage}/project`);
		await expect(
			page.getByRole("img", { name: "QR code to check in" }),
		).toBeVisible();
		await expect(page.getByText("0 present")).toBeVisible();
		await expect(page.getByText(/Closes in \d+:\d{2}/)).toBeVisible();

		const shown = (await page.getByLabel("Check-in code").innerText()).replace(
			/\s/g,
			"",
		);
		// The code rotates every 15 s and the page polls every 3 s, so the one
		// on screen may already be a window behind.
		const now = Date.now();
		expect([
			codeAt(rollCall.secret, new Date(now)).code,
			codeAt(rollCall.secret, new Date(now - 15_000)).code,
		]).toContain(shown);
		await page.goto(manage);
	});

	const studentBrowser = await browser.newContext();
	const classmate = await studentBrowser.newPage();

	await test.step("students arriving show up without reloading", async () => {
		await scan(classmate, rollCall, ana);
		await expect(classmate.getByText("Attendance recorded for")).toBeVisible();
		await expect(
			studentRow(page, "Ana Prado").getByRole("checkbox", { name: "Present" }),
		).toBeChecked({ timeout: 20_000 });
		await expect(
			studentRow(page, "Caio Reis").getByRole("checkbox", { name: "Present" }),
		).not.toBeChecked();
	});

	await test.step("two students from the same browser flag each other", async () => {
		await scan(classmate, rollCall, bia);
		const biaRow = studentRow(page, "Bia Lima");
		await expect(
			biaRow.getByText(`Same device as ${ana.username}`),
		).toBeVisible({ timeout: 20_000 });
		await expect(
			studentRow(page, "Ana Prado").getByText(`Same device as ${bia.username}`),
		).toBeVisible();
	});

	await test.step("the instructor removes the one who was not there", async () => {
		const biaRow = studentRow(page, "Bia Lima");
		await biaRow.getByRole("checkbox", { name: "Present" }).uncheck();
		await biaRow.getByRole("button", { name: "Save" }).click();

		await expect(
			studentRow(page, "Bia Lima").getByRole("checkbox", { name: "Present" }),
		).not.toBeChecked();
		await expect(page.getByText(/Same device as/)).toHaveCount(0);
		expect(await attendees(rollCall.id)).toEqual([ana.username]);
	});

	await test.step("a student without a phone is marked by hand, with a note", async () => {
		const diaRow = studentRow(page, "Dia Sol");
		await diaRow.getByRole("checkbox", { name: "Present" }).check();
		await diaRow.getByRole("textbox", { name: "Note" }).fill("atestado");
		await diaRow.getByRole("button", { name: "Save" }).click();

		await page.reload();
		const saved = studentRow(page, "Dia Sol");
		await expect(
			saved.getByRole("checkbox", { name: "Present" }),
		).toBeChecked();
		await expect(saved.getByRole("textbox", { name: "Note" })).toHaveValue(
			"atestado",
		);
		const entry = await prisma.attendance.findFirstOrThrow({
			where: { rollCallId: rollCall.id, username: dia.username },
		});
		expect(entry).toMatchObject({ source: "MANUAL", note: "atestado" });
	});

	await test.step("a closed roll call refuses check-ins", async () => {
		await page.getByRole("button", { name: "Close roll call" }).click();
		await expect(page.getByText("Roll call closed")).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Reopen roll call" }),
		).toBeVisible();

		await scan(classmate, rollCall, caio);
		await expect(
			classmate.getByText("This roll call is closed."),
		).toBeVisible();
		expect(await attendees(rollCall.id)).not.toContain(caio.username);
	});

	await test.step("reopening gives the class another round", async () => {
		await page.getByRole("button", { name: "Reopen roll call" }).click();
		await expect(page.getByText("Roll call open")).toBeVisible();
		await expect(page.getByText(/Closes in \d+:\d{2}/)).toBeVisible();

		await scan(classmate, rollCall, caio);
		await expect(classmate.getByText("Attendance recorded for")).toBeVisible();
		await expect(
			studentRow(page, "Caio Reis").getByRole("checkbox", { name: "Present" }),
		).toBeChecked({ timeout: 20_000 });
	});

	expect(await attendees(rollCall.id)).toEqual(
		[ana.username, caio.username, dia.username].sort(),
	);
	await studentBrowser.close();
});

test("instructor: Read the course's attendance", async ({ page }) => {
	const instructor = await seedUser({
		role: "INSTRUCTOR",
		username: "ra-teacher",
	});
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		startAt: new Date(Date.now() - 28 * DAY),
		endAt: new Date(Date.now() + 70 * DAY),
	});
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: instructor.username,
		edition: course.edition.slug,
	});
	const slot = await persistedTimeSlotFactory.create({
		course: course.id,
		day: futureDate(0).day,
	});
	await persistedExamFactory.create({
		course: course.id,
		slug: "ra-midterm",
		title: "ra-Midterm",
		type: "EXAM",
		status: "COMPLETED",
		scheduledAt: new Date(Date.now() - 10 * DAY),
	});

	const events = [
		await calendarEvent(course.id, slot.id, 0, "ra-Intro"),
		await calendarEvent(course.id, slot.id, 1, "ra-Loops"),
		await calendarEvent(course.id, slot.id, 2, "ra-Recursion"),
	];
	const ana = await enrolledStudent(course.id, "ra-ana", "Ana Prado");
	const bia = await enrolledStudent(course.id, "ra-bia", "Bia Lima");
	const gone = await enrolledStudent(course.id, "ra-gone", "Gus Gone");
	const late = await enrolledStudent(course.id, "ra-late", "Lia Late");

	const present = [
		[ana, gone],
		[ana, bia, late],
		[ana, bia],
	];
	for (const [week, who] of present.entries()) {
		const rollCall = await db.rollCall.create(
			{ event: { course: course.id, week, timeSlot: slot.id } },
			FULL_ACCESS,
		);
		await db.rollCall.update(
			{ id: rollCall.id },
			{
				attendances: Object.fromEntries(
					who.map((s) => [s.username, {} as { note?: string }]),
				),
			},
			FULL_ACCESS,
		);
		await db.rollCall.close({ id: rollCall.id }, FULL_ACCESS);
	}
	await db.enrollment.delete(
		{ course: course.id, username: gone.username },
		FULL_ACCESS,
	);
	// Enrollment dates decide which meetings were held before a student joined.
	const beforeTerm = new Date(Date.now() - 29 * DAY);
	for (const s of [ana, bia, gone])
		await backdate(course.id, s.username, beforeTerm);
	await backdate(
		course.id,
		late.username,
		new Date((events[0]?.startAt.getTime() ?? 0) + DAY),
	);

	await logInAs(page, instructor);

	await test.step("the Grades tab shows each student's attendance and links to the details", async () => {
		await page.goto(`${href}/grades`);
		const grades = page.getByRole("table", { name: "Grades", exact: true });
		await expect(
			grades.getByRole("row").filter({ hasText: "Ana Prado" }),
		).toContainText("100%");
		await expect(
			grades.getByRole("row").filter({ hasText: "Bia Lima" }),
		).toContainText("67%");
		await expect(page.getByRole("tab", { name: "Attendance" })).toHaveCount(0);

		await grades.getByRole("link", { name: "Attendance" }).click();
		await expect(page).toHaveURL(`${href}/attendance`);
	});

	await test.step("the table has a cell for every student and meeting, `-` before enrollment", async () => {
		await expect(page.getByRole("columnheader")).toHaveText([
			"Student",
			"Present",
			"Total",
			"%",
			"ra-Intro",
			"ra-Loops",
			"ra-Recursion",
		]);
		await expectRow(page, "Ana Prado", [
			"3",
			"3",
			"100%",
			"Present",
			"Present",
			"Present",
		]);
		await expectRow(page, "Bia Lima", [
			"2",
			"3",
			"67%",
			"Absent",
			"Present",
			"Present",
		]);
		// Held before Lia enrolled: shown as `-`, still counted in the total.
		await expectRow(page, "Lia Late", [
			"1",
			"3",
			"33%",
			"-",
			"Present",
			"Absent",
		]);
	});

	await test.step("a student who dropped stays, marked, with the attendance they had", async () => {
		await expectRow(page, "Gus Gone", [
			"1",
			"3",
			"33%",
			"Present",
			"Absent",
			"Absent",
		]);
		await expect(
			page.getByRole("row").filter({ hasText: "Gus Gone" }),
		).toContainText("Dropped");
	});

	await test.step("the CSV carries the same table", async () => {
		const [download] = await Promise.all([
			page.waitForEvent("download"),
			page.getByRole("button", { name: "Download CSV" }).click(),
		]);
		const stream = await download.createReadStream();
		const chunks: Buffer[] = [];
		for await (const chunk of stream) chunks.push(chunk as Buffer);

		const s = slot.slug;
		expect(Buffer.concat(chunks).toString("utf8").split("\r\n")).toEqual([
			`username,name,schoolId,status,0/${s},1/${s},2/${s},present,total,%`,
			"ra-ana,Ana Prado,ra-ana,active,1,1,1,3,3,100.00",
			"ra-bia,Bia Lima,ra-bia,active,0,1,1,2,3,66.67",
			"ra-gone,Gus Gone,ra-gone,dropped,1,0,0,1,3,33.33",
			"ra-late,Lia Late,ra-late,active,-,1,0,1,3,33.33",
		]);
	});
});

/// The schedule entry holding `title`.
function meeting(page: Page, title: string): Locator {
	return page.locator('[id^="event-"]').filter({ hasText: title });
}

/// The management page row of the student called `name`.
function studentRow(page: Page, name: string): Locator {
	return page.getByRole("row").filter({ hasText: name });
}

/// Asserts the present, total, percent and meeting cells of `name`'s row.
async function expectRow(page: Page, name: string, cells: string[]) {
	const row = page.getByRole("row").filter({ hasText: name });
	const all = row.getByRole("cell");
	await expect(all.first()).toContainText(name);
	for (const [i, text] of cells.entries()) {
		await expect(all.nth(i + 1)).toHaveText(text);
	}
}

/// Creates an event of the time slot.
async function calendarEvent(
	course: Course["id"],
	timeSlot: TimeSlot["id"],
	week: number,
	title: string,
	kind: "REGULAR" | "HOLIDAY" = "REGULAR",
) {
	return persistedCalendarEventFactory.create({
		course,
		timeSlot,
		week,
		title,
		kind,
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

/// Moves the date an enrollment was created.
async function backdate(
	course: Course["id"],
	username: string,
	createdAt: Date,
) {
	await prisma.enrollment.update({
		where: { username_courseId: { username, courseId: course } },
		data: { createdAt },
	});
}

/// Usernames marked present in the roll call, sorted.
async function attendees(rollCallId: number): Promise<string[]> {
	const rows = await prisma.attendance.findMany({ where: { rollCallId } });
	return rows.map((r) => r.username).sort();
}

/// Logs the student in on `page` and visits the check-in link of the roll call.
async function scan(
	page: Page,
	rollCall: { id: number; secret: string },
	student: { username: string },
) {
	await logInAs(page, student);
	const { code } = codeAt(rollCall.secret, new Date());
	await page.goto(`/c/${rollCall.id}/${code}`);
}
