import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
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

	await test.step("the right one is accepted", async () => {
		await openTab(page, "Account");
		await fillField(page, "Current password", student.password);
		await fillField(page, "New password", "brandnewpassword");
		await fillField(page, "Confirm new password", "brandnewpassword");
		await page.getByRole("button", { name: "Change password" }).click();
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
		{ courseId: course.id, username: student.username },
		FULL_ACCESS,
	);
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});

	await logInAs(page, student);
	await page.goto(href);

	await test.step("the student leaves the course themselves", async () => {
		await page.getByRole("button", { name: "Leave course" }).click();
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
	const stillEnrolled = await db.course.findOne({ id: course.id }, FULL_ACCESS);
	expect(
		stillEnrolled?.enrollments.some((e) => e.username === student.username),
	).toBe(false);
});
