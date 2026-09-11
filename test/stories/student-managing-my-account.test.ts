import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/core/actor";
import { userService } from "@/db/services/user.service";
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

	const stored = await userService.findOne(
		{ username: student.username },
		FULL_ACCESS,
	);
	expect(stored?.name).toBe("Renamed Student");
	expect(stored?.email).toBe(student.email);
});

test("student: change my password", async ({ page }) => {
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

	await test.step("the right one is accepted, and the new password works", async () => {
		await openTab(page, "Account");
		await fillField(page, "Current password", student.password);
		await fillField(page, "New password", "brandnewpassword");
		await fillField(page, "Confirm new password", "brandnewpassword");
		await page.getByRole("button", { name: "Change password" }).click();

		await openTab(page, "Account");
		await page.getByRole("button", { name: "Log out everywhere" }).click();
		await logIn(page, {
			username: student.username,
			password: "brandnewpassword",
		});
	});
});

test("student: log out everywhere", async ({ page }) => {
	const student = await seedUser({ role: "STUDENT" });

	await logInAs(page, student);
	await page.goto("/profile");
	await openTab(page, "Account");
	await page.getByRole("button", { name: "Log out everywhere" }).click();

	// The session is gone, so an authenticated page sends them back to login.
	await page.goto("/profile");
	await expect(page).toHaveURL(/\/login/);
});
