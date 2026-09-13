import { expect, test } from "@playwright/test";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { courseHref } from "@/utils/course-url";
import { logInAs, resetDatabase, seedUser } from "./helpers";

test.beforeEach(resetDatabase);

test("admin: see every course in the system", async ({ page }) => {
	const admin = await seedUser({ role: "ADMIN", name: "Grace Admin" });
	const mine = await persistedCourseFactory.create(
		{},
		{ transient: { students: 2 } },
	);
	const other = await persistedCourseFactory.create();

	await logInAs(page, admin);
	await page.goto("/admin/courses");

	await test.step("the inventory names every course, its owner, and its roster size", async () => {
		const row = page.getByRole("row").filter({ hasText: mine.discipline.slug });
		await expect(row).toContainText(mine.discipline.name);
		await expect(row).toContainText(mine.edition.slug);
		await expect(row).toContainText(mine.instructor.name);
		await expect(row).toContainText("2 students");

		await expect(
			page.getByRole("row").filter({ hasText: other.discipline.slug }),
		).toBeVisible();
	});

	await test.step("opening one lets the admin read it, not manage it", async () => {
		const href = courseHref({
			discipline: mine.discipline.slug,
			instructor: mine.instructor.username,
			edition: mine.edition.slug,
		});
		await page
			.getByRole("row")
			.filter({ hasText: mine.discipline.slug })
			.getByRole("link", { name: "Open course" })
			.click();
		await expect(page).toHaveURL(href);
		await expect(
			page.getByRole("heading", { name: mine.discipline.name }),
		).toBeVisible();

		expect((await page.goto(`${href}/manage`))?.status()).toBe(403);
		expect((await page.goto(`${href}/roster`))?.status()).toBe(403);
	});
});
