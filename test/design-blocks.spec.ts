import { expect, test } from "./fixtures";

test("design/blocks renders every section without errors or action calls", async ({
	page,
}) => {
	const errors: string[] = [];
	const actionCalls: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("request", (request) => {
		if (request.url().includes("/_actions/")) actionCalls.push(request.url());
	});

	const response = await page.goto("/design/blocks");
	expect(response?.status()).toBe(200);

	for (const title of [
		"Headers",
		"Course tiles and rows",
		"Empty states",
		"Question labels",
		"Fields",
		"Password",
		"Files",
		"Grading",
		"Report filters",
		"Roll call",
		"Glass wall",
	]) {
		await expect(
			page.getByRole("heading", { level: 2, name: title, exact: true }),
		).toBeVisible();
	}

	await expect(page.locator("astro-island")).toHaveCount(0);
	await page.waitForTimeout(500);
	expect(errors).toEqual([]);
	expect(actionCalls).toEqual([]);
});
