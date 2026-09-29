import { expect, test } from "@playwright/test";

for (const { url, status, title, scene } of [
	{
		url: "/no/such/page",
		status: 404,
		title: "Page not found",
		scene: "A binary tree with one leaf missing.",
	},
	{
		url: "/403?course=cs999",
		status: 403,
		title: "Access denied",
		scene: "A house on the hill with a padlock on its door.",
	},
	{
		url: "/500",
		status: 500,
		title: "Something went wrong",
		scene: "A program stopped on a red line, late at night.",
	},
]) {
	test(`${url} shows its illustration, code and title`, async ({ page }) => {
		const response = await page.goto(url);
		expect(response?.status()).toBe(status);
		await expect(page.getByRole("img", { name: scene })).toBeVisible();
		await expect(page.getByRole("heading", { name: title })).toBeVisible();
	});
}
