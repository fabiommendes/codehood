import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCalendarEventFactory } from "@/fixtures/calendar-event.factory";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedTimeSlotFactory } from "@/fixtures/time-slot.factory";
import { courseHref } from "@/urls";
import {
	fillField,
	logIn,
	logInAs,
	openTab,
	resetDatabase,
	seedUser,
} from "./helpers";

test.beforeEach(resetDatabase);

test("student: update my profile", async ({ page }) => {
	const student = await seedUser({ role: "STUDENT" });
	const other = await seedUser({ role: "STUDENT" });

	await logInAs(page, student);
	await page.goto("/profile");

	await test.step("the username is not editable", async () => {
		const username = page
			.getByRole("group", { name: "Username", exact: true })
			.locator("input");
		await expect(username).toBeDisabled();
	});

	await test.step("changed details are saved", async () => {
		await fillField(page, "Name", "Renamed Student");
		await fillField(page, "GitHub username", "renamed-gh");
		await page.getByRole("button", { name: "Save changes" }).click();
		await expect(page.getByText("Profile updated.")).toBeVisible();
	});

	await test.step("an email another user already has is refused, by name", async () => {
		await fillField(page, "Email", other.email);
		await page.getByRole("button", { name: "Save changes" }).click();
		await expect(page.getByText(/email is already in use/i)).toBeVisible();
	});

	const stored = await db.user.findOne(
		{ username: student.username },
		FULL_ACCESS,
	);
	expect(stored?.name).toBe("Renamed Student");
	expect(stored?.email).toBe(student.email);
});

test("student: change my password and log out everywhere", async ({ page }) => {
	const student = await seedUser({ role: "STUDENT" });

	await logInAs(page, student);
	await page.goto("/profile");
	await openTab(page, "Account");

	await test.step("a wrong current password is refused", async () => {
		await fillField(page, "Current password", "not-the-password");
		await fillField(page, "New password", "brandnewpassword");
		await fillField(page, "Confirm new password", "brandnewpassword");
		await page.getByRole("button", { name: "Change password" }).click();
		await expect(
			page.getByText(/current password is incorrect/i),
		).toBeVisible();
	});

	// The lab machine of the story: a session the student is not holding.
	const labMachine = await db.session.create(
		{ username: student.username },
		FULL_ACCESS,
	);

	await test.step("the right one is accepted", async () => {
		await openTab(page, "Account");
		await fillField(page, "Current password", student.password);
		await fillField(page, "New password", "brandnewpassword");
		await fillField(page, "Confirm new password", "brandnewpassword");
		await page.getByRole("button", { name: "Change password" }).click();
		await expect(page.getByText("Password changed.")).toBeVisible();
	});

	// Changing the password is itself what ends the lab machine's session —
	// the student does not have to reach "Log out everywhere" for that. The
	// browser in hand keeps working, so the change does not sign them out of
	// the device they made it from.
	await test.step("the session left behind on the lab machine is already dead", async () => {
		expect(await db.session.validate(labMachine.token)).toBeNull();
		expect((await page.goto("/profile"))?.status()).toBe(200);
		await expect(page).not.toHaveURL(/\/login/);
	});

	await test.step("logging out everywhere ends the session in hand", async () => {
		await openTab(page, "Account");
		await page.getByRole("button", { name: "Log out everywhere" }).click();
		await page.goto("/profile");
		await expect(page).toHaveURL(/\/login/);
	});

	await test.step("and the new password is what gets back in", async () => {
		await logIn(page, {
			username: student.username,
			password: "brandnewpassword",
		});
	});
});

test("student: leave a course", async ({ page }) => {
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create();
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});

	await logInAs(page, student);
	await page.goto(href);

	await test.step("the confirmation can be closed without leaving", async () => {
		const dialog = page.locator("#leave-course-dialog");
		await page.getByRole("button", { name: "Leave this course" }).click();
		await expect(dialog).toBeVisible();
		await dialog.getByRole("button", { name: "Close", exact: true }).click();
		await expect(dialog).toBeHidden();
	});

	await test.step("the student leaves the course themselves", async () => {
		await page.getByRole("button", { name: "Leave this course" }).click();
		await page
			.locator("#leave-course-dialog")
			.getByRole("button", { name: "Leave course" })
			.click();
		await expect(page).toHaveURL(/\/courses/);
	});

	await test.step("it disappears from their course list", async () => {
		await expect(
			page.getByRole("heading", { name: course.discipline.name }),
		).toHaveCount(0);
	});

	// Nothing was destroyed — an instructor re-enrolling them would restore
	// access to whatever they already submitted.
	const enrollment = await db.enrollment.findOne(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	expect(enrollment?.status).toBe("DROPPED");
});

test("student: subscribe to my calendar in another app", async ({ page }) => {
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create();
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	const slot = await persistedTimeSlotFactory.create({ course: course.id });
	await persistedCalendarEventFactory.create({
		course: course.id,
		timeSlot: slot.id,
		week: 1,
		title: "Sub-Lab",
	});
	const scheduledAt = new Date(Date.now() + 5 * 86_400_000);
	await persistedExamFactory.create({
		course: course.id,
		slug: "sub-midterm",
		title: "Sub-Midterm",
		scheduledAt,
	});
	await persistedExamFactory.create({
		course: course.id,
		slug: "sub-draft",
		title: "Sub-Draft",
		status: "DRAFT",
		scheduledAt,
	});

	const linkField = page.getByRole("textbox", { name: "Calendar link" });
	const createLink = page.getByRole("button", { name: "Create link" });

	/// The feed address the profile shows, read back from the field.
	async function shownUrl(): Promise<string> {
		const value = await linkField.inputValue();
		expect(value).toMatch(/^https?:\/\/.+\.ics$/);
		return value;
	}

	await logInAs(page, student);

	await test.step("the Calendar page points to the profile tab", async () => {
		await page.goto("/calendar");
		await page
			.getByRole("link", { name: "Subscribe in your calendar" })
			.click();
		await expect(page).toHaveURL(/\/profile/);
		await expect(
			page.getByRole("radio", { name: "Calendar", exact: true }),
		).toBeChecked();
	});

	await test.step("a student with no link yet is offered to create one", async () => {
		await expect(createLink).toBeVisible();
		await expect(linkField).toHaveCount(0);
	});

	let firstUrl = "";
	await test.step("creating the link shows an absolute .ics address that was never used", async () => {
		await createLink.click();
		await expect(linkField).toBeVisible();
		firstUrl = await shownUrl();
		await expect(page.getByText("Never used")).toBeVisible();
		await expect(page.getByRole("button", { name: "Copy" })).toBeVisible();
	});

	await test.step("the address serves the course's meeting and published exam, not the draft", async () => {
		const response = await page.request.get(firstUrl);
		expect(response.status()).toBe(200);
		expect(response.headers()["content-type"]).toContain("text/calendar");
		const body = (await response.text()).replaceAll("\r\n ", "");
		expect(body).toContain("BEGIN:VCALENDAR");
		expect(body).toContain("Sub-Lab");
		expect(body).toContain("Sub-Midterm");
		expect(body).not.toContain("Sub-Draft");
	});

	let secondUrl = "";
	await test.step("a new link replaces the old address at once", async () => {
		await expect(
			page.getByText(/previous link (stops|will stop) working/i),
		).toBeVisible();
		await page.getByRole("button", { name: "Generate new link" }).click();
		await expect(linkField).not.toHaveValue(firstUrl);
		secondUrl = await shownUrl();
		expect((await page.request.get(firstUrl)).status()).toBe(404);
		expect((await page.request.get(secondUrl)).status()).toBe(200);
	});

	await test.step("deactivating removes the feed and its address", async () => {
		await page.getByRole("button", { name: "Deactivate" }).click();
		await expect(createLink).toBeVisible();
		await expect(linkField).toHaveCount(0);
		const gone = await page.request.get(secondUrl);
		expect(gone.status()).toBe(404);
		expect(await gone.text()).toBe("");
	});
});
