import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { courseHref } from "@/urls";
import { logInAs, openTab, resetDatabase, seedUser } from "./helpers";
import { reportsOf, TINY_PNG } from "./report-support";

test.beforeEach(resetDatabase);

test("student: report a problem", async ({ page }) => {
	const instructor = await seedUser({ role: "INSTRUCTOR" });
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
	});
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
	const text = "Question 2 of the first list has two correct answers.";

	await logInAs(page, student);
	await page.goto(href);

	const dialog = page.getByRole("dialog", { name: "Report a problem" });

	await test.step("the dialog opens from the footer with a screenshot of the page", async () => {
		await page
			.getByRole("contentinfo")
			.getByRole("button", { name: "Report a problem" })
			.click();
		await expect(dialog).toBeVisible();
		await expect(
			dialog.getByRole("img", { name: "Screenshot of the page" }),
		).toBeVisible();
	});

	await test.step("a message too short to act on is refused", async () => {
		await dialog
			.getByRole("group", { name: "Type", exact: true })
			.locator("select")
			.selectOption({ label: "Course content" });
		await dialog
			.getByRole("group", { name: "Message", exact: true })
			.locator("textarea")
			.fill("wrong");
		await dialog.getByRole("button", { name: "Send report" }).click();
		await expect(dialog.getByText(/at least 10 characters/)).toBeVisible();
		await expect(dialog).toBeVisible();
	});

	await test.step("the screenshot is removed and an image added instead", async () => {
		await dialog.getByRole("button", { name: "Remove screenshot" }).click();
		await expect(
			dialog.getByRole("img", { name: "Screenshot of the page" }),
		).toHaveCount(0);
		await dialog
			.getByRole("group", { name: "Images", exact: true })
			.locator('input[type="file"]')
			.setInputFiles({
				name: "answer-key.png",
				mimeType: "image/png",
				buffer: TINY_PNG,
			});
		await expect(
			dialog.getByRole("img", { name: "answer-key.png" }),
		).toBeVisible();
	});

	await test.step("the report is sent", async () => {
		await dialog
			.getByRole("group", { name: "Message", exact: true })
			.locator("textarea")
			.fill(text);
		await dialog.getByRole("button", { name: "Send report" }).click();
		await expect(page.getByText("Report sent.")).toBeVisible();
		await expect(dialog).toBeHidden();
	});

	const [stored] = await reportsOf(student);
	expect(stored).toMatchObject({
		kind: "CONTENT",
		message: text,
		status: "OPEN",
		course: { discipline: course.discipline.slug },
		attachments: [{ filename: "answer-key.png", mimeType: "image/png" }],
	});
	expect(stored?.url).toContain(href);
	expect(stored?.userAgent).toBeTruthy();
	expect(stored?.viewport).toMatch(/^\d+x\d+$/);

	await test.step("the report shows under My reports, and is deleted from there", async () => {
		await page.goto("/profile");
		await openTab(page, "Reports");
		const row = page.getByRole("article").filter({ hasText: "Question 2" });
		await expect(row).toContainText("Open");
		await row.getByRole("button", { name: /Question 2/ }).click();
		await expect(row.getByText(text)).toBeVisible();
		await expect(
			row.getByRole("img", { name: "answer-key.png" }),
		).toBeVisible();

		await row.getByRole("button", { name: "Delete" }).click();
		await expect(row).toHaveCount(0);
	});

	expect(await reportsOf(student)).toEqual([]);
});
